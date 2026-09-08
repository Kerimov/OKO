import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * Makes the reporting-period row an explicit package context. `collection_unit_zid`
 * deliberately remains a soft FK because collection units are represented by the
 * existing organizations table and historical imports may precede their creation.
 */
export const packageContextMigration: Migration = {
  id: "007_package_context",
  description: "PSD package context: kind, collection unit and stable package id",
  async up(db: OkoDb) {
    const columns: Array<[string, string]> = [
      ["zid", "INTEGER"],
      ["eid", "INTEGER"],
      ["package_kind", "TEXT DEFAULT 'OKO'"],
      ["collection_unit_zid", "INTEGER"],
      ["package_id", "TEXT"],
    ];
    for (const [name, ddl] of columns) {
      if (!(await db.columnExists("periods", name))) {
        await db.exec(`ALTER TABLE periods ADD COLUMN ${name} ${ddl}`);
      }
    }

    await db.exec(`
      UPDATE periods SET package_kind = 'OKO'
      WHERE package_kind IS NULL OR package_kind = '';
      UPDATE periods SET collection_unit_zid = zid
      WHERE collection_unit_zid IS NULL;
      UPDATE periods
      SET package_id = 'pkg-' || zid::text || '-' || eid::text || '-' || package_kind
      WHERE package_id IS NULL OR package_id = '';

      CREATE UNIQUE INDEX IF NOT EXISTS uq_periods_package_id
        ON periods(package_id);
      CREATE INDEX IF NOT EXISTS idx_periods_collection_unit_context
        ON periods(collection_unit_zid, eid, package_kind);
    `);
  },
};
