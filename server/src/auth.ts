import type { Request, Response, NextFunction } from "express";
import { getDb } from "./db.js";
import {
  countUsers,
  createSession,
  deleteSession,
  getUserByUsername,
  resolveSessionUser,
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

export function hasLegacyAuth(): boolean {
  return ADMIN_TOKEN.length > 0;
}

export function hasUserAccounts(): boolean {
  return countUsers(getDb()) > 0;
}

export function isAuthEnabled(): boolean {
  return hasLegacyAuth() || hasUserAccounts();
}

export function getAuthConfig() {
  const userAccounts = hasUserAccounts();
  let authMode: "none" | "legacy" | "users" | "mixed" = "none";
  if (hasLegacyAuth() && userAccounts) authMode = "mixed";
  else if (userAccounts) authMode = "users";
  else if (hasLegacyAuth()) authMode = "legacy";

  return {
    authRequired: isAuthEnabled(),
    authMode,
    userAccounts,
    userTokenConfigured: USER_TOKEN.length > 0,
    loginAvailable: userAccounts,
  };
}

function extractToken(req: Request): string | null {
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

export function resolveAuth(req: Request, token: string | null): boolean {
  if (!isAuthEnabled()) {
    req.apiRole = "admin";
    return true;
  }

  if (token) {
    const sessionUser = resolveSessionUser(getDb(), token);
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
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/me"]);

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.has(req.path)) {
    const token = extractToken(req);
    if (token) resolveAuth(req, token);
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
  if (!resolveAuth(req, token ?? null)) {
    res.status(401).json({ error: "Unauthorized", authRequired: true });
    return;
  }
  next();
}

const USER_WRITE_ALLOWED = [
  /^\/api\/instances(\/|$)/,
  /^\/api\/settings$/,
  /^\/api\/kontr$/,
  /^\/api\/work-context$/,
  /^\/api\/packages\/create$/,
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

export function loginHandler(req: Request, res: Response): void {
  if (!hasUserAccounts()) {
    res.status(400).json({ error: "User accounts are not enabled" });
    return;
  }
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const db = getDb();
  const user = getUserByUsername(db, username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = createSession(db, user.id);
  const sessionUser = resolveSessionUser(db, token)!;
  const org =
    sessionUser.zid != null
      ? (db.prepare("SELECT name FROM organizations WHERE zid = ?").get(sessionUser.zid) as
          | { name: string }
          | undefined)
      : undefined;

  res.json({
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
  });
}

export function logoutHandler(req: Request, res: Response): void {
  const token = req.sessionToken ?? extractToken(req);
  if (token) deleteSession(getDb(), token);
  res.json({ ok: true });
}
