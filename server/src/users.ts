import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type UserRole = "admin" | "org";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  role: UserRole;
  zid: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface UserDto {
  id: number;
  username: string;
  displayName: string | null;
  role: UserRole;
  zid: number | null;
  organizationName?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionUser {
  id: number;
  username: string;
  displayName: string | null;
  role: UserRole;
  zid: number | null;
}

const SESSION_DAYS = 7;

export function migrateUserTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'org',
      zid INTEGER REFERENCES organizations(zid),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_zid ON users(zid);
  `);
}

export function countUsers(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function rowToDto(db: DatabaseSync, row: UserRow): UserDto {
  let organizationName: string | null = null;
  if (row.zid != null) {
    const org = db
      .prepare("SELECT name FROM organizations WHERE zid = ?")
      .get(row.zid) as { name: string } | undefined;
    organizationName = org?.name ?? null;
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    zid: row.zid,
    organizationName,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listUsers(db: DatabaseSync): UserDto[] {
  const rows = db
    .prepare(
      `SELECT id, username, password_hash, display_name, role, zid, active, created_at, updated_at
       FROM users ORDER BY role DESC, username`
    )
    .all() as unknown as UserRow[];
  return rows.map((r) => rowToDto(db, r));
}

export function getUserById(db: DatabaseSync, id: number): UserDto | null {
  const row = db
    .prepare(
      `SELECT id, username, password_hash, display_name, role, zid, active, created_at, updated_at
       FROM users WHERE id = ?`
    )
    .get(id) as unknown as UserRow | undefined;
  return row ? rowToDto(db, row) : null;
}

export function getUserByUsername(db: DatabaseSync, username: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT id, username, password_hash, display_name, role, zid, active, created_at, updated_at
       FROM users WHERE username = ? COLLATE NOCASE`
    )
    .get(username.trim()) as unknown as UserRow | undefined;
  return row ?? null;
}

export function createUser(
  db: DatabaseSync,
  input: {
    username: string;
    password: string;
    displayName?: string;
    role: UserRole;
    zid?: number | null;
  }
): UserDto {
  if (!input.username.trim()) throw new Error("username required");
  if (!input.password || input.password.length < 6) {
    throw new Error("password must be at least 6 characters");
  }
  if (input.role === "org" && input.zid == null) {
    throw new Error("zid required for organization user");
  }
  if (input.role === "admin" && input.zid != null) {
    throw new Error("admin user cannot be bound to organization");
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, zid, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      input.username.trim(),
      hashPassword(input.password),
      input.displayName?.trim() || null,
      input.role,
      input.zid ?? null,
      now,
      now
    );
  return getUserById(db, Number(result.lastInsertRowid))!;
}

export function updateUser(
  db: DatabaseSync,
  id: number,
  patch: {
    displayName?: string | null;
    password?: string;
    role?: UserRole;
    zid?: number | null;
    active?: boolean;
  }
): UserDto | null {
  const existing = getUserById(db, id);
  if (!existing) return null;

  const role = patch.role ?? existing.role;
  const zid = patch.zid !== undefined ? patch.zid : existing.zid;
  if (role === "org" && zid == null) throw new Error("zid required for organization user");
  if (role === "admin" && zid != null) throw new Error("admin cannot have zid");

  const fields: string[] = ["updated_at = ?"];
  const values: (string | number | null)[] = [new Date().toISOString()];

  if (patch.displayName !== undefined) {
    fields.push("display_name = ?");
    values.push(patch.displayName);
  }
  if (patch.password) {
    if (patch.password.length < 6) throw new Error("password must be at least 6 characters");
    fields.push("password_hash = ?");
    values.push(hashPassword(patch.password));
  }
  if (patch.role !== undefined) {
    fields.push("role = ?");
    values.push(patch.role);
  }
  if (patch.zid !== undefined || patch.role !== undefined) {
    fields.push("zid = ?");
    values.push(role === "admin" ? null : zid);
  }
  if (patch.active !== undefined) {
    fields.push("active = ?");
    values.push(patch.active ? 1 : 0);
  }

  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getUserById(db, id);
}

export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expires.toISOString()
  );
  return token;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeExpiredSessions(db: DatabaseSync): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

export function resolveSessionUser(db: DatabaseSync, token: string): SessionUser | null {
  purgeExpiredSessions(db);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.zid, u.active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at >= ?`
    )
    .get(token, new Date().toISOString()) as
    | {
        id: number;
        username: string;
        display_name: string | null;
        role: string;
        zid: number | null;
        active: number;
      }
    | undefined;

  if (!row || !row.active) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    zid: row.zid,
  };
}

export function seedBootstrapAdmin(db: DatabaseSync): number {
  if (countUsers(db) > 0) return 0;

  const password = process.env.OKO_BOOTSTRAP_ADMIN_PASSWORD?.trim();
  const username = process.env.OKO_BOOTSTRAP_ADMIN_USER?.trim() || "admin";
  if (!password) return 0;

  createUser(db, {
    username,
    password,
    displayName: "Администратор",
    role: "admin",
  });
  return 1;
}
