import type { OkoDb } from "./oko-db.js";
import {
  isPsdPermission,
  isSystemPsdRole,
  listPermissionsCatalog,
  PSD_PERMISSIONS,
  PSD_ROLE_LABELS_EN,
  PSD_ROLE_LABELS_RU,
  PSD_ROLES,
  setPermissionCacheGetter,
  SYSTEM_ROLE_PERMISSIONS,
  type PsdPermission,
  type RoleCode,
  type SystemPsdRole,
} from "./psdRoles.js";

export interface RoleDto {
  code: RoleCode;
  nameRu: string;
  nameEn: string | null;
  system: boolean;
  active: boolean;
  permissions: PsdPermission[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

type RoleRow = {
  code: string;
  name_ru: string;
  name_en: string | null;
  system: number;
  active: number;
  created_at: string;
  updated_at: string;
};

/** In-memory role → permissions (refreshed on boot and after mutations). */
const rolePermCache = new Map<RoleCode, Set<PsdPermission>>();
const roleMetaCache = new Map<
  RoleCode,
  { nameRu: string; nameEn: string | null; system: boolean; active: boolean }
>();
let cacheLoaded = false;

function wireCacheGetter(): void {
  setPermissionCacheGetter((role) => {
    if (!cacheLoaded) return null;
    // Platform-style full access is handled at session build for legacy admin.
    return rolePermCache.get(role) ?? (isSystemPsdRole(role) ? new Set(SYSTEM_ROLE_PERMISSIONS[role]) : new Set());
  });
}

wireCacheGetter();

export function invalidateRolePermissionCache(): void {
  rolePermCache.clear();
  roleMetaCache.clear();
  cacheLoaded = false;
}

export async function loadRolePermissionCache(db: OkoDb): Promise<void> {
  rolePermCache.clear();
  roleMetaCache.clear();
  try {
    const roles = (await db
      .prepare(
        `SELECT code, name_ru, name_en, system, active, created_at, updated_at FROM roles`
      )
      .all()) as RoleRow[];
    for (const r of roles) {
      roleMetaCache.set(r.code, {
        nameRu: r.name_ru,
        nameEn: r.name_en,
        system: !!r.system,
        active: !!r.active,
      });
      rolePermCache.set(r.code, new Set());
    }
    const links = (await db
      .prepare(`SELECT role_code, permission FROM role_permissions`)
      .all()) as Array<{ role_code: string; permission: string }>;
    for (const link of links) {
      if (!isPsdPermission(link.permission)) continue;
      let set = rolePermCache.get(link.role_code);
      if (!set) {
        set = new Set();
        rolePermCache.set(link.role_code, set);
      }
      set.add(link.permission);
    }
    // Ensure system roles exist in cache even if migration partially applied
    for (const code of PSD_ROLES) {
      if (!rolePermCache.has(code)) {
        rolePermCache.set(code, new Set(SYSTEM_ROLE_PERMISSIONS[code]));
        roleMetaCache.set(code, {
          nameRu: PSD_ROLE_LABELS_RU[code],
          nameEn: PSD_ROLE_LABELS_EN[code],
          system: true,
          active: true,
        });
      }
    }
    cacheLoaded = true;
  } catch {
    // Tables may not exist yet during early migrate — keep fallback matrix.
    cacheLoaded = false;
  }
}

export function permissionsForRoleCode(code: RoleCode): ReadonlySet<PsdPermission> {
  if (cacheLoaded) {
    return rolePermCache.get(code) ?? (isSystemPsdRole(code) ? new Set(SYSTEM_ROLE_PERMISSIONS[code]) : new Set());
  }
  if (isSystemPsdRole(code)) return new Set(SYSTEM_ROLE_PERMISSIONS[code]);
  return new Set();
}

/** Full catalog for platform admin sessions. */
export function allPermissionsSet(): ReadonlySet<PsdPermission> {
  return new Set(PSD_PERMISSIONS);
}

export async function listRoles(db: OkoDb): Promise<RoleDto[]> {
  const rows = (await db
    .prepare(
      `SELECT code, name_ru, name_en, system, active, created_at, updated_at
       FROM roles
       ORDER BY system DESC, name_ru`
    )
    .all()) as RoleRow[];
  const counts = (await db
    .prepare(
      `SELECT psd_role AS code, COUNT(*) AS c FROM users WHERE psd_role IS NOT NULL GROUP BY psd_role`
    )
    .all()) as Array<{ code: string; c: number }>;
  const countMap = new Map(counts.map((c) => [c.code, Number(c.c)]));
  const result: RoleDto[] = [];
  for (const r of rows) {
    const perms = [...permissionsForRoleCode(r.code)];
    result.push({
      code: r.code,
      nameRu: r.name_ru,
      nameEn: r.name_en,
      system: !!r.system,
      active: !!r.active,
      permissions: perms,
      userCount: countMap.get(r.code) ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return result;
}

export async function getRole(db: OkoDb, code: RoleCode): Promise<RoleDto | null> {
  const row = (await db
    .prepare(
      `SELECT code, name_ru, name_en, system, active, created_at, updated_at FROM roles WHERE code = ?`
    )
    .get(code)) as RoleRow | undefined;
  if (!row) return null;
  const userCount = (
    (await db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE psd_role = ?`)
      .get(code)) as { c: number }
  ).c;
  return {
    code: row.code,
    nameRu: row.name_ru,
    nameEn: row.name_en,
    system: !!row.system,
    active: !!row.active,
    permissions: [...permissionsForRoleCode(row.code)],
    userCount: Number(userCount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function assertRoleExists(db: OkoDb, code: RoleCode): Promise<void> {
  const row = await getRole(db, code);
  if (!row || !row.active) {
    throw new Error(`Unknown or inactive role: ${code}`);
  }
}

function normalizeRoleCode(raw: string): string {
  const code = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(code)) {
    throw new Error("role code must be snake_case latin (2–64 chars)");
  }
  return code;
}

function normalizePermissions(perms: unknown): PsdPermission[] {
  if (!Array.isArray(perms)) throw new Error("permissions must be an array");
  const out: PsdPermission[] = [];
  const seen = new Set<string>();
  for (const p of perms) {
    if (!isPsdPermission(p)) throw new Error(`Unknown permission: ${String(p)}`);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export async function createRole(
  db: OkoDb,
  input: {
    code: string;
    nameRu: string;
    nameEn?: string | null;
    permissions?: PsdPermission[];
    active?: boolean;
  }
): Promise<RoleDto> {
  const code = normalizeRoleCode(input.code);
  if (isSystemPsdRole(code)) {
    throw new Error("Cannot create role with a reserved system code");
  }
  const nameRu = input.nameRu?.trim();
  if (!nameRu) throw new Error("nameRu required");
  const now = new Date().toISOString();
  const perms = normalizePermissions(input.permissions ?? []);
  const active = input.active === false ? 0 : 1;
  try {
    await db
      .prepare(
        `INSERT INTO roles (code, name_ru, name_en, system, active, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`
      )
      .run(code, nameRu, input.nameEn?.trim() || null, active, now, now);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "create role failed");
  }
  if (perms.length) {
    await setRolePermissions(db, code, perms);
  } else {
    await loadRolePermissionCache(db);
  }
  return (await getRole(db, code))!;
}

export async function updateRole(
  db: OkoDb,
  code: RoleCode,
  patch: {
    nameRu?: string;
    nameEn?: string | null;
    active?: boolean;
  }
): Promise<RoleDto> {
  const existing = await getRole(db, code);
  if (!existing) throw new Error("Role not found");
  const nameRu = patch.nameRu != null ? patch.nameRu.trim() : existing.nameRu;
  if (!nameRu) throw new Error("nameRu required");
  const nameEn =
    patch.nameEn !== undefined ? patch.nameEn?.trim() || null : existing.nameEn;
  const active = patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active ? 1 : 0;
  if (existing.system && active === 0) {
    throw new Error("Cannot deactivate a system role");
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE roles SET name_ru = ?, name_en = ?, active = ?, updated_at = ? WHERE code = ?`
    )
    .run(nameRu, nameEn, active, now, code);
  await loadRolePermissionCache(db);
  return (await getRole(db, code))!;
}

export async function setRolePermissions(
  db: OkoDb,
  code: RoleCode,
  permissions: PsdPermission[]
): Promise<RoleDto> {
  const existing = await getRole(db, code);
  if (!existing) throw new Error("Role not found");
  const perms = normalizePermissions(permissions);
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM role_permissions WHERE role_code = ?`).run(code);
    for (const p of perms) {
      await tx
        .prepare(`INSERT INTO role_permissions (role_code, permission) VALUES (?, ?)`)
        .run(code, p);
    }
    await tx
      .prepare(`UPDATE roles SET updated_at = ? WHERE code = ?`)
      .run(new Date().toISOString(), code);
  });
  await loadRolePermissionCache(db);
  return (await getRole(db, code))!;
}

export async function deleteRole(db: OkoDb, code: RoleCode): Promise<void> {
  const existing = await getRole(db, code);
  if (!existing) throw new Error("Role not found");
  if (existing.system) throw new Error("Cannot delete a system role");
  if (existing.userCount > 0) {
    throw new Error("Role is assigned to users; reassign them first");
  }
  await db.prepare(`DELETE FROM role_permissions WHERE role_code = ?`).run(code);
  await db.prepare(`DELETE FROM roles WHERE code = ?`).run(code);
  await loadRolePermissionCache(db);
}

export { listPermissionsCatalog };

/** Seed helpers for migration / selftest without going through Migration type. */
export async function seedSystemRolesIfEmpty(db: OkoDb): Promise<number> {
  const count = ((await db.prepare(`SELECT COUNT(*) AS c FROM roles`).get()) as { c: number }).c;
  if (count > 0) return 0;
  const now = new Date().toISOString();
  let n = 0;
  for (const code of PSD_ROLES) {
    await db
      .prepare(
        `INSERT INTO roles (code, name_ru, name_en, system, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, ?, ?)`
      )
      .run(code, PSD_ROLE_LABELS_RU[code], PSD_ROLE_LABELS_EN[code], now, now);
    for (const p of SYSTEM_ROLE_PERMISSIONS[code as SystemPsdRole]) {
      await db
        .prepare(`INSERT INTO role_permissions (role_code, permission) VALUES (?, ?)`)
        .run(code, p);
    }
    n += 1;
  }
  await loadRolePermissionCache(db);
  return n;
}
