import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";
import {
  PSD_ROLE_LABELS_EN,
  PSD_ROLE_LABELS_RU,
  PSD_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemPsdRole,
} from "../psdRoles.js";

/** RBAC: configurable roles + permission bindings (permission codes stay in code). */
export const rbacRolesMigration: Migration = {
  id: "014_rbac_roles",
  description: "roles + role_permissions tables; seed five system PSD roles",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        code TEXT PRIMARY KEY,
        name_ru TEXT NOT NULL,
        name_en TEXT,
        system INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        PRIMARY KEY (role_code, permission)
      );
      CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission);
    `);

    const now = new Date().toISOString();
    for (const code of PSD_ROLES) {
      await db
        .prepare(
          `INSERT INTO roles (code, name_ru, name_en, system, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, 1, ?, ?)
           ON CONFLICT (code) DO NOTHING`
        )
        .run(code, PSD_ROLE_LABELS_RU[code], PSD_ROLE_LABELS_EN[code], now, now);
      for (const p of SYSTEM_ROLE_PERMISSIONS[code as SystemPsdRole]) {
        await db
          .prepare(
            `INSERT INTO role_permissions (role_code, permission)
             VALUES (?, ?)
             ON CONFLICT (role_code, permission) DO NOTHING`
          )
          .run(code, p);
      }
    }
  },
};
