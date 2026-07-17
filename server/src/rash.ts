import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";
import {
  bumpFormSchemaVersion,
  loadFormSchema,
  replaceFormColumns,
  replaceFormRows,
  type FormColumnDto,
  type FormRowDto,
} from "./forms.js";

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
  is_active: number;
}

export interface RashAddsumRow {
  id: number;
  kod: number;
  sort_order: number;
  sum_title: string;
  fld_type: string;
  required: number;
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
  isActive?: boolean;
}

export interface RashAddsumDto {
  id?: number;
  kod: number;
  sort: number;
  sumTitle: string;
  fldType: string;
  required?: boolean;
}

export type RashModalRowMode = "dynamic" | "fixed" | "mixed";

export interface RashModalSettingsDto {
  rowMode: RashModalRowMode;
}

export interface RashModalRowDto {
  id?: number;
  kod: number;
  rowKey: string;
  label: string;
  sort: number;
  required: boolean;
  sourceFormId?: string | null;
  sourceRowNo?: string | null;
}

export interface RashListItemDto extends RashRuleDto {
  formIds: string[];
  placementCount: number;
  addsumCount: number;
  rowMode: RashModalRowMode;
  fixedRowCount: number;
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
    isActive: row.is_active !== 0,
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
    is_active: dto.isActive === false ? 0 : 1,
  };
}

