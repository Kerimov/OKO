import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";

export interface FormColumnDto {
  key: string;
  label: string;
  type: "text" | "number";
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
  fTotal?: boolean;
  helpText?: string | null;
  align?: "left" | "center" | "right" | null;
  decimals?: number | null;
  hidden?: boolean;
  formula?: string | null;
}

export interface FormRowDto {
  num?: string;
  code?: string;
  name: string;
  kind?: "data" | "header" | "total" | "section" | "hidden" | null;
  level?: number | null;
  readonly?: boolean;
  formula?: string | null;
}

export interface FormSchemaDto {
  id: string;
  title: string;
  category: string;
  pages: number;
  pdfFile?: string;
  meta: {
    organization: string;
    enterpriseCode: string;
    periodStart: string;
    periodEnd: string;
    unit: string;
  };
  columns: FormColumnDto[];
  rows: FormRowDto[];
  allowAddRows?: boolean;
  kontrForm?: boolean;
  signatures: string[];
  archived?: boolean;
  schemaVersion?: number;
}

export interface FormCatalogDto {
  version: string;
  name: string;
  description: string;
  source: string;
  categories: Record<string, string>;
  forms: Array<{
    id: string;
    title: string;
    category: string;
    pages: number;
    pdfFile: string;
  }>;
}

const SCHEMAS_DIR = path.join(ROOT, "portal", "public", "schemas");
const CATALOG_JSON = path.join(SCHEMAS_DIR, "catalog.json");

const DEFAULT_CATEGORIES: Record<string, string> = {
  N01: "Бухгалтерская отчётность",
  N02: "Основные средства и НМА",
  N03: "Сегментная отчётность",
  N04: "Финансовые вложения",
  N05: "Запасы",
  N06: "Дебиторская задолженность",
  N09: "Кредиторская задолженность",
  N10: "Заёмные средства",
  N11: "Выручка",
  N12: "Затраты и себестоимость",
  N13: "Прочие доходы и расходы",
  N14: "Движение денежных средств (детализация)",
  N15: "Расчёты с бюджетом",
  N16: "Валютные активы и задолженность",
  N19: "Акции",
  ND: "Дополнительные формы",
};

