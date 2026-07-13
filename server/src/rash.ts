import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";

export interface RashRuleRow {
  kod: number;
  name: string;
  note: string | null;
  ref_rows: string | null;
  total_formula: string | null;
  ref_a1_name: string | null;
  ref_a1_title: string | null;
  ref_a2_name: string | null;
  ref_a2_title: string | null;
  ref_a3_name: string | null;
  ref_a3_title: string | null;
  ref_a4_name: string | null;
  ref_a4_title: string | null;
}

export interface RashAddsumRow {
  id: number;
  kod: number;
  sort_order: number;
  sum_title: string;
  fld_type: string;
}

export interface RashRuleDto {
  kod: number;
  name: string;
  note?: string | null;
  refRows?: string | null;
  totalFormula?: string | null;
  refA1Name?: string | null;
  refA1Title?: string | null;
  refA2Name?: string | null;
  refA2Title?: string | null;
  refA3Name?: string | null;
  refA3Title?: string | null;
  refA4Name?: string | null;
  refA4Title?: string | null;
}

export interface RashAddsumDto {
  id?: number;
  kod: number;
  sort: number;
  sumTitle: string;
  fldType: string;
}

export interface RashThresholdsDto {
  level1: number;
  level2: number;
  level3: number;
  unit: string;
  labels: string[];
}

const RASH_JSON = path.join(ROOT, "portal", "public", "data", "rash-rules.json");

const DEFAULT_THRESHOLDS: RashThresholdsDto = {
  level1: 1,
  level2: 5000,
  level3: 50000,
  unit: "тыс.руб.",
  labels: ["1 тыс. руб.", "5 млн руб.", "50 млн руб."],
};

const ROW_RASH_JSON = path.join(ROOT, "portal", "public", "data", "row-rash-index.json");

export interface RashPlacementDto {
  formId: string;
  rowNo: string;
  /** Empty string = defaultKod for the row (Access row-level binding). */
  columnKey: string;
  kod: number;
}

export interface RowRashIndexPayload {
  version: string;
  source?: string;
  forms: Record<
    string,
    Record<string, { defaultKod?: number; columns?: Record<string, number> }>
  >;
  stats?: { forms: number; rows: number; placements: number };
}

export async function migrateRashTables(db: OkoDb): Promise<void> {
  await db.exec(`
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
  `);
}

function rowToDto(row: RashRuleRow): RashRuleDto {
  return {
    kod: row.kod,
    name: row.name,
    note: row.note,
    refRows: row.ref_rows,
    totalFormula: row.total_formula,
    refA1Name: row.ref_a1_name,
    refA1Title: row.ref_a1_title,
    refA2Name: row.ref_a2_name,
    refA2Title: row.ref_a2_title,
    refA3Name: row.ref_a3_name,
    refA3Title: row.ref_a3_title,
    refA4Name: row.ref_a4_name,
    refA4Title: row.ref_a4_title,
  };
}

function dtoToRow(dto: RashRuleDto): RashRuleRow {
  return {
    kod: dto.kod,
    name: dto.name,
    note: dto.note ?? null,
    ref_rows: dto.refRows ?? null,
    total_formula: dto.totalFormula ?? null,
    ref_a1_name: dto.refA1Name ?? null,
    ref_a1_title: dto.refA1Title ?? null,
    ref_a2_name: dto.refA2Name ?? null,
    ref_a2_title: dto.refA2Title ?? null,
    ref_a3_name: dto.refA3Name ?? null,
    ref_a3_title: dto.refA3Title ?? null,
    ref_a4_name: dto.refA4Name ?? null,
    ref_a4_title: dto.refA4Title ?? null,
  };
}

function addsumRowToDto(row: RashAddsumRow): RashAddsumDto {
  return {
    id: row.id,
    kod: row.kod,
    sort: row.sort_order,
    sumTitle: row.sum_title,
    fldType: row.fld_type,
  };
}

function formIdFromRashRefRow(ref: string): string {
  const parts = ref.trim().split("_");
  if (parts.length < 2) return ref.trim();
  if (parts[0].startsWith("N") && parts.length >= 3) {
    return `${parts[0]}_${parts[1]}`;
  }
  return ref.trim();
}

export function rashRuleMatchesForm(
  rule: Pick<RashRuleDto, "name" | "refRows">,
  formId: string
): boolean {
  const name = rule.name ?? "";
  if (name === formId || name.startsWith(`${formId}_`)) return true;
  if (!rule.refRows) return false;
  return rule.refRows.split(",").some((token) => {
    const trimmed = token.trim();
    if (!trimmed) return false;
    const fid = formIdFromRashRefRow(trimmed);
    return fid === formId || trimmed === formId || trimmed.startsWith(`${formId}_`);
  });
}