function addsumRowToDto(row: RashAddsumRow): RashAddsumDto {
  return {
    id: row.id,
    kod: row.kod,
    sort: row.sort_order,
    sumTitle: row.sum_title,
    fldType: row.fld_type,
    required: row.required !== 0,
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
      ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertAddsum = tx.prepare(
      `INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type, required)
     VALUES (?, ?, ?, ?, ?)`
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
        r.ref_a4_title,
        r.is_active
      );
    }
    for (const item of data.addsum) {
      await insertAddsum.run(
        item.kod,
        item.sort,
        item.sumTitle,
        item.fldType,
        item.required ? 1 : 0
      );
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
                ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title, is_active
         FROM rash_rules ORDER BY kod`
      )
      .all()) as RashRuleRow[]
  ).map(rowToDto);

  const addsum = (
    (await db
      .prepare(
        "SELECT id, kod, sort_order, sum_title, fld_type, required FROM rash_addsum ORDER BY kod, sort_order"
      )
      .all()) as RashAddsumRow[]
  ).map(addsumRowToDto);

  const modalSettings: Record<string, RashModalSettingsDto> = {};
  const modalRows: RashModalRowDto[] = [];
  for (const rule of rules) {
    modalSettings[String(rule.kod)] = await getRashModalSettings(db, rule.kod);
    modalRows.push(...(await listRashModalRows(db, rule.kod)));
  }

  return {
    version: "1.0",
    source: "sqlite",
    total: rules.length,
    rules,
    addsum,
    modalSettings,
    modalRows,
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
    conditions.push(`(
      name = ? OR name LIKE ? OR ref_rows LIKE ?
      OR kod IN (SELECT kod FROM rash_placements WHERE form_id = ?)
    )`);
    params.push(formId, `${formId}_%`, `%${formId}%`, formId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    await db.prepare(`SELECT COUNT(*) AS c FROM rash_rules ${where}`).get(...params)
  )?.c as number;

  const rows = (await db
    .prepare(
      `SELECT r.kod, r.name, r.note, r.ref_rows, r.total_formula,
              r.ref_a1_name, r.ref_a1_title, r.ref_a2_name, r.ref_a2_title,
              r.ref_a3_name, r.ref_a3_title, r.ref_a4_name, r.ref_a4_title, r.is_active,
              (SELECT COUNT(*) FROM rash_placements p WHERE p.kod = r.kod) AS placement_count,
              (SELECT COUNT(*) FROM rash_addsum a WHERE a.kod = r.kod) AS addsum_count,
              (SELECT COUNT(*) FROM rash_modal_rows mr WHERE mr.kod = r.kod) AS fixed_row_count,
              COALESCE((SELECT row_mode FROM rash_modal_settings ms WHERE ms.kod = r.kod), 'dynamic') AS row_mode,
              COALESCE((SELECT STRING_AGG(DISTINCT p.form_id, ',') FROM rash_placements p WHERE p.kod = r.kod), '') AS form_ids
       FROM rash_rules r ${where}
       ORDER BY r.kod DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as Array<
    RashRuleRow & {
      placement_count: number;
      addsum_count: number;
      fixed_row_count: number;
      row_mode: RashModalRowMode;
      form_ids: string;
    }
  >;

  const items: RashListItemDto[] = rows.map((row) => ({
    ...rowToDto(row),
    formIds: row.form_ids ? row.form_ids.split(",").filter(Boolean).sort() : [],
    placementCount: Number(row.placement_count ?? 0),
    addsumCount: Number(row.addsum_count ?? 0),
    fixedRowCount: Number(row.fixed_row_count ?? 0),
    rowMode: row.row_mode ?? "dynamic",
  }));
  return { total, limit, offset, items };
}

export async function getRashRule(db: OkoDb, kod: number): Promise<RashRuleDto | null> {
  const row = (await db
    .prepare(
      `SELECT kod, name, note, ref_rows, total_formula,
              ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
              ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title, is_active
       FROM rash_rules WHERE kod = ?`
    )
    .get(kod)) as RashRuleRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function listRashAddsum(db: OkoDb, kod: number): Promise<RashAddsumDto[]> {
  const rows = (await db
    .prepare(
      "SELECT id, kod, sort_order, sum_title, fld_type, required FROM rash_addsum WHERE kod = ? ORDER BY sort_order"
    )
    .all(kod)) as RashAddsumRow[];
  return rows.map(addsumRowToDto);
}

export async function getRashModalSettings(
  db: OkoDb,
  kod: number
): Promise<RashModalSettingsDto> {
  const row = (await db
    .prepare("SELECT row_mode FROM rash_modal_settings WHERE kod = ?")
    .get(kod)) as { row_mode: RashModalRowMode } | undefined;
  return { rowMode: row?.row_mode ?? "dynamic" };
}

export async function listRashModalRows(
  db: OkoDb,
  kod: number
): Promise<RashModalRowDto[]> {
  const rows = (await db
    .prepare(
      `SELECT id, kod, row_key, label, sort_order, required, source_form_id, source_row_no
       FROM rash_modal_rows WHERE kod = ? ORDER BY sort_order, id`
    )
    .all(kod)) as Array<{
    id: number;
    kod: number;
    row_key: string;
    label: string;
    sort_order: number;
    required: number;
    source_form_id: string | null;
    source_row_no: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    kod: row.kod,
    rowKey: row.row_key,
    label: row.label,
    sort: row.sort_order,
    required: row.required !== 0,
    sourceFormId: row.source_form_id,
    sourceRowNo: row.source_row_no,
  }));
}

