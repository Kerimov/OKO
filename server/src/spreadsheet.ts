import type { OkoDb } from "./oko-db.js";
import fs from "fs";
import path from "path";
import { ROOT } from "./paths.js";

const RECALC_JSON = path.join(ROOT, "portal", "public", "data", "recalc-rules.json");

export async function migrateSpreadsheetTables(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("form_template_rows", "row_id"))) {
    await db.exec("ALTER TABLE form_template_rows ADD COLUMN row_id TEXT");
  }
  if (!(await db.columnExists("form_instances", "template_schema_version"))) {
    await db.exec(
      "ALTER TABLE form_instances ADD COLUMN template_schema_version INTEGER DEFAULT 1"
    );
  }
  if (!(await db.columnExists("form_instances", "revision"))) {
    await db.exec("ALTER TABLE form_instances ADD COLUMN revision INTEGER DEFAULT 1");
  }

  await db.exec(`
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
  `);
}

export interface RecalcRuleRow {
  id: number;
  formId: string;
  kind: string;
  rowNo: number | null;
  columnKey: string | null;
  formula: string | null;
  sign: string | null;
  sourceRow: number | null;
  columns: string | null;
  sourceColumns: string | null;
  sortOrder: number;
}

export async function listRecalcRules(
  db: OkoDb,
  formId?: string
): Promise<RecalcRuleRow[]> {
  const rows = formId
    ? ((await db
        .prepare(
          `SELECT id, form_id, kind, row_no, column_key, formula, sign, source_row, columns, source_columns, sort_order
           FROM recalc_rules WHERE form_id = ? ORDER BY sort_order, id`
        )
        .all(formId)) as Array<Record<string, unknown>>)
    : ((await db
        .prepare(
          `SELECT id, form_id, kind, row_no, column_key, formula, sign, source_row, columns, source_columns, sort_order
           FROM recalc_rules ORDER BY form_id, sort_order, id`
        )
        .all()) as Array<Record<string, unknown>>);
  return rows.map(mapRecalc);
}

