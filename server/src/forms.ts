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
}

export interface FormRowDto {
  num?: string;
  code?: string;
  name: string;
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
  if (db.dialect === "sqlite") {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS form_template_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      column_key TEXT NOT NULL,
      label TEXT NOT NULL,
      col_type TEXT NOT NULL DEFAULT 'number',
      width INTEGER DEFAULT 100,
      frozen INTEGER DEFAULT 0,
      readonly INTEGER DEFAULT 0,
      UNIQUE (form_id, column_key)
    );
    CREATE INDEX IF NOT EXISTS idx_form_cols_form ON form_template_columns(form_id, sort_order);

    CREATE TABLE IF NOT EXISTS form_template_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT NOT NULL REFERENCES form_templates(form_id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      row_num TEXT,
      row_code TEXT,
      row_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_form_rows_form ON form_template_rows(form_id, sort_order);
  `);
  }

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

  if (!(await db.columnExists("form_template_columns", "f_total"))) {
    await db.exec("ALTER TABLE form_template_columns ADD COLUMN f_total INTEGER DEFAULT 0");
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
      form_id, title, category, pages, pdf_file, allow_add_rows, kontr_form, signatures_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(form_id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      pages = excluded.pages,
      pdf_file = excluded.pdf_file,
      allow_add_rows = excluded.allow_add_rows,
      kontr_form = excluded.kontr_form,
      signatures_json = excluded.signatures_json,
      sort_order = excluded.sort_order`
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
      sortOrder
    );

  await db.prepare("DELETE FROM form_template_columns WHERE form_id = ?").run(schema.id);
  await db.prepare("DELETE FROM form_template_rows WHERE form_id = ?").run(schema.id);

  const insCol = db.prepare(
    `INSERT INTO form_template_columns (
      form_id, sort_order, column_key, label, col_type, width, frozen, readonly, f_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      c.fTotal ? 1 : 0
    );
  }

  const insRow = db.prepare(
    `INSERT INTO form_template_rows (form_id, sort_order, row_num, row_code, row_name)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < schema.rows.length; i++) {
    const r = schema.rows[i];
    await insRow.run(schema.id, i, r.num ?? null, r.code ?? null, r.name);
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
      `SELECT form_id, title, category, pages, pdf_file, allow_add_rows, kontr_form, signatures_json
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
      }
    | undefined;

  if (!tpl) return null;

  const columns = (
    (await db
      .prepare(
        `SELECT column_key, label, col_type, width, frozen, readonly, f_total
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
    }>
  ).map((c) => ({
    key: c.column_key,
    label: c.label,
    type: c.col_type as "text" | "number",
    width: c.width,
    frozen: !!c.frozen,
    readonly: !!c.readonly,
    fTotal: !!c.f_total,
  }));

  const rows = (
    (await db
      .prepare(
        `SELECT row_num, row_code, row_name FROM form_template_rows
         WHERE form_id = ? ORDER BY sort_order`
      )
      .all(formId)) as Array<{ row_num: string | null; row_code: string | null; row_name: string }>
  ).map((r) => {
    const item: FormRowDto = { name: r.row_name };
    if (r.row_num) item.num = r.row_num;
    if (r.row_code) item.code = r.row_code;
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
      unit: "тыс.руб.",
    },
    columns,
    rows,
    signatures,
  };
  if (tpl.allow_add_rows) schema.allowAddRows = true;
  if (tpl.kontr_form) schema.kontrForm = true;
  return schema;
}

export async function exportCatalog(db: OkoDb): Promise<FormCatalogDto> {
  const rows = (await db
    .prepare(
      `SELECT form_id, title, category, pages, pdf_file FROM form_templates ORDER BY sort_order, form_id`
    )
    .all()) as Array<{
    form_id: string;
    title: string;
    category: string;
    pages: number;
    pdf_file: string | null;
  }>;

  const usedCats = new Set(rows.map((r) => r.category));
  const categories: Record<string, string> = {};
  for (const [k, v] of Object.entries(DEFAULT_CATEGORIES)) {
    if (usedCats.has(k)) categories[k] = v;
  }

  return {
    version: "2.0",
    name: "ОКО — Портал форм корпоративной отчётности",
    description: "Схемы форм из SQLite (a_stblROWs, a_stblFIELDs)",
    source: "sqlite:form_templates",
    categories,
    forms: rows.map((r) => ({
      id: r.form_id,
      title: r.title,
      category: r.category,
      pages: r.pages,
      pdfFile: r.pdf_file ?? `1@1_${r.form_id}.pdf`,
    })),
  };
}

export async function updateFormMeta(
  db: OkoDb,
  formId: string,
  patch: {
    title?: string;
    pages?: number;
    allowAddRows?: boolean;
    kontrForm?: boolean;
    signatures?: string[];
  }
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    fields.push("title = ?");
    values.push(patch.title);
  }
  if (patch.pages !== undefined) {
    fields.push("pages = ?");
    values.push(patch.pages);
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
  if (!fields.length) return;
  values.push(formId);
  await db.prepare(`UPDATE form_templates SET ${fields.join(", ")} WHERE form_id = ?`).run(...values);
}

export async function replaceFormColumns(
  db: OkoDb,
  formId: string,
  columns: FormColumnDto[]
): Promise<void> {
  await db.prepare("DELETE FROM form_template_columns WHERE form_id = ?").run(formId);
  const ins = db.prepare(
    `INSERT INTO form_template_columns (
      form_id, sort_order, column_key, label, col_type, width, frozen, readonly, f_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    await ins.run(
      formId,
      i,
      c.key,
      c.label,
      c.type,
      c.width ?? 100,
      c.frozen ? 1 : 0,
      c.readonly || c.fTotal ? 1 : 0,
      c.fTotal ? 1 : 0
    );
  }
}

export async function replaceFormRows(
  db: OkoDb,
  formId: string,
  rows: FormRowDto[]
): Promise<void> {
  await db.prepare("DELETE FROM form_template_rows WHERE form_id = ?").run(formId);
  const ins = db.prepare(
    `INSERT INTO form_template_rows (form_id, sort_order, row_num, row_code, row_name)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await ins.run(formId, i, r.num ?? null, r.code ?? null, r.name);
  }
}