export async function replaceRashModalLayout(
  db: OkoDb,
  kod: number,
  settings: RashModalSettingsDto,
  rows: RashModalRowDto[]
): Promise<{ settings: RashModalSettingsDto; rows: RashModalRowDto[] }> {
  const rowMode: RashModalRowMode = ["fixed", "mixed"].includes(settings.rowMode)
    ? settings.rowMode
    : "dynamic";
  await db
    .prepare(
      `INSERT INTO rash_modal_settings (kod, row_mode) VALUES (?, ?)
       ON CONFLICT(kod) DO UPDATE SET row_mode = excluded.row_mode`
    )
    .run(kod, rowMode);
  await db.prepare("DELETE FROM rash_modal_rows WHERE kod = ?").run(kod);
  const insert = db.prepare(
    `INSERT INTO rash_modal_rows (
       kod, row_key, label, sort_order, required, source_form_id, source_row_no
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const rowKey = item.rowKey.trim();
    if (!rowKey || seen.has(rowKey)) continue;
    seen.add(rowKey);
    await insert.run(
      kod,
      rowKey,
      item.label.trim() || rowKey,
      item.sort ?? i,
      item.required ? 1 : 0,
      item.sourceFormId?.trim() || null,
      item.sourceRowNo?.trim() || null
    );
  }
  return {
    settings: { rowMode },
    rows: await listRashModalRows(db, kod),
  };
}

export async function upsertRashRule(db: OkoDb, dto: RashRuleDto): Promise<RashRuleDto> {
  const r = dtoToRow(dto);
  await db
    .prepare(
      `INSERT INTO rash_rules (
      kod, name, note, ref_rows, total_formula,
      ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
      ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      ref_a4_title = excluded.ref_a4_title,
      is_active = excluded.is_active`
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
      r.ref_a4_title,
      r.is_active
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
      "INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type, required) VALUES (?, ?, ?, ?, ?)"
    );
    const sorted = [...items].sort((a, b) => a.sort - b.sort);
    for (const [i, item] of sorted.entries()) {
      await insert.run(
        kod,
        item.sort ?? i,
        item.sumTitle,
        item.fldType || "Сумма",
        item.required ? 1 : 0
      );
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

export async function listPlacementsByForm(
  db: OkoDb,
  formId: string
): Promise<RashPlacementDto[]> {
  const fid = formId.trim();
  if (!fid) return [];
  const rows = (await db
    .prepare(
      `SELECT form_id, row_no, column_key, kod FROM rash_placements
       WHERE form_id = ? ORDER BY row_no, column_key, kod`
    )
    .all(fid)) as Array<{
    form_id: string;
    row_no: string;
    column_key: string;
    kod: number;
  }>;
  return rows.map((row) => ({
    formId: row.form_id,
    rowNo: String(row.row_no),
    columnKey: row.column_key ?? "",
    kod: row.kod,
  }));
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

export interface RashPlacementConflict {
  formId: string;
  rowNo: string;
  columnKey: string;
  existingKod: number;
}

export interface RashFormAdditionDto {
  formId: string;
  rows?: Array<{ num: string; name?: string }>;
  columns?: Array<{ key: string; label?: string; type?: "text" | "number" }>;
}

export interface RashBundleStructurePreview {
  missingRows: Array<{ formId: string; rowNo: string; name: string }>;
  missingColumns: Array<{ formId: string; columnKey: string; label: string }>;
}

export async function previewRashBundleStructure(
  db: OkoDb,
  placements: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>,
  additions: RashFormAdditionDto[] = []
): Promise<RashBundleStructurePreview> {
  const byForm = new Map(additions.map((item) => [item.formId, item]));
  const missingRows: RashBundleStructurePreview["missingRows"] = [];
  const missingColumns: RashBundleStructurePreview["missingColumns"] = [];
  const seenRows = new Set<string>();
  const seenCols = new Set<string>();

  for (const placement of placements) {
    const formId = placement.formId?.trim();
    const rowNo = String(placement.rowNo ?? "").trim();
    const columnKey = normalizeColumnKey(placement.columnKey);
    if (!formId || !rowNo) continue;
    const schema = await loadFormSchema(db, formId);
    if (!schema) throw new Error(`Форма ${formId} не найдена`);
    const requested = byForm.get(formId);
    if (!schema.rows.some((row) => String(row.num ?? "").trim() === rowNo)) {
      const key = `${formId}:${rowNo}`;
      if (!seenRows.has(key)) {
        const draft = requested?.rows?.find((row) => row.num.trim() === rowNo);
        missingRows.push({
          formId,
          rowNo,
          name: draft?.name?.trim() || `Новая строка ${rowNo}`,
        });
        seenRows.add(key);
      }
    }
    if (
      columnKey &&
      !schema.columns.some((column) => column.key.toUpperCase() === columnKey.toUpperCase())
    ) {
      const key = `${formId}:${columnKey}`;
      if (!seenCols.has(key)) {
        const draft = requested?.columns?.find(
          (column) => column.key.trim().toUpperCase() === columnKey
        );
        missingColumns.push({
          formId,
          columnKey,
          label: draft?.label?.trim() || `Графа ${columnKey}`,
        });
        seenCols.add(key);
      }
    }
  }
  return { missingRows, missingColumns };
}

async function applyRashFormAdditions(
  db: OkoDb,
  preview: RashBundleStructurePreview
): Promise<void> {
  const formIds = [
    ...new Set([
      ...preview.missingRows.map((item) => item.formId),
      ...preview.missingColumns.map((item) => item.formId),
    ]),
  ];
  for (const formId of formIds) {
    const schema = await loadFormSchema(db, formId);
    if (!schema) throw new Error(`Форма ${formId} не найдена`);
    const rows: FormRowDto[] = [...schema.rows];
    for (const item of preview.missingRows.filter((row) => row.formId === formId)) {
      if (!rows.some((row) => String(row.num ?? "").trim() === item.rowNo)) {
        rows.push({ num: item.rowNo, name: item.name, kind: "data" });
      }
    }
    const columns: FormColumnDto[] = [...schema.columns];
    for (const item of preview.missingColumns.filter((column) => column.formId === formId)) {
      if (!columns.some((column) => column.key.toUpperCase() === item.columnKey)) {
        columns.push({
          key: item.columnKey,
          label: item.label,
          type: "number",
          width: 110,
        });
      }
    }
    await replaceFormRows(db, formId, rows, { bumpVersion: false });
    await replaceFormColumns(db, formId, columns, { bumpVersion: false });
    await bumpFormSchemaVersion(db, formId, "rash-constructor");
  }
}

export async function findPlacementConflicts(
  db: OkoDb,
  kod: number,
  items: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>
): Promise<RashPlacementConflict[]> {
  const conflicts: RashPlacementConflict[] = [];
  const q = db.prepare(
    `SELECT form_id, row_no, column_key, kod FROM rash_placements
     WHERE form_id = ? AND row_no = ? AND column_key = ? AND kod <> ?`
  );
  for (const item of items) {
    if (!item.formId?.trim() || item.rowNo == null || String(item.rowNo).trim() === "") continue;
    const row = (await q.get(
      item.formId.trim(),
      String(item.rowNo).trim(),
      normalizeColumnKey(item.columnKey),
      kod
    )) as
      | { form_id: string; row_no: string; column_key: string; kod: number }
      | undefined;
    if (row) {
      conflicts.push({
        formId: row.form_id,
        rowNo: String(row.row_no),
        columnKey: row.column_key ?? "",
        existingKod: row.kod,
      });
    }
  }
  return conflicts;
}

export async function saveRashBundle(
  db: OkoDb,
  payload: {
    rule: RashRuleDto;
    addsum?: RashAddsumDto[];
    placements?: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>;
    modalSettings?: RashModalSettingsDto;
    modalRows?: RashModalRowDto[];
    formAdditions?: RashFormAdditionDto[];
    createMissingFormParts?: boolean;
    forceConflicts?: boolean;
  }
): Promise<{
  rule: RashRuleDto;
  addsum: RashAddsumDto[];
  placements: RashPlacementDto[];
  modalSettings: RashModalSettingsDto;
  modalRows: RashModalRowDto[];
  structurePreview: RashBundleStructurePreview;
  conflicts: RashPlacementConflict[];
}> {
  const { rule } = payload;
  if (!rule?.kod || !rule.name?.trim()) {
    throw new Error("kod and name required");
  }
  const placements = payload.placements ?? [];
  const structurePreview = await previewRashBundleStructure(
    db,
    placements,
    payload.formAdditions
  );
  if (
    !payload.createMissingFormParts &&
    (structurePreview.missingRows.length > 0 || structurePreview.missingColumns.length > 0)
  ) {
    const err = new Error("В привязках есть строки или графы, которых нет в шаблонах форм");
    (
      err as Error & {
        structurePreview?: RashBundleStructurePreview;
      }
    ).structurePreview = structurePreview;
    throw err;
  }
  const conflicts = await findPlacementConflicts(db, rule.kod, placements);
  if (conflicts.length && !payload.forceConflicts) {
    const err = new Error(
      `Конфликт привязок: ${conflicts
        .slice(0, 3)
        .map((c) => `${c.formId}/${c.rowNo}/${c.columnKey || "*"}→${c.existingKod}`)
        .join("; ")}`
    );
    (err as Error & { conflicts?: RashPlacementConflict[] }).conflicts = conflicts;
    throw err;
  }

  return db.transaction(async (tx) => {
    if (payload.createMissingFormParts) {
      await applyRashFormAdditions(tx, structurePreview);
    }
    await upsertRashRule(tx, rule);

    await tx.prepare("DELETE FROM rash_addsum WHERE kod = ?").run(rule.kod);
    const insertAdd = tx.prepare(
      "INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type, required) VALUES (?, ?, ?, ?, ?)"
    );
    const sortedAdd = [...(payload.addsum ?? [])].sort((a, b) => a.sort - b.sort);
    for (const [i, item] of sortedAdd.entries()) {
      await insertAdd.run(
        rule.kod,
        item.sort ?? i,
        item.sumTitle,
        item.fldType || "Сумма",
        item.required ? 1 : 0
      );
    }

    if (payload.forceConflicts) {
      for (const c of conflicts) {
        await tx
          .prepare(
            `DELETE FROM rash_placements
             WHERE form_id = ? AND row_no = ? AND column_key = ? AND kod = ?`
          )
          .run(c.formId, c.rowNo, normalizeColumnKey(c.columnKey), c.existingKod);
      }
    }

    await tx.prepare("DELETE FROM rash_placements WHERE kod = ?").run(rule.kod);
    await insertPlacements(
      tx,
      placements.map((item) => ({
        formId: item.formId,
        rowNo: String(item.rowNo),
        columnKey: item.columnKey ?? "",
        kod: rule.kod,
      }))
    );
    const layout = await replaceRashModalLayout(
      tx,
      rule.kod,
      payload.modalSettings ?? { rowMode: "dynamic" },
      payload.modalRows ?? []
    );

    return {
      rule: (await getRashRule(tx, rule.kod)) ?? rule,
      addsum: await listRashAddsum(tx, rule.kod),
      placements: await listPlacementsByKod(tx, rule.kod),
      modalSettings: layout.settings,
      modalRows: layout.rows,
      structurePreview,
      conflicts,
    };
  });
}

export async function getRashRuleUsage(db: OkoDb, kod: number): Promise<{
  kod: number;
  placementCount: number;
  forms: string[];
  samplePlacements: RashPlacementDto[];
  entryCount: number;
  instanceCount: number;
}> {
  const placements = await listPlacementsByKod(db, kod);
  const forms = [...new Set(placements.map((p) => p.formId))].sort();
  let entryCount = 0;
  let instanceCount = 0;
  try {
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT instance_id) AS ic
         FROM form_rash_entries WHERE rash_kod = ?`
      )
      .get(kod)) as { c: number; ic: number };
    entryCount = Number(row?.c ?? 0);
    instanceCount = Number(row?.ic ?? 0);
  } catch {
    /* table may be empty / missing in some boots */
  }
  return {
    kod,
    placementCount: placements.length,
    forms,
    samplePlacements: placements.slice(0, 40),
    entryCount,
    instanceCount,
  };
}

