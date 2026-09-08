import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

/**
 * Absorbs historical boot ALTER/CREATE from migrate*Tables().
 * Idempotent via columnExists / IF NOT EXISTS. Fresh DBs already match
 * data/schema.postgresql.sql; this backfills older databases once.
 */
async function addColumn(
  db: OkoDb,
  table: string,
  name: string,
  ddl: string
): Promise<void> {
  if (!(await db.columnExists(table, name))) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

export const legacyBootSchemaMigration: Migration = {
  id: "015_legacy_boot_schema",
  description:
    "Backfill columns/tables previously applied by legacy migrate*Tables boot",
  async up(db: OkoDb) {
    // forms
    await addColumn(db, "form_templates", "pdf_file", "TEXT");
    await addColumn(db, "form_templates", "allow_add_rows", "INTEGER DEFAULT 0");
    await addColumn(db, "form_templates", "kontr_form", "INTEGER DEFAULT 0");
    await addColumn(
      db,
      "form_templates",
      "signatures_json",
      `TEXT DEFAULT '["Руководитель","Главный бухгалтер"]'`
    );
    await addColumn(db, "form_templates", "unit", `TEXT DEFAULT 'тыс.руб.'`);
    await addColumn(db, "form_templates", "archived", "INTEGER DEFAULT 0");
    await addColumn(db, "form_templates", "schema_version", "INTEGER DEFAULT 1");
    await addColumn(db, "form_template_columns", "f_total", "INTEGER DEFAULT 0");
    await addColumn(db, "form_template_columns", "help_text", "TEXT");
    await addColumn(db, "form_template_columns", "align", "TEXT");
    await addColumn(db, "form_template_columns", "decimals", "INTEGER");
    await addColumn(db, "form_template_columns", "hidden", "INTEGER DEFAULT 0");
    await addColumn(db, "form_template_columns", "formula", "TEXT");
    await addColumn(db, "form_template_rows", "row_kind", `TEXT DEFAULT 'data'`);
    await addColumn(db, "form_template_rows", "row_level", "INTEGER DEFAULT 0");
    await addColumn(db, "form_template_rows", "readonly", "INTEGER DEFAULT 0");
    await addColumn(db, "form_template_rows", "formula", "TEXT");
    await addColumn(db, "form_template_rows", "row_id", "TEXT");

    // saldo
    await addColumn(db, "saldo_rules", "saldo_t", "INTEGER DEFAULT 0");
    await addColumn(db, "saldo_rules", "saldo_s", "INTEGER DEFAULT 0");
    await addColumn(db, "saldo_rules", "saldo_g", "INTEGER DEFAULT 0");
    await addColumn(db, "saldo_rules", "name", "TEXT");
    await addColumn(db, "saldo_rules", "conditional", "INTEGER DEFAULT 0");
    await addColumn(db, "form_templates", "saldo_yellow", "TEXT");
    await addColumn(db, "form_templates", "saldo_red", "TEXT");
    await addColumn(db, "form_templates", "saldo_blue", "TEXT");
    await addColumn(db, "form_templates", "saldo_green", "TEXT");
    await addColumn(db, "form_templates", "reorg_update", "TEXT");
    await addColumn(db, "form_templates", "reorg_update_2", "TEXT");
    await addColumn(db, "form_templates", "saldo_yellow_corr", "TEXT");
    await addColumn(db, "form_templates", "saldo_red_corr", "TEXT");
    await addColumn(db, "form_templates", "saldo_blue_corr", "TEXT");

    // excel / checks / audit / instances
    await addColumn(db, "excel_mappings", "period", "INTEGER DEFAULT 0");
    await addColumn(db, "excel_mappings", "add_text", "TEXT");
    await addColumn(db, "check_rules", "first_level", "INTEGER DEFAULT 0");
    await addColumn(db, "check_rules", "period", "TEXT");
    await addColumn(db, "check_rules", "info", "TEXT");
    await addColumn(db, "report_log", "entity_type", "TEXT");
    await addColumn(db, "report_log", "entity_id", "TEXT");
    await addColumn(db, "report_log", "actor", "TEXT");
    await addColumn(db, "form_instances", "template_title", "TEXT");
    await addColumn(db, "form_instances", "enterprise_code", "TEXT");
    await addColumn(db, "form_instances", "signatures_json", `TEXT DEFAULT '{}'`);
    await addColumn(db, "form_instances", "status", `TEXT DEFAULT 'draft'`);
    await addColumn(
      db,
      "form_instances",
      "template_schema_version",
      "INTEGER DEFAULT 1"
    );
    await addColumn(db, "form_instances", "revision", "INTEGER DEFAULT 1");

    // periods workflow + lifecycle
    await addColumn(db, "periods", "package_status", `TEXT DEFAULT 'draft'`);
    await addColumn(db, "periods", "package_comment", "TEXT");
    await addColumn(db, "periods", "status_updated_at", "TEXT");
    await addColumn(db, "periods", "status_updated_by", "TEXT");
    await addColumn(db, "periods", "period_status", `TEXT DEFAULT 'open'`);
    await addColumn(db, "periods", "closed_at", "TEXT");
    await addColumn(db, "periods", "closed_by", "TEXT");
    await addColumn(db, "periods", "methodology_release_id", "TEXT");

    // kontr
    await addColumn(db, "kontragents", "org_type", "INTEGER");
    await addColumn(db, "kontragents", "mandatory_rash", "INTEGER DEFAULT 0");
    await addColumn(db, "kontragents", "country", "TEXT");
    await addColumn(db, "kontragents", "city", "TEXT");
    await addColumn(db, "kontragents", "ogrn", "TEXT");
    await addColumn(db, "kontragents", "old_name", "TEXT");
    await addColumn(db, "kontragents", "id_obdnsi", "TEXT");

    // package_exchange GUID swap + DDL stays in migratePackageExchange (not in dump).

    await db.exec(`
      CREATE TABLE IF NOT EXISTS check_rule_forms (
        rule_number INTEGER NOT NULL REFERENCES check_rules(number) ON DELETE CASCADE,
        form_id TEXT NOT NULL,
        PRIMARY KEY (rule_number, form_id)
      );
      CREATE INDEX IF NOT EXISTS idx_check_rule_forms_form ON check_rule_forms(form_id);
      CREATE INDEX IF NOT EXISTS idx_check_rules_active_period
        ON check_rules(active, period_active, number);

      CREATE TABLE IF NOT EXISTS period_form_set (
        eid INTEGER NOT NULL,
        form_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (eid, form_id)
      );
      CREATE INDEX IF NOT EXISTS idx_period_form_set_eid ON period_form_set(eid);

      CREATE TABLE IF NOT EXISTS rash_placements (
        id          SERIAL PRIMARY KEY,
        form_id     TEXT NOT NULL,
        row_no      TEXT NOT NULL,
        column_key  TEXT NOT NULL DEFAULT '',
        kod         INTEGER NOT NULL REFERENCES rash_rules(kod) ON DELETE CASCADE,
        UNIQUE (form_id, row_no, column_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rash_placements_kod ON rash_placements(kod);
      CREATE INDEX IF NOT EXISTS idx_rash_placements_form ON rash_placements(form_id);

      CREATE TABLE IF NOT EXISTS form_rash_entries (
        id              SERIAL PRIMARY KEY,
        instance_id     TEXT NOT NULL REFERENCES form_instances(instance_id) ON DELETE CASCADE,
        form_id         TEXT NOT NULL,
        parent_row_no   INTEGER NOT NULL,
        column_key      TEXT,
        rash_kod        INTEGER NOT NULL REFERENCES rash_rules(kod),
        line_no         INTEGER NOT NULL DEFAULT 0,
        kontr_id        INTEGER,
        kontr_name      TEXT,
        inn             TEXT,
        kpp             TEXT,
        attr_a2         TEXT,
        attr_a3         TEXT,
        attr_a4         TEXT,
        template_row_key TEXT,
        values_json     TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_rash_entries_instance ON form_rash_entries(instance_id);
      CREATE INDEX IF NOT EXISTS idx_rash_entries_lookup
        ON form_rash_entries(instance_id, form_id, parent_row_no, rash_kod);

      CREATE TABLE IF NOT EXISTS package_inbox (
        id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        actor TEXT,
        filename TEXT,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        pkg_zid INTEGER,
        pkg_eid INTEGER,
        organization TEXT,
        period_start TEXT,
        period_end TEXT,
        target_zid INTEGER,
        target_eid INTEGER,
        validation_errors TEXT NOT NULL DEFAULT '[]',
        warnings TEXT NOT NULL DEFAULT '[]',
        instance_count INTEGER NOT NULL DEFAULT 0,
        accepted_at TEXT,
        rejected_reason TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_package_inbox_status ON package_inbox(status, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_package_inbox_sha ON package_inbox(sha256);

      CREATE TABLE IF NOT EXISTS methodology_releases (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        exported_at TEXT NOT NULL,
        activated_at TEXT NOT NULL,
        source TEXT,
        checksums TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_methodology_releases_act
        ON methodology_releases(active, activated_at DESC);

      CREATE TABLE IF NOT EXISTS form_cell_definitions (
        id SERIAL PRIMARY KEY,
        form_id TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
        row_id TEXT NOT NULL,
        column_key TEXT NOT NULL,
        formula_a1 TEXT,
        formula_stable TEXT,
        readonly INTEGER DEFAULT 0,
        style_json TEXT,
        validation_json TEXT,
        number_format TEXT,
        help_text TEXT,
        UNIQUE(form_id, row_id, column_key)
      );
      CREATE INDEX IF NOT EXISTS idx_cell_defs_form ON form_cell_definitions(form_id);

      CREATE TABLE IF NOT EXISTS form_template_revisions (
        id SERIAL PRIMARY KEY,
        form_id TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        actor TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_form_revisions ON form_template_revisions(form_id, schema_version);

      CREATE TABLE IF NOT EXISTS cell_change_log (
        id SERIAL PRIMARY KEY,
        instance_id TEXT NOT NULL,
        row_no INTEGER NOT NULL,
        column_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        actor TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cell_change_instance ON cell_change_log(instance_id, created_at);

      CREATE TABLE IF NOT EXISTS recalc_rules (
        id SERIAL PRIMARY KEY,
        form_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        row_no INTEGER,
        column_key TEXT,
        formula TEXT,
        sign TEXT,
        source_row INTEGER,
        columns TEXT,
        source_columns TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_recalc_form ON recalc_rules(form_id, sort_order);

      CREATE TABLE IF NOT EXISTS agg_corr_sets (
        id SERIAL PRIMARY KEY,
        parent_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        corr_zid INTEGER NOT NULL REFERENCES organizations(zid) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        source_eid INTEGER NOT NULL REFERENCES periods(eid),
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(corr_zid)
      );
      CREATE INDEX IF NOT EXISTS idx_agg_corr_parent ON agg_corr_sets(parent_zid);
      CREATE TABLE IF NOT EXISTS agg_run_locks (
        parent_zid INTEGER NOT NULL,
        eid INTEGER NOT NULL,
        locked_by TEXT NOT NULL,
        locked_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (parent_zid, eid)
      );

      CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
      CREATE INDEX IF NOT EXISTS idx_instances_package ON form_instances(zid, eid, template_id);
      CREATE INDEX IF NOT EXISTS idx_periods_zid ON periods(zid);
      CREATE INDEX IF NOT EXISTS idx_kontragents_name ON kontragents(name);
      CREATE INDEX IF NOT EXISTS idx_kontragents_org_type ON kontragents(org_type);
    `);
  },
};