function mapRecalc(r: Record<string, unknown>): RecalcRuleRow {
  return {
    id: Number(r.id),
    formId: String(r.form_id),
    kind: String(r.kind),
    rowNo: r.row_no == null ? null : Number(r.row_no),
    columnKey: r.column_key == null ? null : String(r.column_key),
    formula: r.formula == null ? null : String(r.formula),
    sign: r.sign == null ? null : String(r.sign),
    sourceRow: r.source_row == null ? null : Number(r.source_row),
    columns: r.columns == null ? null : String(r.columns),
    sourceColumns: r.source_columns == null ? null : String(r.source_columns),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function seedRecalcRulesFromJson(db: OkoDb): Promise<number> {
  const count = (await db.prepare("SELECT COUNT(*) AS c FROM recalc_rules").get()) as {
    c: number;
  };
  if (Number(count.c) > 0) return 0;
  if (!fs.existsSync(RECALC_JSON)) return 0;
  const raw = JSON.parse(fs.readFileSync(RECALC_JSON, "utf-8")) as {
    rules?: Array<Record<string, unknown>>;
  };
  const rules = raw.rules ?? [];
  let n = 0;
  const ins = db.prepare(
    `INSERT INTO recalc_rules (form_id, kind, row_no, column_key, formula, sign, source_row, columns, source_columns, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [i, rule] of rules.entries()) {
    const formId = String(rule.formId ?? rule.form_id ?? "");
    if (!formId) continue;
    const kind = String(rule.kind ?? "rows");
    await ins.run(
      formId,
      kind,
      rule.rowNo ?? rule.row_no ?? null,
      rule.column ?? rule.column_key ?? null,
      rule.formula ?? null,
      rule.sign ?? null,
      rule.sourceRow ?? rule.source_row ?? null,
      rule.columns ?? null,
      Array.isArray(rule.sourceColumns)
        ? (rule.sourceColumns as string[]).join("")
        : (rule.source_columns ?? null),
      i
    );
    n++;
  }
  return n;
}

export async function listCellDefinitions(db: OkoDb, formId: string) {
  const rows = (await db
    .prepare(
      `SELECT form_id, row_id, column_key, formula_a1, formula_stable, readonly,
              style_json, validation_json, number_format, help_text
       FROM form_cell_definitions WHERE form_id = ?`
    )
    .all(formId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    formId: String(r.form_id),
    rowId: String(r.row_id),
    columnKey: String(r.column_key),
    formulaA1: r.formula_a1 == null ? null : String(r.formula_a1),
    formulaStable: r.formula_stable == null ? null : String(r.formula_stable),
    readonly: Number(r.readonly) === 1,
    style: r.style_json ? JSON.parse(String(r.style_json)) : null,
    validation: r.validation_json ? JSON.parse(String(r.validation_json)) : null,
    numberFormat: r.number_format == null ? null : String(r.number_format),
    helpText: r.help_text == null ? null : String(r.help_text),
  }));
}

export async function upsertCellDefinition(
  db: OkoDb,
  def: {
    formId: string;
    rowId: string;
    columnKey: string;
    formulaA1?: string | null;
    formulaStable?: string | null;
    readonly?: boolean;
    style?: unknown;
    validation?: unknown;
    numberFormat?: string | null;
    helpText?: string | null;
  }
) {
  await db
    .prepare(
      `INSERT INTO form_cell_definitions (
        form_id, row_id, column_key, formula_a1, formula_stable, readonly,
        style_json, validation_json, number_format, help_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(form_id, row_id, column_key) DO UPDATE SET
        formula_a1 = excluded.formula_a1,
        formula_stable = excluded.formula_stable,
        readonly = excluded.readonly,
        style_json = excluded.style_json,
        validation_json = excluded.validation_json,
        number_format = excluded.number_format,
        help_text = excluded.help_text`
    )
    .run(
      def.formId,
      def.rowId,
      def.columnKey,
      def.formulaA1 ?? null,
      def.formulaStable ?? null,
      def.readonly ? 1 : 0,
      def.style ? JSON.stringify(def.style) : null,
      def.validation ? JSON.stringify(def.validation) : null,
      def.numberFormat ?? null,
      def.helpText ?? null
    );
  return listCellDefinitions(db, def.formId);
}

export async function deleteCellDefinition(
  db: OkoDb,
  formId: string,
  rowId: string,
  columnKey: string
): Promise<{ deleted: number }> {
  const r = await db
    .prepare(
      `DELETE FROM form_cell_definitions
       WHERE form_id = ? AND row_id = ? AND column_key = ?`
    )
    .run(formId, rowId, columnKey);
  return { deleted: Number(r.changes ?? 0) };
}

export async function saveTemplateRevision(
  db: OkoDb,
  formId: string,
  schemaVersion: number,
  snapshot: unknown,
  actor?: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO form_template_revisions (form_id, schema_version, snapshot_json, actor)
       VALUES (?, ?, ?, ?)`
    )
    .run(formId, schemaVersion, JSON.stringify(snapshot), actor ?? null);
}

export async function loadTemplateRevision(
  db: OkoDb,
  formId: string,
  schemaVersion: number
): Promise<unknown | null> {
  const row = (await db
    .prepare(
      `SELECT snapshot_json FROM form_template_revisions
       WHERE form_id = ? AND schema_version = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(formId, schemaVersion)) as { snapshot_json: string } | undefined;
  if (!row?.snapshot_json) return null;
  try {
    return JSON.parse(row.snapshot_json);
  } catch {
    return null;
  }
}

/** Load schema at pinned version (revision snapshot) or latest live schema. */
export async function loadFormSchemaAtVersion(
  db: OkoDb,
  formId: string,
  schemaVersion?: number | null
): Promise<import("./forms.js").FormSchemaDto | null> {
  const { loadFormSchema } = await import("./forms.js");
  if (schemaVersion == null) return loadFormSchema(db, formId);
  const snap = await loadTemplateRevision(db, formId, schemaVersion);
  if (snap && typeof snap === "object" && (snap as { id?: string }).id) {
    return snap as import("./forms.js").FormSchemaDto;
  }
  const live = await loadFormSchema(db, formId);
  if (live && (live.schemaVersion ?? 1) === schemaVersion) return live;
  // Fallback: still return live if pin missing (legacy instances).
  return live;
}
