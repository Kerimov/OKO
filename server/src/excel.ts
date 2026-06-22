import fs from "fs";
import path from "path";
import type { DatabaseSync } from "node:sqlite";
import { ROOT } from "./paths.js";

export interface ExcelMappingRow {
  id: number;
  form_name: string;
  sheet_name: string | null;
  excel_row: number | null;
  excel_column: string | null;
  form_column: string | null;
  form_row: number | null;
  period: number;
  add_text: string | null;
}

export interface ExcelMappingDto {
  id?: number;
  formName: string;
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: number | string | null;
  formColumn: string | null;
  formRow: number | null;
  period?: boolean;
  addText?: string | null;
}

const EXCEL_JSON = path.join(ROOT, "portal", "public", "data", "excel-export.json");

const INSERT_EXCEL = `INSERT INTO excel_mappings (
  form_name, sheet_name, excel_row, excel_column, form_column, form_row, period, add_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export function migrateExcelTables(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(excel_mappings)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("period")) {
    db.exec("ALTER TABLE excel_mappings ADD COLUMN period INTEGER DEFAULT 0");
  }
  if (!names.has("add_text")) {
    db.exec("ALTER TABLE excel_mappings ADD COLUMN add_text TEXT");
  }
}

export function rowToDto(row: ExcelMappingRow): ExcelMappingDto {
  let excelColumn: number | string | null = row.excel_column;
  if (excelColumn !== null && /^-?\d+$/.test(excelColumn)) {
    excelColumn = Number(excelColumn);
  }
  return {
    id: row.id,
    formName: row.form_name,
    sheetName: row.sheet_name,
    excelRow: row.excel_row,
    excelColumn,
    formColumn: row.form_column,
    formRow: row.form_row,
    period: !!row.period,
    addText: row.add_text,
  };
}

export function dtoToRow(dto: ExcelMappingDto): Omit<ExcelMappingRow, "id"> {
  return {
    form_name: dto.formName,
    sheet_name: dto.sheetName ?? null,
    excel_row: dto.excelRow ?? null,
    excel_column: dto.excelColumn != null ? String(dto.excelColumn) : null,
    form_column: dto.formColumn ?? null,
    form_row: dto.formRow ?? null,
    period: dto.period ? 1 : 0,
    add_text: dto.addText ?? null,
  };
}

function insertMappings(db: DatabaseSync, mappings: ExcelMappingDto[]): void {
  const insert = db.prepare(INSERT_EXCEL);
  for (const dto of mappings) {
    const r = dtoToRow(dto);
    insert.run(
      r.form_name,
      r.sheet_name,
      r.excel_row,
      r.excel_column,
      r.form_column,
      r.form_row,
      r.period,
      r.add_text
    );
  }
}

export function seedExcelMappingsFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(EXCEL_JSON)) return 0;
  const count = db.prepare("SELECT COUNT(*) AS c FROM excel_mappings").get() as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(EXCEL_JSON, "utf-8")) as { mappings: ExcelMappingDto[] };
  db.exec("BEGIN");
  try {
    insertMappings(db, data.mappings);
    db.exec("COMMIT");
    return data.mappings.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function reimportExcelMappingsFromJson(db: DatabaseSync): number {
  if (!fs.existsSync(EXCEL_JSON)) throw new Error("excel-export.json not found");
  const data = JSON.parse(fs.readFileSync(EXCEL_JSON, "utf-8")) as { mappings: ExcelMappingDto[] };
  db.exec("DELETE FROM excel_mappings");
  db.exec("BEGIN");
  try {
    insertMappings(db, data.mappings);
    db.exec("COMMIT");
    return data.mappings.length;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getExcelStats(db: DatabaseSync) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM excel_mappings").get() as { c: number }).c;
  const formsCount = (
    db.prepare("SELECT COUNT(DISTINCT form_name) AS c FROM excel_mappings").get() as { c: number }
  ).c;
  return { total, formsCount };
}

export function exportExcelPayload(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT id, form_name, sheet_name, excel_row, excel_column,
              form_column, form_row, period, add_text
       FROM excel_mappings ORDER BY form_name, id`
    )
    .all() as ExcelMappingRow[];
  const stats = getExcelStats(db);
  return {
    version: "2.0",
    source: "sqlite:excel_mappings",
    total: stats.total,
    formsCount: stats.formsCount,
    mappings: rows.map(rowToDto),
  };
}

export function getExcelMapping(db: DatabaseSync, id: number): ExcelMappingDto | null {
  const row = db
    .prepare(
      `SELECT id, form_name, sheet_name, excel_row, excel_column,
              form_column, form_row, period, add_text
       FROM excel_mappings WHERE id = ?`
    )
    .get(id) as ExcelMappingRow | undefined;
  return row ? rowToDto(row) : null;
}

export function createExcelMapping(db: DatabaseSync, dto: ExcelMappingDto): ExcelMappingDto {
  const r = dtoToRow(dto);
  const result = db
    .prepare(INSERT_EXCEL)
    .run(
      r.form_name,
      r.sheet_name,
      r.excel_row,
      r.excel_column,
      r.form_column,
      r.form_row,
      r.period,
      r.add_text
    );
  return getExcelMapping(db, Number(result.lastInsertRowid))!;
}

export function updateExcelMapping(
  db: DatabaseSync,
  id: number,
  dto: ExcelMappingDto
): ExcelMappingDto | null {
  const r = dtoToRow(dto);
  const result = db
    .prepare(
      `UPDATE excel_mappings SET
        form_name = ?, sheet_name = ?, excel_row = ?, excel_column = ?,
        form_column = ?, form_row = ?, period = ?, add_text = ?
       WHERE id = ?`
    )
    .run(
      r.form_name,
      r.sheet_name,
      r.excel_row,
      r.excel_column,
      r.form_column,
      r.form_row,
      r.period,
      r.add_text,
      id
    );
  if (result.changes === 0) return null;
  return getExcelMapping(db, id);
}

export function deleteExcelMapping(db: DatabaseSync, id: number): boolean {
  const result = db.prepare("DELETE FROM excel_mappings WHERE id = ?").run(id);
  return result.changes > 0;
}
