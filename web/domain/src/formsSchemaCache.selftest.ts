/**
 * Selftest: form schema in-memory cache invalidates after updates.
 * Uses an in-memory OkoDb stub (no PostgreSQL required).
 */
import assert from "node:assert/strict";
import type { OkoDb, OkoStatement, RunResult } from "./oko-db.js";
import {
  clearFormSchemaCache,
  loadFormSchema,
  updateFormMeta,
} from "./forms.js";

type Tpl = {
  form_id: string;
  title: string;
  category: string;
  pages: number;
  pdf_file: string | null;
  allow_add_rows: number;
  kontr_form: number;
  signatures_json: string;
  unit: string | null;
  archived: number;
  schema_version: number;
  sort_order: number;
};

type Col = {
  form_id: string;
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
  hidden: number;
  formula: string | null;
  sort_order: number;
};

type RowT = {
  form_id: string;
  row_num: string | null;
  row_code: string | null;
  row_name: string;
  row_kind: string;
  row_level: number;
  readonly: number;
  formula: string | null;
  sort_order: number;
};

class MemStatement implements OkoStatement {
  constructor(
    private readonly db: MemoryDb,
    private readonly sql: string
  ) {}

  async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
    const rows = await this.all<T>(...params);
    return rows[0];
  }

  async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
    const sql = this.sql.replace(/\s+/g, " ").trim();

    if (/FROM form_templates WHERE form_id IN/i.test(sql)) {
      const ids = new Set(params.map(String));
      return [...this.db.templates.values()].filter((t) => ids.has(t.form_id)) as unknown as T[];
    }
    if (/FROM form_templates WHERE form_id = \?/i.test(sql)) {
      const t = this.db.templates.get(String(params[0]));
      return t ? ([t] as unknown as T[]) : [];
    }
    if (/FROM form_template_columns/i.test(sql) && /form_id IN/i.test(sql)) {
      const ids = new Set(params.map(String));
      return this.db.columns
        .filter((c) => ids.has(c.form_id))
        .sort((a, b) => a.sort_order - b.sort_order) as unknown as T[];
    }
    if (/FROM form_template_rows/i.test(sql) && /form_id IN/i.test(sql)) {
      const ids = new Set(params.map(String));
      return this.db.rows
        .filter((r) => ids.has(r.form_id))
        .sort((a, b) => a.sort_order - b.sort_order) as unknown as T[];
    }
    return [];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const sql = this.sql.replace(/\s+/g, " ").trim();
    if (/UPDATE form_templates SET/i.test(sql)) {
      const formId = String(params[params.length - 1]);
      const t = this.db.templates.get(formId);
      if (!t) return { changes: 0 };
      // Only title/archived patches used in this selftest
      if (/title = \?/i.test(sql)) {
        t.title = String(params[0]);
      }
      if (/archived = \?/i.test(sql)) {
        const archivedIdx = [...sql.matchAll(/(\w+) = \?/g)].findIndex((m) => m[1] === "archived");
        if (archivedIdx >= 0) t.archived = Number(params[archivedIdx]) ? 1 : 0;
      }
      return { changes: 1 };
    }
    return { changes: 0 };
  }
}

class MemoryDb implements OkoDb {
  readonly dialect = "postgres" as const;
  templates = new Map<string, Tpl>();
  columns: Col[] = [];
  rows: RowT[] = [];

  prepare(sql: string): OkoStatement {
    return new MemStatement(this, sql);
  }

  async exec(_sql: string): Promise<void> {}
  async columnExists(): Promise<boolean> {
    return true;
  }
  async transaction<T>(fn: (tx: OkoDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function seedForm(db: MemoryDb, id: string, title: string): void {
  db.templates.set(id, {
    form_id: id,
    title,
    category: "N01",
    pages: 1,
    pdf_file: null,
    allow_add_rows: 0,
    kontr_form: 0,
    signatures_json: '["Руководитель"]',
    unit: "тыс.руб.",
    archived: 0,
    schema_version: 1,
    sort_order: 0,
  });
  db.columns.push({
    form_id: id,
    column_key: "num",
    label: "№",
    col_type: "text",
    width: 60,
    frozen: 1,
    readonly: 1,
    f_total: 0,
    help_text: null,
    align: null,
    decimals: null,
    hidden: 0,
    formula: null,
    sort_order: 0,
  });
  db.rows.push({
    form_id: id,
    row_num: "1",
    row_code: null,
    row_name: "Строка",
    row_kind: "data",
    row_level: 0,
    readonly: 0,
    formula: null,
    sort_order: 0,
  });
}

async function main(): Promise<void> {
  clearFormSchemaCache();
  const db = new MemoryDb();
  seedForm(db, "CACHE_T1", "Original");

  const first = await loadFormSchema(db, "CACHE_T1");
  assert.ok(first);
  assert.equal(first!.title, "Original");

  // Mutate DB under the cache, then load again — should still see cached title
  db.templates.get("CACHE_T1")!.title = "StaleIfCached";
  const cached = await loadFormSchema(db, "CACHE_T1");
  assert.equal(cached!.title, "Original", "cache should serve previous schema");

  // Proper update path must invalidate
  await updateFormMeta(db, "CACHE_T1", { title: "Updated" });
  const after = await loadFormSchema(db, "CACHE_T1");
  assert.equal(after!.title, "Updated", "load after updateFormMeta must return new version");

  // Missing forms must not be cached forever
  const missing = await loadFormSchema(db, "NO_SUCH_FORM");
  assert.equal(missing, null);
  seedForm(db, "NO_SUCH_FORM", "Appeared");
  const appeared = await loadFormSchema(db, "NO_SUCH_FORM");
  assert.ok(appeared);
  assert.equal(appeared!.title, "Appeared");

  clearFormSchemaCache();
  console.log("formsSchemaCache.selftest: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
