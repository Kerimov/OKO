import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

export const psdAppendix12ChecksMigration: Migration = {
  id: "008_psd_appendix12_checks",
  description: "Appendix 12 rule registry and journal rule codes",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_rules_registry (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL,
        number INTEGER,
        type TEXT NOT NULL DEFAULT 'mandatory',
        valid_from TEXT,
        valid_to TEXT,
        year_only INTEGER,
        scope TEXT NOT NULL DEFAULT 'package',
        include_guids_json TEXT NOT NULL DEFAULT '[]',
        exclude_guids_json TEXT NOT NULL DEFAULT '[]',
        affected_forms_json TEXT NOT NULL DEFAULT '[]',
        severity TEXT NOT NULL DEFAULT 'error',
        version TEXT NOT NULL DEFAULT '',
        expression_raw TEXT NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (code, package_kind, version)
      );
      CREATE INDEX IF NOT EXISTS idx_check_rules_registry_active
        ON check_rules_registry(package_kind, active, valid_from, valid_to);
      ALTER TABLE check_run_journal ADD COLUMN IF NOT EXISTS rule_code TEXT;
      CREATE INDEX IF NOT EXISTS idx_check_journal_rule_code
        ON check_run_journal(zid, eid, package_kind, rule_code);
    `);
  },
};
