import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

export const rashConstructorLayoutMigration: Migration = {
  id: "003_rash_constructor_layout",
  description: "rash active status, modal row modes, fixed rows and entry keys",
  async up(db: OkoDb) {
    if (!(await db.columnExists("rash_rules", "is_active"))) {
      await db.exec("ALTER TABLE rash_rules ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    }
    if (!(await db.columnExists("form_rash_entries", "template_row_key"))) {
      await db.exec("ALTER TABLE form_rash_entries ADD COLUMN template_row_key TEXT");
    }
    if (!(await db.columnExists("rash_addsum", "required"))) {
      await db.exec("ALTER TABLE rash_addsum ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
    }
    await db.exec(`
      CREATE TABLE IF NOT EXISTS rash_modal_settings (
        kod       INTEGER PRIMARY KEY REFERENCES rash_rules(kod) ON DELETE CASCADE,
        row_mode  TEXT NOT NULL DEFAULT 'dynamic'
          CHECK (row_mode IN ('dynamic', 'fixed', 'mixed'))
      );
      CREATE TABLE IF NOT EXISTS rash_modal_rows (
        id              SERIAL PRIMARY KEY,
        kod             INTEGER NOT NULL REFERENCES rash_rules(kod) ON DELETE CASCADE,
        row_key         TEXT NOT NULL,
        label           TEXT NOT NULL,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        required        INTEGER NOT NULL DEFAULT 0,
        source_form_id  TEXT,
        source_row_no   TEXT,
        UNIQUE (kod, row_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rash_modal_rows_kod
        ON rash_modal_rows(kod, sort_order);
    `);
  },
};