export async function suggestNextRashKod(db: OkoDb): Promise<number> {
  const row = (await db.prepare("SELECT COALESCE(MAX(kod), 90000) AS m FROM rash_rules").get()) as {
    m: number;
  };
  let next = Math.max(90001, Number(row.m) + 1);
  const reserved = new Set([0, 1, 2, 3, 4, 6]);
  while (reserved.has(next)) next += 1;
  return next;
}

function ruleFingerprint(r: RashRuleDto): string {
  return JSON.stringify({
    name: r.name ?? "",
    note: r.note ?? null,
    refRows: r.refRows ?? null,
    totalFormula: r.totalFormula ?? null,
    refA1Name: r.refA1Name ?? null,
    refA1Title: r.refA1Title ?? null,
    refA2Name: r.refA2Name ?? null,
    refA2Title: r.refA2Title ?? null,
    refA3Name: r.refA3Name ?? null,
    refA3Title: r.refA3Title ?? null,
    refA4Name: r.refA4Name ?? null,
    refA4Title: r.refA4Title ?? null,
  });
}

export async function previewRashRulesReimport(db: OkoDb): Promise<{
  added: number[];
  removed: number[];
  changed: number[];
  unchanged: number;
  jsonTotal: number;
  dbTotal: number;
}> {
  const data = loadJsonPayload();
  if (!data) throw new Error("rash-rules.json not found");
  const dbRules = (
    (await db.prepare("SELECT * FROM rash_rules").all()) as RashRuleRow[]
  ).map(rowToDto);
  const dbMap = new Map(dbRules.map((r) => [r.kod, r]));
  const jsonMap = new Map(data.rules.map((r) => [r.kod, r]));
  const added: number[] = [];
  const removed: number[] = [];
  const changed: number[] = [];
  let unchanged = 0;
  for (const [kod, jr] of jsonMap) {
    const dr = dbMap.get(kod);
    if (!dr) added.push(kod);
    else if (ruleFingerprint(jr) !== ruleFingerprint(dr)) changed.push(kod);
    else unchanged += 1;
  }
  for (const kod of dbMap.keys()) {
    if (!jsonMap.has(kod)) removed.push(kod);
  }
  return {
    added: added.sort((a, b) => a - b),
    removed: removed.sort((a, b) => a - b),
    changed: changed.sort((a, b) => a - b),
    unchanged,
    jsonTotal: data.rules.length,
    dbTotal: dbRules.length,
  };
}

