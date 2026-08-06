import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/** DSL check rules registry (Appendix 12 expressions) + safe report presets. */
export const psdChecksReportsMigration: Migration = {
  id: "006_psd_checks_reports",
  description: "PSD check_dsl_rules registry and support report presets",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_dsl_rules (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL,
        expression TEXT NOT NULL,
        package_kind TEXT NOT NULL DEFAULT 'OKO',
        requires_explanation INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (code, package_kind)
      );
      CREATE INDEX IF NOT EXISTS idx_check_dsl_active
        ON check_dsl_rules(package_kind, active, sort_order);
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS support_report_presets (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name_ru TEXT NOT NULL,
        name_en TEXT,
        description TEXT,
        query_kind TEXT NOT NULL DEFAULT 'package_summary',
        params_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO support_report_presets (code, name_ru, name_en, description, query_kind, params_json, active, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', 1, ?)
         ON CONFLICT (code) DO NOTHING`
      )
      .run(
        "package_summary",
        "Сводка комплекта",
        "Package summary",
        "Статусы форм по zid/eid",
        "package_summary",
        now
      );
    await db
      .prepare(
        `INSERT INTO support_report_presets (code, name_ru, name_en, description, query_kind, params_json, active, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', 1, ?)
         ON CONFLICT (code) DO NOTHING`
      )
      .run(
        "bp_status",
        "Статусы БП",
        "BP statuses",
        "Мониторинг бизнес-процессов",
        "bp_status",
        now
      );
    await db
      .prepare(
        `INSERT INTO support_report_presets (code, name_ru, name_en, description, query_kind, params_json, active, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', 1, ?)
         ON CONFLICT (code) DO NOTHING`
      )
      .run(
        "check_failures",
        "Журнал непройденных проверок",
        "Failed checks journal",
        "Последние failed из check_run_journal",
        "check_failures",
        now
      );
  },
};