export async function migrateFormTables(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("form_templates", "pdf_file"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN pdf_file TEXT");
  }
  if (!(await db.columnExists("form_templates", "allow_add_rows"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN allow_add_rows INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_templates", "kontr_form"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN kontr_form INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_templates", "signatures_json"))) {
    await db.exec(
      `ALTER TABLE form_templates ADD COLUMN signatures_json TEXT DEFAULT '["Руководитель","Главный бухгалтер"]'`
    );
  }
  if (!(await db.columnExists("form_templates", "unit"))) {
    await db.exec(`ALTER TABLE form_templates ADD COLUMN unit TEXT DEFAULT 'тыс.руб.'`);
  }
  if (!(await db.columnExists("form_templates", "archived"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN archived INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_templates", "schema_version"))) {
    await db.exec("ALTER TABLE form_templates ADD COLUMN schema_version INTEGER DEFAULT 1");
  }

  if (!(await db.columnExists("form_template_columns", "f_total"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN f_total INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_template_columns", "help_text"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN help_text TEXT");
  }
  if (!(await db.columnExists("form_template_columns", "align"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN align TEXT");
  }
  if (!(await db.columnExists("form_template_columns", "decimals"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN decimals INTEGER");
  }
  if (!(await db.columnExists("form_template_columns", "hidden"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN hidden INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_template_columns", "formula"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN formula TEXT");
  }

  if (!(await db.columnExists("form_template_rows", "row_kind"))) {
    await db.exec(`ALTER TABLE form_template_rows ADD COLUMN row_kind TEXT DEFAULT 'data'`);
  }
  if (!(await db.columnExists("form_template_rows", "row_level"))) {
    await db.exec("ALTER TABLE form_template_rows ADD COLUMN row_level INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_template_rows", "readonly"))) {
    await db.exec("ALTER TABLE form_template_rows ADD COLUMN readonly INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("form_template_rows", "formula"))) {
    await db.exec("ALTER TABLE form_template_rows ADD COLUMN formula TEXT");
  }
}

async function upsertFormFromSchema(
  db: OkoDb,
  schema: FormSchemaDto,
  sortOrder: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO form_templates (
      form_id, title, category, pages, pdf_file, allow_add_rows, kontr_form, signatures_json,
      sort_order, unit, archived, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(form_id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      pages = excluded.pages,
      pdf_file = excluded.pdf_file,
      allow_add_rows = excluded.allow_add_rows,
      kontr_form = excluded.kontr_form,
      signatures_json = excluded.signatures_json,
      sort_order = excluded.sort_order,
      unit = excluded.unit,
      archived = excluded.archived,
      schema_version = excluded.schema_version`
    )
    .run(
      schema.id,
      schema.title,
      schema.category,
      schema.pages ?? 1,
      schema.pdfFile ?? `1@1_${schema.id}.pdf`,
      schema.allowAddRows ? 1 : 0,
      schema.kontrForm ? 1 : 0,
      JSON.stringify(schema.signatures ?? ["Руководитель", "Главный бухгалтер"]),
      sortOrder,
      schema.meta?.unit ?? "тыс.руб.",
      schema.archived ? 1 : 0,
      schema.schemaVersion ?? 1
    );

  await db.prepare("DELETE FROM form_template_columns WHERE form_id = ?").run(schema.id);
  await db.prepare("DELETE FROM form_template_rows WHERE form_id = ?").run(schema.id);

  const insCol = db.prepare(
    `INSERT INTO form_template_columns (
      form_id, sort_order, column_key, label, col_type, width, frozen, readonly, f_total,
      help_text, align, decimals, hidden, formula
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const seenColKeys = new Set<string>();
  let colOrder = 0;
  for (const c of schema.columns) {
    if (seenColKeys.has(c.key)) continue;
    seenColKeys.add(c.key);
    await insCol.run(
      schema.id,
      colOrder++,
      c.key,
      c.label,
      c.type,
      c.width ?? 100,
      c.frozen ? 1 : 0,
      c.readonly || c.fTotal ? 1 : 0,
      c.fTotal ? 1 : 0,
      c.helpText ?? null,
      c.align ?? null,
      c.decimals ?? null,
      c.hidden ? 1 : 0,
      c.formula ?? null
    );
  }

  const insRow = db.prepare(
    `INSERT INTO form_template_rows (
      form_id, sort_order, row_num, row_code, row_name, row_kind, row_level, readonly, formula
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < schema.rows.length; i++) {
    const r = schema.rows[i];
    await insRow.run(
      schema.id,
      i,
      r.num ?? null,
      r.code ?? null,
      r.name,
      r.kind ?? "data",
      r.level ?? 0,
      r.readonly ? 1 : 0,
      r.formula ?? null
    );
  }
}

export async function seedFormsFromJson(db: OkoDb): Promise<number> {
  const count = (await db.prepare("SELECT COUNT(*) AS c FROM form_templates").get()) as { c: number };
  if (count.c > 0) return 0;
  if (!fs.existsSync(CATALOG_JSON)) return 0;

  const catalog = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf-8")) as FormCatalogDto;
  return db.transaction(async (tx) => {
    let n = 0;
    for (let idx = 0; idx < catalog.forms.length; idx++) {
      const f = catalog.forms[idx];
      const schemaPath = path.join(SCHEMAS_DIR, `${f.id}.json`);
      if (!fs.existsSync(schemaPath)) continue;
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as FormSchemaDto;
      await upsertFormFromSchema(tx, schema, idx);
      n++;
    }
    return n;
  });
}

export async function reimportFormsFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(CATALOG_JSON)) throw new Error("catalog.json not found");
  const catalog = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf-8")) as FormCatalogDto;
  await db.exec("DELETE FROM form_template_rows");
  await db.exec("DELETE FROM form_template_columns");
  await db.exec("DELETE FROM form_templates");
  return db.transaction(async (tx) => {
    let n = 0;
    for (let idx = 0; idx < catalog.forms.length; idx++) {
      const f = catalog.forms[idx];
      const schemaPath = path.join(SCHEMAS_DIR, `${f.id}.json`);
      if (!fs.existsSync(schemaPath)) continue;
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as FormSchemaDto;
      await upsertFormFromSchema(tx, schema, idx);
      n++;
    }
    return n;
  });
}

export async function loadFormSchema(db: OkoDb, formId: string): Promise<FormSchemaDto | null> {
  const tpl = (await db
    .prepare(
      `SELECT form_id, title, category, pages, pdf_file, allow_add_rows, kontr_form, signatures_json,
              unit, archived, schema_version
       FROM form_templates WHERE form_id = ?`
    )
    .get(formId)) as
    | {
        form_id: string;
        title: string;
        category: string;
        pages: number;
        pdf_file: string | null;
        allow_add_rows: number;
        kontr_form: number;
        signatures_json: string;
        unit: string | null;
        archived: number | null;
        schema_version: number | null;
      }
    | undefined;

  if (!tpl) return null;

  const columns = (
    (await db
      .prepare(
        `SELECT column_key, label, col_type, width, frozen, readonly, f_total,
                help_text, align, decimals, hidden, formula
         FROM form_template_columns WHERE form_id = ? ORDER BY sort_order`
      )
      .all(formId)) as Array<{
      column_key: string;
      label: string;
      col_type: string;
      width: number;
      frozen: number;
      readonly: number;
      f_total: number;
      help_text: string | null;
      align: string | null;
      decimals: number | null;
      hidden: number | null;
      formula: string | null;
    }>
  ).map((c) => {
    const col: FormColumnDto = {
      key: c.column_key,
      label: c.label,
      type: c.col_type as "text" | "number",
      width: c.width,
      frozen: !!c.frozen,
      readonly: !!c.readonly,
      fTotal: !!c.f_total,
    };
    if (c.help_text) col.helpText = c.help_text;
    if (c.align === "left" || c.align === "center" || c.align === "right") col.align = c.align;
    if (c.decimals != null) col.decimals = c.decimals;
    if (c.hidden) col.hidden = true;
    if (c.formula) col.formula = c.formula;
    return col;
  });

  const rows = (
    (await db
      .prepare(
        `SELECT row_num, row_code, row_name, row_kind, row_level, readonly, formula
         FROM form_template_rows
         WHERE form_id = ? ORDER BY sort_order`
      )
      .all(formId)) as Array<{
      row_num: string | null;
      row_code: string | null;
      row_name: string;
      row_kind: string | null;
      row_level: number | null;
      readonly: number | null;
      formula: string | null;
    }>
  ).map((r) => {
    const item: FormRowDto = { name: r.row_name };
    if (r.row_num) item.num = r.row_num;
    if (r.row_code) item.code = r.row_code;
    if (r.row_kind && r.row_kind !== "data") {
      item.kind = r.row_kind as FormRowDto["kind"];
    }
    if (r.row_level) item.level = r.row_level;
    if (r.readonly) item.readonly = true;
    if (r.formula) item.formula = r.formula;
    return item;
  });

  let signatures: string[] = ["Руководитель", "Главный бухгалтер"];
  try {
    signatures = JSON.parse(tpl.signatures_json);
  } catch {
    /* default */
  }

  const schema: FormSchemaDto = {
    id: tpl.form_id,
    title: tpl.title,
    category: tpl.category,
    pages: tpl.pages,
    pdfFile: tpl.pdf_file ?? undefined,
    meta: {
      organization: "",
      enterpriseCode: "1@1",
      periodStart: "",
      periodEnd: "",
      unit: tpl.unit || "тыс.руб.",
    },
    columns,
    rows,
    signatures,
    schemaVersion: tpl.schema_version ?? 1,
  };
  if (tpl.allow_add_rows) schema.allowAddRows = true;
  if (tpl.kontr_form) schema.kontrForm = true;
  if (tpl.archived) schema.archived = true;
  return schema;
}

export async function exportCatalog(db: OkoDb): Promise<FormCatalogDto & { forms: Array<FormCatalogDto["forms"][number] & { archived?: boolean }> }> {
  const rows = (await db
    .prepare(
      `SELECT form_id, title, category, pages, pdf_file, COALESCE(archived, 0) AS archived
       FROM form_templates ORDER BY sort_order, form_id`
    )
    .all()) as Array<{
    form_id: string;
    title: string;
    category: string;
    pages: number;
    pdf_file: string | null;
    archived: number;
  }>;

  const usedCats = new Set(rows.map((r) => r.category));
  const categories: Record<string, string> = {};
  for (const [k, v] of Object.entries(DEFAULT_CATEGORIES)) {
    if (usedCats.has(k)) categories[k] = v;
  }
  for (const cat of usedCats) {
    if (!categories[cat]) categories[cat] = cat;
  }

  return {
    version: "2.0",
    name: "ОКО — Портал форм корпоративной отчётности",
    description: "Схемы форм из PostgreSQL (a_stblROWs, a_stblFIELDs)",
    source: "db:form_templates",
    categories,
    forms: rows.map((r) => ({
      id: r.form_id,
      title: r.title,
      category: r.category,
      pages: r.pages,
      pdfFile: r.pdf_file ?? `1@1_${r.form_id}.pdf`,
      ...(r.archived ? { archived: true } : {}),
    })),
  };
}

export async function updateFormMeta(
  db: OkoDb,
  formId: string,
  patch: {
    title?: string;
    category?: string;
    pages?: number;
    pdfFile?: string | null;
    allowAddRows?: boolean;
    kontrForm?: boolean;
    signatures?: string[];
    unit?: string;
    archived?: boolean;
    schemaVersion?: number;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    fields.push("title = ?");
    values.push(patch.title);
  }
  if (patch.category !== undefined) {
    fields.push("category = ?");
    values.push(patch.category);
  }
  if (patch.pages !== undefined) {
    fields.push("pages = ?");
    values.push(patch.pages);
  }
  if (patch.pdfFile !== undefined) {
    fields.push("pdf_file = ?");
    values.push(patch.pdfFile);
  }
  if (patch.allowAddRows !== undefined) {
    fields.push("allow_add_rows = ?");
    values.push(patch.allowAddRows ? 1 : 0);
  }
  if (patch.kontrForm !== undefined) {
    fields.push("kontr_form = ?");
    values.push(patch.kontrForm ? 1 : 0);
  }
  if (patch.signatures !== undefined) {
    fields.push("signatures_json = ?");
    values.push(JSON.stringify(patch.signatures));
  }
  if (patch.unit !== undefined) {
    fields.push("unit = ?");
    values.push(patch.unit);
  }
  if (patch.archived !== undefined) {
    fields.push("archived = ?");
    values.push(patch.archived ? 1 : 0);
  }
  if (patch.schemaVersion !== undefined) {
    fields.push("schema_version = ?");
    values.push(patch.schemaVersion);
  }
  if (!fields.length) return;
  values.push(formId);
  await db.prepare(`UPDATE form_templates SET ${fields.join(", ")} WHERE form_id = ?`).run(...values);
}

export async function bumpFormSchemaVersion(
  db: OkoDb,
  formId: string,
  actor?: string
): Promise<number> {
  const row = (await db
    .prepare(`SELECT COALESCE(schema_version, 1) AS schema_version FROM form_templates WHERE form_id = ?`)
    .get(formId)) as { schema_version: number } | undefined;
  if (!row) throw new Error("Form not found");
  const next = Number(row.schema_version ?? 1) + 1;
  await db
    .prepare(`UPDATE form_templates SET schema_version = ? WHERE form_id = ?`)
    .run(next, formId);
  const schema = await loadFormSchema(db, formId);
  if (schema) {
    const { saveTemplateRevision } = await import("./spreadsheet.js");
    await saveTemplateRevision(db, formId, next, schema, actor);
  }
  return next;
}

export async function replaceFormColumns(
  db: OkoDb,
  formId: string,
  columns: FormColumnDto[],
  opts?: { actor?: string; bumpVersion?: boolean }
): Promise<void> {
  await db.prepare("DELETE FROM form_template_columns WHERE form_id = ?").run(formId);
  const ins = db.prepare(
    `INSERT INTO form_template_columns (
      form_id, sort_order, column_key, label, col_type, width, frozen, readonly, f_total,
      help_text, align, decimals, hidden, formula
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const seen = new Set<string>();
  let order = 0;
  for (const c of columns) {
    if (!c.key?.trim() || seen.has(c.key)) continue;
    seen.add(c.key);
    await ins.run(
      formId,
      order++,
      c.key,
      c.label,
      c.type,
      c.width ?? 100,
      c.frozen ? 1 : 0,
      c.readonly || c.fTotal ? 1 : 0,
      c.fTotal ? 1 : 0,
      c.helpText ?? null,
      c.align ?? null,
      c.decimals ?? null,
      c.hidden ? 1 : 0,
      c.formula ?? null
    );
  }
  if (opts?.bumpVersion !== false) {
    await bumpFormSchemaVersion(db, formId, opts?.actor);
  }
}

export async function replaceFormRows(
  db: OkoDb,
  formId: string,
  rows: FormRowDto[],
  opts?: { actor?: string; bumpVersion?: boolean }
): Promise<void> {
  await db.prepare("DELETE FROM form_template_rows WHERE form_id = ?").run(formId);
  const ins = db.prepare(
    `INSERT INTO form_template_rows (
      form_id, sort_order, row_num, row_code, row_name, row_kind, row_level, readonly, formula
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await ins.run(
      formId,
      i,
      r.num ?? null,
      r.code ?? null,
      r.name,
      r.kind ?? "data",
      r.level ?? 0,
      r.readonly ? 1 : 0,
      r.formula ?? null
    );
  }
  if (opts?.bumpVersion !== false) {
    await bumpFormSchemaVersion(db, formId, opts?.actor);
  }
}

export async function saveFormSchemaAtomic(
  db: OkoDb,
  schema: FormSchemaDto
): Promise<FormSchemaDto> {
  const existing = await loadFormSchema(db, schema.id);
  if (!existing) throw new Error(`Form ${schema.id} not found`);
  const nextVersion = (existing.schemaVersion ?? 1) + 1;
  const toSave: FormSchemaDto = {
    ...schema,
    schemaVersion: nextVersion,
  };
  await db.transaction(async (tx) => {
    const sort = (
      (await tx
        .prepare("SELECT sort_order FROM form_templates WHERE form_id = ?")
        .get(schema.id)) as { sort_order: number } | undefined
    )?.sort_order;
    await upsertFormFromSchema(tx, toSave, sort ?? 0);
  });
  const saved = await loadFormSchema(db, schema.id);
  if (!saved) throw new Error("save failed");
  return saved;
}

export async function createFormSchema(
  db: OkoDb,
  input: { id: string; title: string; category?: string; cloneFrom?: string }
): Promise<FormSchemaDto> {
  const id = input.id.trim();
  if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error("Некорректный код формы");
  if (await loadFormSchema(db, id)) throw new Error(`Форма ${id} уже существует`);

  let base: FormSchemaDto | null = null;
  if (input.cloneFrom) {
    base = await loadFormSchema(db, input.cloneFrom);
    if (!base) throw new Error(`Источник ${input.cloneFrom} не найден`);
  }

  const schema: FormSchemaDto = base
    ? {
        ...base,
        id,
        title: input.title || `${base.title} (копия)`,
        category: input.category || base.category,
        pdfFile: `1@1_${id}.pdf`,
        archived: false,
        schemaVersion: 1,
      }
    : {
        id,
        title: input.title || id,
        category: input.category || id.split("_")[0] || "N01",
        pages: 1,
        pdfFile: `1@1_${id}.pdf`,
        meta: {
          organization: "",
          enterpriseCode: "1@1",
          periodStart: "",
          periodEnd: "",
          unit: "тыс.руб.",
        },
        columns: [
          { key: "num", label: "№", type: "text", width: 60, frozen: true, readonly: true },
          { key: "name", label: "Наименование", type: "text", width: 280, frozen: true },
          { key: "B", label: "Графа B", type: "number", width: 100 },
        ],
        rows: [{ num: "1", name: "Новая строка", kind: "data" }],
        signatures: ["Руководитель", "Главный бухгалтер"],
        schemaVersion: 1,
      };

  const maxSort = (
    (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM form_templates").get()) as {
      m: number;
    }
  ).m;
  await db.transaction(async (tx) => {
    await upsertFormFromSchema(tx, schema, Number(maxSort) + 1);
  });
  const saved = await loadFormSchema(db, id);
  if (!saved) throw new Error("create failed");
  return saved;
}

export async function setFormArchived(db: OkoDb, formId: string, archived: boolean): Promise<FormSchemaDto> {
  if (!(await loadFormSchema(db, formId))) throw new Error("Form not found");
  await updateFormMeta(db, formId, { archived });
  const saved = await loadFormSchema(db, formId);
  if (!saved) throw new Error("archive failed");
  return saved;
}

export interface FormDependencyHit {
  kind: "check" | "rash" | "saldo" | "excel" | "recalc" | "instance" | "correspondence";
  ref: string;
  detail: string;
}

export async function getFormDependencies(
  db: OkoDb,
  formId: string,
  opts?: { columnKey?: string; rowNo?: string }
): Promise<{
  formId: string;
  totals: Record<string, number>;
  hits: FormDependencyHit[];
}> {
  const hits: FormDependencyHit[] = [];
  const col = opts?.columnKey?.trim().toUpperCase();
  const rowNo = opts?.rowNo?.trim();

  try {
    const checks = (await db
      .prepare(`SELECT number, expression, expression_alt, message FROM check_rules`)
      .all()) as Array<{
      number: number;
      expression: string;
      expression_alt: string | null;
      message: string | null;
    }>;
    for (const c of checks) {
      const full = `${c.expression} ${c.expression_alt ?? ""}`;
      if (!full.includes(formId)) continue;
      if (col && !full.toUpperCase().includes(`${formId}.${col}`) && !full.includes(`[${formId}`)) {
        // still count form-level, but skip when looking for specific column without match
        if (!full.toUpperCase().includes(`.${col}`) && !full.toUpperCase().includes(`,${col}`)) {
          continue;
        }
      }
      if (rowNo && !full.includes(rowNo)) continue;
      hits.push({
        kind: "check",
        ref: String(c.number),
        detail: (c.message || c.expression).slice(0, 120),
      });
      if (hits.filter((h) => h.kind === "check").length >= 40) break;
    }
  } catch {
    /* ignore */
  }

  try {
    let sql = `SELECT form_id, row_no, column_key, kod FROM rash_placements WHERE form_id = ?`;
    const params: (string | number)[] = [formId];
    if (rowNo) {
      sql += ` AND row_no = ?`;
      params.push(rowNo);
    }
    if (col) {
      sql += ` AND UPPER(column_key) = ?`;
      params.push(col);
    }
    sql += ` LIMIT 40`;
    const places = (await db.prepare(sql).all(...params)) as Array<{
      row_no: string;
      column_key: string;
      kod: number;
    }>;
    for (const p of places) {
      hits.push({
        kind: "rash",
        ref: String(p.kod),
        detail: `строка ${p.row_no} / гр. ${p.column_key || "*"}`,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const saldo = (await db
      .prepare(
        `SELECT number, target_form, target_column, target_row, source_form, source_column, source_row
         FROM saldo_rules
         WHERE target_form = ? OR source_form = ? OR end_form = ?
         LIMIT 40`
      )
      .all(formId, formId, formId)) as Array<{
      number: number;
      target_form: string;
      target_column: string | null;
      target_row: number | null;
      source_form: string | null;
      source_column: string | null;
      source_row: number | null;
    }>;
    for (const s of saldo) {
      if (col) {
        const cols = [s.target_column, s.source_column].map((x) => (x ?? "").toUpperCase());
        if (!cols.includes(col)) continue;
      }
      if (rowNo) {
        const rows = [s.target_row, s.source_row].map((x) => (x == null ? "" : String(x)));
        if (!rows.includes(rowNo)) continue;
      }
      hits.push({
        kind: "saldo",
        ref: String(s.number),
        detail: `${s.target_form}.${s.target_column ?? "?"} ← ${s.source_form ?? "?"}.${s.source_column ?? "?"}`,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const excel = (await db
      .prepare(
        `SELECT id, sheet_name, form_column, form_row FROM excel_mappings WHERE form_name = ? LIMIT 40`
      )
      .all(formId)) as Array<{
      id: number;
      sheet_name: string | null;
      form_column: string | null;
      form_row: string | null;
    }>;
    for (const e of excel) {
      if (col && (e.form_column ?? "").toUpperCase() !== col) continue;
      if (rowNo && String(e.form_row ?? "") !== rowNo) continue;
      hits.push({
        kind: "excel",
        ref: String(e.id),
        detail: `${e.sheet_name ?? "sheet"} ${e.form_column ?? ""}/${e.form_row ?? ""}`,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const corr = (await db
      .prepare(
        `SELECT saldo_yellow, saldo_red, saldo_blue, saldo_green FROM form_templates WHERE form_id = ?`
      )
      .get(formId)) as
      | {
          saldo_yellow: string | null;
          saldo_red: string | null;
          saldo_blue: string | null;
          saldo_green: string | null;
        }
      | undefined;
    if (corr) {
      for (const [k, v] of Object.entries(corr)) {
        if (v) hits.push({ kind: "correspondence", ref: k, detail: String(v) });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const recalcPath = path.join(ROOT, "portal", "public", "data", "recalc-rules.json");
    if (fs.existsSync(recalcPath)) {
      const data = JSON.parse(fs.readFileSync(recalcPath, "utf-8")) as {
        byForm?: Record<string, unknown[]>;
      };
      const rules = data.byForm?.[formId];
      if (Array.isArray(rules) && rules.length) {
        hits.push({
          kind: "recalc",
          ref: formId,
          detail: `${rules.length} правил пересчёта`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const inst = (await db
      .prepare(`SELECT COUNT(*) AS c FROM form_instances WHERE template_id = ?`)
      .get(formId)) as { c: number };
    if (Number(inst?.c) > 0) {
      hits.push({
        kind: "instance",
        ref: formId,
        detail: `${inst.c} экземпляров комплектов`,
      });
    }
  } catch {
    /* ignore */
  }

  const totals: Record<string, number> = {};
  for (const h of hits) {
    totals[h.kind] = (totals[h.kind] ?? 0) + 1;
  }
  return { formId, totals, hits };
}

export async function previewFormsReimport(db: OkoDb): Promise<{
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  jsonTotal: number;
  dbTotal: number;
}> {
  if (!fs.existsSync(CATALOG_JSON)) throw new Error("catalog.json not found");
  const catalog = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf-8")) as FormCatalogDto;
  const dbCat = await exportCatalog(db);
  const dbIds = new Set(dbCat.forms.map((f) => f.id));
  const jsonIds = new Set(catalog.forms.map((f) => f.id));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;

  for (const f of catalog.forms) {
    if (!dbIds.has(f.id)) {
      added.push(f.id);
      continue;
    }
    const schemaPath = path.join(SCHEMAS_DIR, `${f.id}.json`);
    if (!fs.existsSync(schemaPath)) {
      changed.push(f.id);
      continue;
    }
    const fileSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as FormSchemaDto;
    const dbSchema = await loadFormSchema(db, f.id);
    if (!dbSchema) {
      added.push(f.id);
      continue;
    }
    const fileFp = JSON.stringify({
      title: fileSchema.title,
      columns: fileSchema.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows: fileSchema.rows.map((r) => ({ num: r.num, code: r.code, name: r.name })),
    });
    const dbFp = JSON.stringify({
      title: dbSchema.title,
      columns: dbSchema.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows: dbSchema.rows.map((r) => ({ num: r.num, code: r.code, name: r.name })),
    });
    if (fileFp === dbFp) unchanged += 1;
    else changed.push(f.id);
  }
  for (const id of dbIds) {
    if (!jsonIds.has(id)) removed.push(id);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged,
    jsonTotal: catalog.forms.length,
    dbTotal: dbCat.forms.length,
  };
}

export function suggestNextColumnKey(existing: string[]): string {
  const used = new Set(existing.map((k) => k.toUpperCase()));
  const alphabet = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const ch of alphabet) {
    if (!used.has(ch)) return ch;
  }
  for (let i = 2; i < 100; i++) {
    for (const ch of alphabet) {
      const key = `${ch}${i}`;
      if (!used.has(key)) return key;
    }
  }
  return `X${existing.length + 1}`;
}

function rewriteColumnToken(text: string, formId: string, from: string, to: string): string {
  if (!text) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const formEsc = formId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text;
  // Form-qualified refs: N01_1.B / N01_1,B
  out = out.replace(new RegExp(`(${formEsc})([.,])(${esc})\\b`, "gi"), `$1$2${to}`);
  // Bare column letter when unique letter-key (A1-style in formulas)
  if (/^[A-Z]+$/i.test(from) && /^[A-Z]+$/i.test(to)) {
    out = out.replace(new RegExp(`\\b${esc}(?=\\d)`, "gi"), to);
  }
  return out;
}

/**
 * Rename a form column key and cascade into domain tables + cell definitions.
 */
export async function cascadeRenameColumnKey(
  db: OkoDb,
  formId: string,
  fromKey: string,
  toKey: string
): Promise<{
  formId: string;
  fromKey: string;
  toKey: string;
  updated: Record<string, number>;
}> {
  const from = fromKey.trim();
  const to = toKey.trim();
  if (!from || !to) throw new Error("fromKey and toKey required");
  if (from === to) {
    return { formId, fromKey: from, toKey: to, updated: {} };
  }
  if (/^(num|name|code)$/i.test(from) || /^(num|name|code)$/i.test(to)) {
    throw new Error("Системные графы num/name/code переименовывать нельзя");
  }

  const schema = await loadFormSchema(db, formId);
  if (!schema) throw new Error("Form not found");
  if (!schema.columns.some((c) => c.key === from)) {
    throw new Error(`Column ${from} not found`);
  }
  if (schema.columns.some((c) => c.key === to)) {
    throw new Error(`Column ${to} already exists`);
  }

  const updated: Record<string, number> = {};

  await db.transaction(async (tx) => {
    const col = await tx
      .prepare(
        `UPDATE form_columns SET column_key = ? WHERE form_id = ? AND column_key = ?`
      )
      .run(to, formId, from);
    updated.columns = Number(col.changes ?? 0);

    try {
      const cells = await tx
        .prepare(
          `UPDATE form_cell_definitions SET column_key = ? WHERE form_id = ? AND column_key = ?`
        )
        .run(to, formId, from);
      updated.cellDefinitions = Number(cells.changes ?? 0);

      const formulaRows = (await tx
        .prepare(
          `SELECT row_id, column_key, formula_a1, formula_stable
           FROM form_cell_definitions WHERE form_id = ?`
        )
        .all(formId)) as Array<{
        row_id: string;
        column_key: string;
        formula_a1: string | null;
        formula_stable: string | null;
      }>;
      const updFormula = tx.prepare(
        `UPDATE form_cell_definitions
         SET formula_a1 = ?, formula_stable = ?
         WHERE form_id = ? AND row_id = ? AND column_key = ?`
      );
      let formulaRewrites = 0;
      for (const row of formulaRows) {
        const a1 = row.formula_a1
          ? rewriteColumnToken(row.formula_a1, formId, from, to)
          : null;
        const st = row.formula_stable
          ? rewriteColumnToken(row.formula_stable, formId, from, to)
          : null;
        if (a1 !== row.formula_a1 || st !== row.formula_stable) {
          await updFormula.run(a1, st, formId, row.row_id, row.column_key);
          formulaRewrites++;
        }
      }
      updated.formulaRewrites = formulaRewrites;
    } catch {
      updated.cellDefinitions = 0;
    }

    try {
      const rash = await tx
        .prepare(
          `UPDATE rash_placements SET column_key = ? WHERE form_id = ? AND UPPER(column_key) = UPPER(?)`
        )
        .run(to, formId, from);
      updated.rashPlacements = Number(rash.changes ?? 0);
    } catch {
      updated.rashPlacements = 0;
    }

    try {
      const saldoT = await tx
        .prepare(
          `UPDATE saldo_rules SET target_column = ? WHERE target_form = ? AND UPPER(target_column) = UPPER(?)`
        )
        .run(to, formId, from);
      const saldoS = await tx
        .prepare(
          `UPDATE saldo_rules SET source_column = ? WHERE source_form = ? AND UPPER(source_column) = UPPER(?)`
        )
        .run(to, formId, from);
      updated.saldo = Number(saldoT.changes ?? 0) + Number(saldoS.changes ?? 0);
    } catch {
      updated.saldo = 0;
    }

    try {
      const map = await tx
        .prepare(
          `UPDATE excel_mappings SET form_column = ? WHERE form_name = ? AND UPPER(form_column) = UPPER(?)`
        )
        .run(to, formId, from);
      updated.excelMappings = Number(map.changes ?? 0);
    } catch {
      updated.excelMappings = 0;
    }

    try {
      const recalc = await tx
        .prepare(
          `UPDATE recalc_rules SET column_key = ? WHERE form_id = ? AND UPPER(column_key) = UPPER(?)`
        )
        .run(to, formId, from);
      updated.recalc = Number(recalc.changes ?? 0);
    } catch {
      updated.recalc = 0;
    }

    try {
      const checks = (await tx
        .prepare(`SELECT number, expression, expression_alt FROM check_rules`)
        .all()) as Array<{
        number: number;
        expression: string;
        expression_alt: string | null;
      }>;
      const upd = tx.prepare(
        `UPDATE check_rules SET expression = ?, expression_alt = ? WHERE number = ?`
      );
      let n = 0;
      for (const c of checks) {
        if (!c.expression.includes(formId) && !(c.expression_alt ?? "").includes(formId)) {
          continue;
        }
        const nextExpr = rewriteColumnToken(c.expression, formId, from, to);
        const nextAlt = c.expression_alt
          ? rewriteColumnToken(c.expression_alt, formId, from, to)
          : null;
        if (nextExpr !== c.expression || nextAlt !== c.expression_alt) {
          await upd.run(nextExpr, nextAlt, c.number);
          n++;
        }
      }
      updated.checks = n;
    } catch {
      updated.checks = 0;
    }
  });

  return { formId, fromKey: from, toKey: to, updated };
}
