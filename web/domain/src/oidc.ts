import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { createSession, getUserByUsername, type UserDto } from "./users.js";

export interface OidcRuntimeConfig {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userinfoUrl: string | null;
  scopes: string[];
  callbackPath: string;
  publicAppUrl: string | null;
  adminEmails: Set<string>;
  defaultRole: "admin" | "org";
  defaultZid: number | null;
}

const pendingStates = new Map<string, { redirectUri: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupStates(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
}

export function getOidcRuntimeConfig(): OidcRuntimeConfig {
  const issuer = process.env.OKO_OIDC_ISSUER?.trim() || "";
  const clientId = process.env.OKO_OIDC_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.OKO_OIDC_CLIENT_SECRET?.trim() || "";
  const base = issuer.replace(/\/$/, "");
  const authorizationUrl =
    process.env.OKO_OIDC_AUTHORIZATION_URL?.trim() ||
    (base ? `${base}/protocol/openid-connect/auth` : "");
  const tokenUrl =
    process.env.OKO_OIDC_TOKEN_URL?.trim() ||
    (base ? `${base}/protocol/openid-connect/token` : "");
  const userinfoUrl =
    process.env.OKO_OIDC_USERINFO_URL?.trim() ||
    (base ? `${base}/protocol/openid-connect/userinfo` : "");
  const scopes = (process.env.OKO_OIDC_SCOPES?.trim() || "openid profile email").split(/\s+/);
  const enabledFlag =
    process.env.OKO_OIDC_ENABLED?.trim().toLowerCase() === "1" ||
    process.env.OKO_OIDC_ENABLED?.trim().toLowerCase() === "true";
  const enabled = (enabledFlag || (issuer.length > 0 && clientId.length > 0)) &&
    issuer.length > 0 &&
    clientId.length > 0;
  const adminEmails = new Set(
    (process.env.OKO_OIDC_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const defaultRole =
    process.env.OKO_OIDC_DEFAULT_ROLE?.trim() === "org" ? "org" : "admin";
  const zRaw = process.env.OKO_OIDC_DEFAULT_ZID?.trim();
  const defaultZid = zRaw ? Number(zRaw) || null : null;

  return {
    enabled,
    issuer: issuer || null,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    authorizationUrl: authorizationUrl || null,
    tokenUrl: tokenUrl || null,
    userinfoUrl: userinfoUrl || null,
    scopes,
    callbackPath: "/api/auth/oidc/callback",
    publicAppUrl: process.env.OKO_PUBLIC_APP_URL?.trim() || null,
    adminEmails,
    defaultRole,
    defaultZid,
  };
}

export function beginOidcState(redirectUri: string): string {
  cleanupStates();
  const state = randomUUID();
  pendingStates.set(state, { redirectUri, createdAt: Date.now() });
  return state;
}

export function takeOidcState(state: string): { redirectUri: string } | null {
  cleanupStates();
  const row = pendingStates.get(state);
  if (!row) return null;
  pendingStates.delete(state);
  return { redirectUri: row.redirectUri };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exchangeCode(params: {
  code: string;
  redirectUri: string;
  cfg: OidcRuntimeConfig;
}): Promise<{ access_token?: string; id_token?: string }> {
  if (!params.cfg.tokenUrl || !params.cfg.clientId) {
    throw new Error("OIDC token endpoint not configured");
  }
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", params.cfg.clientId);
  if (params.cfg.clientSecret) body.set("client_secret", params.cfg.clientSecret);

  const res = await fetch(params.cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `token exchange HTTP ${res.status}`);
  }
  return data;
}

async function fetchUserInfo(
  accessToken: string,
  cfg: OidcRuntimeConfig
): Promise<Record<string, unknown> | null> {
  if (!cfg.userinfoUrl) return null;
  const res = await fetch(cfg.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function findOrCreateOidcUser(
  db: OkoDb,
  profile: { email: string; name?: string | null; sub?: string | null },
  cfg: OidcRuntimeConfig
): Promise<UserDto> {
  const email = profile.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("OIDC profile missing email");

  const existing = await getUserByUsername(db, email);
  if (existing) {
    if (!existing.active) throw new Error("User is disabled");
    const { getUserById, updateUser } = await import("./users.js");
    if (profile.name && profile.name !== existing.display_name) {
      await updateUser(db, existing.id, { displayName: profile.name });
    }
    return (await getUserById(db, existing.id))!;
  }

  const isAdmin =
    cfg.adminEmails.size > 0
      ? cfg.adminEmails.has(email)
      : cfg.defaultRole === "admin";
  const role = isAdmin ? "admin" : "org";
  if (role === "org" && cfg.defaultZid == null) {
    throw new Error(
      "OIDC org user requires OKO_OIDC_DEFAULT_ZID or list email in OKO_OIDC_ADMIN_EMAILS"
    );
  }

  const { createUser } = await import("./users.js");
  const password = `oidc-${randomBytes(24).toString("hex")}`;
  const created = await createUser(db, {
    username: email,
    password,
    displayName: profile.name || email,
    role,
    zid: role === "org" ? cfg.defaultZid : null,
  });
  try {
    const { refreshUserAccountsCache } = await import("./auth.js");
    await refreshUserAccountsCache();
  } catch {
    /* ignore */
  }
  return created;
}

export interface OidcLoginResult {
  token: string;
  role: "admin" | "user";
  user: {
    id: number;
    username: string;
    displayName: string | null;
    role: string;
    zid: number | null;
    organizationName: string | null;
  };
  appRedirect: string;
}

export async function completeOidcLogin(
  db: OkoDb,
  input: { code: string; state: string; callbackAbsoluteUrl: string }
): Promise<OidcLoginResult> {
  const cfg = getOidcRuntimeConfig();
  if (!cfg.enabled) throw new Error("OIDC is not configured");

  const st = takeOidcState(input.state);
  if (!st) throw new Error("Invalid or expired OIDC state");

  const tokens = await exchangeCode({
    code: input.code,
    redirectUri: st.redirectUri,
    cfg,
  });

  let profile: Record<string, unknown> = {};
  if (tokens.id_token) {
    profile = decodeJwtPayload(tokens.id_token) ?? {};
  }
  if (tokens.access_token) {
    const info = await fetchUserInfo(tokens.access_token, cfg);
    if (info) profile = { ...profile, ...info };
  }

  const email = pickString(profile.email, profile.preferred_username, profile.upn);
  if (!email) throw new Error("OIDC token does not contain email");
  const name = pickString(profile.name, profile.given_name);
  const sub = pickString(profile.sub);

  const user = await findOrCreateOidcUser(
    db,
    { email, name, sub },
    cfg
  );

  const token = await createSession(db, user.id);
  const org =
    user.zid != null
      ? ((await db.prepare("SELECT name FROM organizations WHERE zid = ?").get(user.zid)) as
          | { name: string }
          | undefined)
      : undefined;

  const appBase = (cfg.publicAppUrl || "http://localhost:5173").replace(/\/$/, "");
  const url = new URL(appBase + "/login");
  url.searchParams.set("sso_token", token);

  return {
    token,
    role: user.role === "admin" ? "admin" : "user",
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      zid: user.zid,
      organizationName: org?.name ?? null,
    },
    appRedirect: url.toString(),
  };
}

/** Sanity helper for tests / health. */
export function oidcStateFingerprint(): string {
  return createHash("sha256").update(String(pendingStates.size)).digest("hex").slice(0, 8);
}
