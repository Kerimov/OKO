import type { Request, Response, NextFunction } from "express";
import { getDb } from "./oko-db.js";
import {
  countUsers,
  createSession,
  deleteSession,
  getUserByUsername,
  resolveSessionUser,
  revokeAllUserSessions,
  verifyPassword,
  type SessionUser,
} from "./users.js";

export type ApiRole = "admin" | "user";

declare global {
  namespace Express {
    interface Request {
      apiRole?: ApiRole;
      apiUser?: SessionUser;
      sessionToken?: string;
    }
  }
}

const ADMIN_TOKEN = process.env.OKO_ADMIN_TOKEN?.trim() || "";
const USER_TOKEN = process.env.OKO_USER_TOKEN?.trim() || "";

let userAccountsCached = false;

export async function refreshUserAccountsCache(): Promise<void> {
  userAccountsCached = (await countUsers(await getDb())) > 0;
}

export function hasLegacyAuth(): boolean {
  return ADMIN_TOKEN.length > 0;
}

export function hasUserAccounts(): boolean {
  return userAccountsCached;
}

export function isAuthDisabled(): boolean {
  const v = process.env.OKO_AUTH_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isAuthEnabled(): boolean {
  if (isAuthDisabled()) return false;
  return hasLegacyAuth() || hasUserAccounts() || getOidcConfig().enabled;
}

export function getAuthConfig() {
  const userAccounts = hasUserAccounts();
  let authMode: "none" | "legacy" | "users" | "mixed" | "oidc" = "none";
  if (hasLegacyAuth() && userAccounts) authMode = "mixed";
  else if (userAccounts) authMode = "users";
  else if (hasLegacyAuth()) authMode = "legacy";

  const oidc = getOidcConfig();
  if (oidc.enabled && authMode === "none") authMode = "oidc";

  return {
    authRequired: isAuthEnabled(),
    authMode,
    userAccounts,
    userTokenConfigured: USER_TOKEN.length > 0,
    loginAvailable: userAccounts || oidc.enabled,
    oidc: {
      enabled: oidc.enabled,
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      authorizationUrl: oidc.authorizationUrl,
      scopes: oidc.scopes,
    },
  };
}

export function getOidcConfig() {
  // Lazy import-shaped wrapper kept sync via duplicated env read in oidc.ts;
  // re-export shape for Nest/health without circular init issues.
  const issuer = process.env.OKO_OIDC_ISSUER?.trim() || "";
  const clientId = process.env.OKO_OIDC_CLIENT_ID?.trim() || "";
  const base = issuer.replace(/\/$/, "");
  const authorizationUrl =
    process.env.OKO_OIDC_AUTHORIZATION_URL?.trim() ||
    (base ? `${base}/protocol/openid-connect/auth` : "");
  const scopes = (process.env.OKO_OIDC_SCOPES?.trim() || "openid profile email").split(/\s+/);
  const enabledFlag =
    process.env.OKO_OIDC_ENABLED?.trim().toLowerCase() === "1" ||
    process.env.OKO_OIDC_ENABLED?.trim().toLowerCase() === "true";
  const enabled =
    (enabledFlag || (issuer.length > 0 && clientId.length > 0)) &&
    issuer.length > 0 &&
    clientId.length > 0;

  return {
    enabled,
    issuer: issuer || null,
    clientId: clientId || null,
    authorizationUrl: authorizationUrl || null,
    scopes,
    callbackPath: "/api/auth/oidc/callback",
  };
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const query = req.query.token;
  if (typeof query === "string" && query.trim()) return query.trim();
  return null;
}

function resolveLegacyRole(token: string | null): ApiRole | null {
  if (!hasLegacyAuth()) return null;
  if (!token) return null;
  if (token === ADMIN_TOKEN) return "admin";
  if (USER_TOKEN && token === USER_TOKEN) return "user";
  return null;
}

function applySessionUser(req: Request, user: SessionUser, token: string): void {
  req.apiUser = user;
  req.sessionToken = token;
  req.apiRole = user.role === "admin" ? "admin" : "user";
}

export async function resolveAuth(req: Request, token: string | null): Promise<boolean> {
  if (!isAuthEnabled()) {
    req.apiRole = "admin";
    return true;
  }

  if (token) {
    const db = await getDb();
    const sessionUser = await resolveSessionUser(db, token);
    if (sessionUser) {
      applySessionUser(req, sessionUser, token);
      return true;
    }
    const legacy = resolveLegacyRole(token);
    if (legacy) {
      req.apiRole = legacy;
      return true;
    }
  }

  return false;
}

/** Public routes — no token required even when auth is enabled. */
export const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/oidc/config",
  "/api/auth/oidc/start",
  "/api/auth/oidc/callback",
  "/api/auth/session-policy",
  "/api/templates/minfin",
]);

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PATHS.has(path);
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (PUBLIC_API_PATHS.has(req.path)) {
      const token = extractToken(req);
      if (token) await resolveAuth(req, token);
      else if (!isAuthEnabled()) req.apiRole = "admin";
      next();
      return;
    }

    if (!isAuthEnabled()) {
      req.apiRole = "admin";
      next();
      return;
    }

    const token = extractToken(req);
    if (!(await resolveAuth(req, token ?? null))) {
      res.status(401).json({ error: "Unauthorized", authRequired: true });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}