export async function previewPlacementsReimport(db: OkoDb): Promise<{
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  jsonTotal: number;
  dbTotal: number;
  sampleConflicts: RashPlacementConflict[];
}> {
  if (!fs.existsSync(ROW_RASH_JSON)) throw new Error("row-rash-index.json not found");
  const data = JSON.parse(fs.readFileSync(ROW_RASH_JSON, "utf-8")) as RowRashIndexPayload;
  const jsonItems = flattenRowRashIndex(data);
  const dbItems = (await db
    .prepare(`SELECT form_id, row_no, column_key, kod FROM rash_placements`)
    .all()) as Array<{ form_id: string; row_no: string; column_key: string; kod: number }>;

  const keyOf = (formId: string, rowNo: string, col: string) =>
    `${formId}\0${rowNo}\0${normalizeColumnKey(col)}`;
  const dbMap = new Map(
    dbItems.map((r) => [keyOf(r.form_id, String(r.row_no), r.column_key), r.kod])
  );
  const jsonMap = new Map(
    jsonItems.map((r) => [keyOf(r.formId, String(r.rowNo), r.columnKey), r.kod])
  );

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  const sampleConflicts: RashPlacementConflict[] = [];
  for (const [k, kod] of jsonMap) {
    if (!dbMap.has(k)) added += 1;
    else if (dbMap.get(k) !== kod) {
      changed += 1;
      if (sampleConflicts.length < 20) {
        const [formId, rowNo, columnKey] = k.split("\0");
        sampleConflicts.push({
          formId,
          rowNo,
          columnKey,
          existingKod: dbMap.get(k)!,
        });
      }
    } else unchanged += 1;
  }
  for (const k of dbMap.keys()) {
    if (!jsonMap.has(k)) removed += 1;
  }
  return {
    added,
    removed,
    changed,
    unchanged,
    jsonTotal: jsonItems.length,
    dbTotal: dbItems.length,
    sampleConflicts,
  };
}

export { rowToDto, dtoToRow };