function loadJsonPayload(): {
  rules: RashRuleDto[];
  addsum: RashAddsumDto[];
  thresholds?: RashThresholdsDto;
} | null {
  if (!fs.existsSync(RASH_JSON)) return null;
  const data = JSON.parse(fs.readFileSync(RASH_JSON, "utf-8")) as {
    rules: RashRuleDto[];
    addsum: RashAddsumDto[];
    thresholds?: RashThresholdsDto;
  };
  return data;
}

async function importPayload(
  db: OkoDb,
  data: ReturnType<typeof loadJsonPayload>
): Promise<number> {
  if (!data) return 0;

  return db.transaction(async (tx) => {
    const insertRule = tx.prepare(
      `INSERT INTO rash_rules (
      kod, name, note, ref_rows, total_formula,
      ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
      ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertAddsum = tx.prepare(
      `INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type)
     VALUES (?, ?, ?, ?)`
    );

    await tx.exec("DELETE FROM rash_addsum");
    await tx.exec("DELETE FROM rash_rules");
    for (const rule of data.rules) {
      const r = dtoToRow(rule);
      await insertRule.run(
        r.kod,
        r.name,
        r.note,
        r.ref_rows,
        r.total_formula,
        r.ref_a1_name,
        r.ref_a1_title,
        r.ref_a2_name,
        r.ref_a2_title,
        r.ref_a3_name,
        r.ref_a3_title,
        r.ref_a4_name,
        r.ref_a4_title
      );
    }
    for (const item of data.addsum) {
      await insertAddsum.run(item.kod, item.sort, item.sumTitle, item.fldType);
    }
    if (data.thresholds) {
      const upsert = tx.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      await upsert.run("rashThresholds", JSON.stringify(data.thresholds));
    }
    return data.rules.length;
  });
}

export async function seedRashFromJson(db: OkoDb): Promise<number> {
  const count = (await db.prepare("SELECT COUNT(*) AS c FROM rash_rules").get()) as { c: number };
  if (count.c > 0) return 0;
  return importPayload(db, loadJsonPayload());
}

export async function reimportRashFromJson(db: OkoDb): Promise<number> {
  return importPayload(db, loadJsonPayload());
}

export async function getRashStats(db: OkoDb) {
  const total = ((await db.prepare("SELECT COUNT(*) AS c FROM rash_rules").get()) as { c: number }).c;
  const addsum = ((await db.prepare("SELECT COUNT(*) AS c FROM rash_addsum").get()) as { c: number })
    .c;
  const withFormula = (
    (await db
      .prepare(
        "SELECT COUNT(*) AS c FROM rash_rules WHERE total_formula IS NOT NULL AND total_formula <> ''"
      )
      .get()) as { c: number }
  ).c;
  return { total, addsum, withFormula };
}

export async function getRashThresholds(db: OkoDb): Promise<RashThresholdsDto> {
  const row = (await db.prepare("SELECT value FROM app_settings WHERE key = 'rashThresholds'").get()) as
    | { value: string }
    | undefined;
  if (row) {
    try {
      return JSON.parse(row.value) as RashThresholdsDto;
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_THRESHOLDS;
}

export async function setRashThresholds(
  db: OkoDb,
  thresholds: RashThresholdsDto
): Promise<RashThresholdsDto> {
  await db
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES ('rashThresholds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(JSON.stringify(thresholds));
  return thresholds;
}

export async function exportRashPayload(db: OkoDb) {
  const rules = (
    (await db
      .prepare(
        `SELECT kod, name, note, ref_rows, total_formula,
                ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
                ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
         FROM rash_rules ORDER BY kod`
      )
      .all()) as RashRuleRow[]
  ).map(rowToDto);

  const addsum = (
    (await db
      .prepare(
        "SELECT id, kod, sort_order, sum_title, fld_type FROM rash_addsum ORDER BY kod, sort_order"
      )
      .all()) as RashAddsumRow[]
  ).map(addsumRowToDto);

  return {
    version: "1.0",
    source: "sqlite",
    total: rules.length,
    rules,
    addsum,
    thresholds: await getRashThresholds(db),
  };
}

export interface ListRashRulesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  formId?: string;
}

export async function listRashRules(db: OkoDb, options: ListRashRulesOptions = {}) {
  const limit = Math.min(options.limit ?? 50, 500);
  const offset = options.offset ?? 0;
  const q = (options.q ?? "").trim();
  const formId = (options.formId ?? "").trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push("(CAST(kod AS TEXT) LIKE ? OR name LIKE ? OR note LIKE ? OR ref_rows LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (formId) {
    conditions.push("(name = ? OR name LIKE ? OR ref_rows LIKE ?)");
    params.push(formId, `${formId}_%`, `%${formId}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    await db.prepare(`SELECT COUNT(*) AS c FROM rash_rules ${where}`).get(...params)
  )?.c as number;

  const rows = (await db
    .prepare(
      `SELECT kod, name, note, ref_rows, total_formula,
              ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
              ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
       FROM rash_rules ${where}
       ORDER BY kod
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as RashRuleRow[];

  return { total, limit, offset, items: rows.map(rowToDto) };
}

export async function getRashRule(db: OkoDb, kod: number): Promise<RashRuleDto | null> {
  const row = (await db
    .prepare(
      `SELECT kod, name, note, ref_rows, total_formula,
              ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
              ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
       FROM rash_rules WHERE kod = ?`
    )
    .get(kod)) as RashRuleRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function listRashAddsum(db: OkoDb, kod: number): Promise<RashAddsumDto[]> {
  const rows = (await db
    .prepare(
      "SELECT id, kod, sort_order, sum_title, fld_type FROM rash_addsum WHERE kod = ? ORDER BY sort_order"
    )
    .all(kod)) as RashAddsumRow[];
  return rows.map(addsumRowToDto);
}

export async function upsertRashRule(db: OkoDb, dto: RashRuleDto): Promise<RashRuleDto> {
  const r = dtoToRow(dto);
  await db
    .prepare(
      `INSERT INTO rash_rules (
      kod, name, note, ref_rows, total_formula,
      ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
      ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kod) DO UPDATE SET
      name = excluded.name,
      note = excluded.note,
      ref_rows = excluded.ref_rows,
      total_formula = excluded.total_formula,
      ref_a1_name = excluded.ref_a1_name,
      ref_a1_title = excluded.ref_a1_title,
      ref_a2_name = excluded.ref_a2_name,
      ref_a2_title = excluded.ref_a2_title,
      ref_a3_name = excluded.ref_a3_name,
      ref_a3_title = excluded.ref_a3_title,
      ref_a4_name = excluded.ref_a4_name,
      ref_a4_title = excluded.ref_a4_title`
    )
    .run(
      r.kod,
      r.name,
      r.note,
      r.ref_rows,
      r.total_formula,
      r.ref_a1_name,
      r.ref_a1_title,
      r.ref_a2_name,
      r.ref_a2_title,
      r.ref_a3_name,
      r.ref_a3_title,
      r.ref_a4_name,
      r.ref_a4_title
    );
  return dto;
}

export async function deleteRashRule(db: OkoDb, kod: number): Promise<boolean> {
  await db.prepare("DELETE FROM rash_placements WHERE kod = ?").run(kod);
  await db.prepare("DELETE FROM rash_addsum WHERE kod = ?").run(kod);
  const result = await db.prepare("DELETE FROM rash_rules WHERE kod = ?").run(kod);
  return result.changes > 0;
}

export async function replaceRashAddsum(
  db: OkoDb,
  kod: number,
  items: RashAddsumDto[]
): Promise<RashAddsumDto[]> {
  const rule = await getRashRule(db, kod);
  if (!rule) throw new Error(`rash rule ${kod} not found`);

  return db.transaction(async (tx) => {
    await tx.prepare("DELETE FROM rash_addsum WHERE kod = ?").run(kod);
    const insert = tx.prepare(
      "INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type) VALUES (?, ?, ?, ?)"
    );
    const sorted = [...items].sort((a, b) => a.sort - b.sort);
    for (const [i, item] of sorted.entries()) {
      await insert.run(kod, item.sort ?? i, item.sumTitle, item.fldType || "Сумма");
    }
    return listRashAddsum(tx, kod);
  });
}

function normalizeColumnKey(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v || v === "*" || v === "DEFAULT") return "";
  return v;
}

function flattenRowRashIndex(data: RowRashIndexPayload): RashPlacementDto[] {
  const out: RashPlacementDto[] = [];
  for (const [formId, rows] of Object.entries(data.forms ?? {})) {
    for (const [rowNo, meta] of Object.entries(rows ?? {})) {
      const cols = meta.columns ?? {};
      const colEntries = Object.entries(cols);
      if (colEntries.length > 0) {
        for (const [col, kod] of colEntries) {
          out.push({
            formId,
            rowNo: String(rowNo),
            columnKey: normalizeColumnKey(col),
            kod: Number(kod),
          });
        }
      } else if (meta.defaultKod != null) {
        out.push({
          formId,
          rowNo: String(rowNo),
          columnKey: "",
          kod: Number(meta.defaultKod),
        });
      }
    }
  }
  return out;
}

async function insertPlacements(db: OkoDb, items: RashPlacementDto[]): Promise<number> {
  const insert = db.prepare(
    `INSERT INTO rash_placements (form_id, row_no, column_key, kod)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (form_id, row_no, column_key) DO UPDATE SET kod = excluded.kod`
  );
  let n = 0;
  for (const item of items) {
    if (!item.formId?.trim() || item.kod == null || Number.isNaN(Number(item.kod))) continue;
    await insert.run(
      item.formId.trim(),
      String(item.rowNo).trim(),
      normalizeColumnKey(item.columnKey),
      Number(item.kod)
    );
    n++;
  }
  return n;
}

export async function seedPlacementsFromJson(db: OkoDb): Promise<number> {
  const count = (
    (await db.prepare("SELECT COUNT(*) AS c FROM rash_placements").get()) as { c: number }
  ).c;
  if (count > 0) return 0;
  const rules = (
    (await db.prepare("SELECT COUNT(*) AS c FROM rash_rules").get()) as { c: number }
  ).c;
  if (rules === 0) return 0;
  if (!fs.existsSync(ROW_RASH_JSON)) return 0;
  const data = JSON.parse(fs.readFileSync(ROW_RASH_JSON, "utf-8")) as RowRashIndexPayload;
  return insertPlacements(db, flattenRowRashIndex(data));
}

export async function reimportPlacementsFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(ROW_RASH_JSON)) return 0;
  const data = JSON.parse(fs.readFileSync(ROW_RASH_JSON, "utf-8")) as RowRashIndexPayload;
  return db.transaction(async (tx) => {
    await tx.exec("DELETE FROM rash_placements");
    return insertPlacements(tx, flattenRowRashIndex(data));
  });
}

export async function listPlacementsByKod(db: OkoDb, kod: number): Promise<RashPlacementDto[]> {
  const rows = (await db
    .prepare(
      `SELECT form_id, row_no, column_key, kod FROM rash_placements
       WHERE kod = ? ORDER BY form_id, row_no, column_key`
    )
    .all(kod)) as Array<{
    form_id: string;
    row_no: string;
    column_key: string;
    kod: number;
  }>;
  return rows.map((r) => ({
    formId: r.form_id,
    rowNo: String(r.row_no),
    columnKey: r.column_key ?? "",
    kod: r.kod,
  }));
}

export async function replacePlacementsForKod(
  db: OkoDb,
  kod: number,
  items: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>
): Promise<RashPlacementDto[]> {
  const rule = await getRashRule(db, kod);
  if (!rule) throw new Error(`rash rule ${kod} not found`);

  return db.transaction(async (tx) => {
    await tx.prepare("DELETE FROM rash_placements WHERE kod = ?").run(kod);
    await insertPlacements(
      tx,
      items.map((item) => ({
        formId: item.formId,
        rowNo: String(item.rowNo),
        columnKey: item.columnKey ?? "",
        kod,
      }))
    );
    return listPlacementsByKod(tx, kod);
  });
}

export async function exportRowRashIndex(db: OkoDb): Promise<RowRashIndexPayload> {
  const rows = (await db
    .prepare(
      `SELECT form_id, row_no, column_key, kod FROM rash_placements
       ORDER BY form_id, row_no, column_key`
    )
    .all()) as Array<{
    form_id: string;
    row_no: string;
    column_key: string;
    kod: number;
  }>;

  const forms: RowRashIndexPayload["forms"] = {};
  for (const r of rows) {
    const formId = r.form_id;
    const rowNo = String(r.row_no);
    if (!forms[formId]) forms[formId] = {};
    if (!forms[formId][rowNo]) forms[formId][rowNo] = {};
    const meta = forms[formId][rowNo];
    const col = (r.column_key ?? "").trim().toUpperCase();
    if (!col) {
      meta.defaultKod = r.kod;
    } else {
      if (!meta.columns) meta.columns = {};
      meta.columns[col] = r.kod;
    }
  }

  return {
    version: "1.0",
    source: "db:rash_placements",
    forms,
    stats: {
      forms: Object.keys(forms).length,
      rows: Object.values(forms).reduce((n, rowsMap) => n + Object.keys(rowsMap).length, 0),
      placements: rows.length,
    },
  };
}

export { rowToDto, dtoToRow };