const USER_WRITE_ALLOWED = [
  /^\/api\/instances(\/|$)/,
  /^\/api\/instances\/[^/]+\/status$/,
  /^\/api\/settings$/,
  /^\/api\/kontr$/,
  /^\/api\/work-context$/,
  /^\/api\/packages\/create$/,
  /^\/api\/aggregation\/run$/,
  /^\/api\/auth\/logout$/,
];

const USER_WRITE_BLOCKED = ["/api/instances/normalize"];

export function userWriteGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled() || req.apiRole !== "user") {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (USER_WRITE_BLOCKED.includes(req.path)) {
    res.status(403).json({ error: "Admin required" });
    return;
  }
  if (USER_WRITE_ALLOWED.some((p) => p.test(req.path))) {
    next();
    return;
  }
  res.status(403).json({ error: "Admin required" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled() || req.apiRole === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Admin required" });
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  if (!hasUserAccounts()) {
    res.status(400).json({ error: "User accounts are not enabled" });
    return;
  }
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  try {
    const result = await loginWithCredentials(username.trim(), password);
    if (!result) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    res.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "USER_ACCOUNTS_DISABLED") {
      res.status(400).json({ error: "User accounts are not enabled" });
      return;
    }
    throw e;
  }
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const token = req.sessionToken ?? extractToken(req);
  if (token) await deleteSession(await getDb(), token);
  res.json({ ok: true });
}

export interface AuthMePayload {
  role: ApiRole | null;
  user: Record<string, unknown> | null;
  authRequired: boolean;
  authMode: "none" | "legacy" | "users" | "mixed" | "oidc";
  userAccounts: boolean;
  userTokenConfigured: boolean;
  loginAvailable: boolean;
  oidc?: {
    enabled: boolean;
    issuer: string | null;
    clientId: string | null;
    authorizationUrl: string | null;
    scopes: string[];
  };
}

export async function buildAuthMePayload(req: Request): Promise<AuthMePayload> {
  const config = getAuthConfig();
  let user: Record<string, unknown> | null = null;
  if (req.apiUser) {
    const { getUserById } = await import("./users.js");
    const dto = await getUserById(await getDb(), req.apiUser.id);
    if (dto) {
      user = {
        id: dto.id,
        username: dto.username,
        displayName: dto.displayName,
        role: dto.role,
        zid: dto.zid,
        organizationName: dto.organizationName ?? null,
      };
    }
  }
  return {
    role: req.apiRole ?? null,
    user,
    ...config,
  };
}

export interface LoginResult {
  token: string;
  role: ApiRole;
  user: {
    id: number;
    username: string;
    displayName: string | null;
    role: string;
    zid: number | null;
    organizationName: string | null;
  };
}

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<LoginResult | null> {
  if (!hasUserAccounts()) {
    throw new Error("USER_ACCOUNTS_DISABLED");
  }
  const db = await getDb();
  const user = await getUserByUsername(db, username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return null;
  }
  const token = await createSession(db, user.id);
  const sessionUser = (await resolveSessionUser(db, token))!;
  const org =
    sessionUser.zid != null
      ? await db
          .prepare("SELECT name FROM organizations WHERE zid = ?")
          .get<{ name: string }>(sessionUser.zid)
      : undefined;
  return {
    token,
    role: sessionUser.role === "admin" ? "admin" : "user",
    user: {
      id: sessionUser.id,
      username: sessionUser.username,
      displayName: sessionUser.displayName,
      role: sessionUser.role,
      zid: sessionUser.zid,
      organizationName: org?.name ?? null,
    },
  };
}

export async function logoutSession(req: Request): Promise<void> {
  const token = req.sessionToken ?? extractToken(req);
  if (token) await deleteSession(await getDb(), token);
}

export async function logoutAllSessions(req: Request): Promise<{ revoked: number }> {
  const userId = req.apiUser?.id;
  if (userId == null) return { revoked: 0 };
  const revoked = await revokeAllUserSessions(await getDb(), userId);
  return { revoked };
}
