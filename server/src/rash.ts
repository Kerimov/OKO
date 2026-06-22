import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
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

export function migrateRashTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rash_rules (
      kod INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT,
      ref_rows TEXT,
      total_formula TEXT,
      ref_a1_name TEXT,
      ref_a1_title TEXT,
      ref_a2_name TEXT,
      ref_a2_title TEXT,
      ref_a3_name TEXT,
      ref_a3_title TEXT,
      ref_a4_name TEXT,
      ref_a4_title TEXT
    );

    CREATE TABLE IF NOT EXISTS rash_addsum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kod INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      sum_title TEXT NOT NULL,
      fld_type TEXT NOT NULL DEFAULT 'Сумма',
      FOREIGN KEY (kod) REFERENCES rash_rules(kod) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rash_addsum_kod ON rash_addsum(kod);
    CREATE INDEX IF NOT EXISTS idx_rash_rules_ref ON rash_rules(ref_rows);
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

function importPayload(db: DatabaseSync, data: ReturnType<typeof loadJsonPayload>): number {
  if (!data) return 0;

  const insertRule = db.prepare(
    `INSERT INTO rash_rules (
      kod, name, note, ref_rows, total_formula,
      ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
      ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertAddsum = db.prepare(
    `INSERT INTO rash_addsum (kod, sort_order, sum_title, fld_type)
     VALUES (?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM rash_addsum");
    db.exec("DELETE FROM rash_rules");
    for (const rule of data.rules) {
      const r = dtoToRow(rule);
      insertRule.run(
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
      insertAddsum.run(item.kod, item.sort, item.sumTitle, item.fldType);
    }
    if (data.thresholds) {
      const upsert = db.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      upsert.run("rashThresholds", JSON.stringify(data.thresholds));
    }
    db.exec("COMMIT");
    return data.rules.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function seedRashFromJson(db: DatabaseSync): number {
  const count = db.prepare("SELECT COUNT(*) AS c FROM rash_rules").get() as { c: number };
  if (count.c > 0) return 0;
  return importPayload(db, loadJsonPayload());
}

export function reimportRashFromJson(db: DatabaseSync): number {
  return importPayload(db, loadJsonPayload());
}

export function getRashStats(db: DatabaseSync) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM rash_rules").get() as { c: number }).c;
  const addsum = (db.prepare("SELECT COUNT(*) AS c FROM rash_addsum").get() as { c: number }).c;
  const withFormula = (
    db
      .prepare("SELECT COUNT(*) AS c FROM rash_rules WHERE total_formula IS NOT NULL AND total_formula <> ''")
      .get() as { c: number }
  ).c;
  return { total, addsum, withFormula };
}

export function getRashThresholds(db: DatabaseSync): RashThresholdsDto {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'rashThresholds'").get() as
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

export function setRashThresholds(db: DatabaseSync, thresholds: RashThresholdsDto): RashThresholdsDto {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('rashThresholds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(thresholds));
  return thresholds;
}

export function exportRashPayload(db: DatabaseSync) {
  const rules = (
    db
      .prepare(
        `SELECT kod, name, note, ref_rows, total_formula,
                ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
                ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
         FROM rash_rules ORDER BY kod`
      )
      .all() as RashRuleRow[]
  ).map(rowToDto);

  const addsum = (
    db
      .prepare(
        "SELECT id, kod, sort_order, sum_title, fld_type FROM rash_addsum ORDER BY kod, sort_order"
      )
      .all() as RashAddsumRow[]
  ).map(addsumRowToDto);

  return {
    version: "1.0",
    source: "sqlite",
    total: rules.length,
    rules,
    addsum,
    thresholds: getRashThresholds(db),
  };
}

export function getRashRule(db: DatabaseSync, kod: number): RashRuleDto | null {
  const row = db
    .prepare(
      `SELECT kod, name, note, ref_rows, total_formula,
              ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title,
              ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title
       FROM rash_rules WHERE kod = ?`
    )
    .get(kod) as RashRuleRow | undefined;
  return row ? rowToDto(row) : null;
}

export function listRashAddsum(db: DatabaseSync, kod: number): RashAddsumDto[] {
  const rows = db
    .prepare(
      "SELECT id, kod, sort_order, sum_title, fld_type FROM rash_addsum WHERE kod = ? ORDER BY sort_order"
    )
    .all(kod) as RashAddsumRow[];
  return rows.map(addsumRowToDto);
}

export function upsertRashRule(db: DatabaseSync, dto: RashRuleDto): RashRuleDto {
  const r = dtoToRow(dto);
  db.prepare(
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
  ).run(
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

export function deleteRashRule(db: DatabaseSync, kod: number): boolean {
  const result = db.prepare("DELETE FROM rash_rules WHERE kod = ?").run(kod);
  return result.changes > 0;
}

export { rowToDto, dtoToRow };
