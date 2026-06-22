import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
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

export async function migrateExcelTables(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("excel_mappings", "period"))) {
    await db.exec("ALTER TABLE excel_mappings ADD COLUMN period INTEGER DEFAULT 0");
  }
  if (!(await db.columnExists("excel_mappings", "add_text"))) {
    await db.exec("ALTER TABLE excel_mappings ADD COLUMN add_text TEXT");
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

async function insertMappings(db: OkoDb, mappings: ExcelMappingDto[]): Promise<void> {
  const insert = db.prepare(INSERT_EXCEL);
  for (const dto of mappings) {
    const r = dtoToRow(dto);
    await insert.run(
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

export async function seedExcelMappingsFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(EXCEL_JSON)) return 0;
  const count = (await db.prepare("SELECT COUNT(*) AS c FROM excel_mappings").get()) as { c: number };
  if (count.c > 0) return 0;

  const data = JSON.parse(fs.readFileSync(EXCEL_JSON, "utf-8")) as { mappings: ExcelMappingDto[] };
  return db.transaction(async (tx) => {
    await insertMappings(tx, data.mappings);
    return data.mappings.length;
  });
}

export async function reimportExcelMappingsFromJson(db: OkoDb): Promise<number> {
  if (!fs.existsSync(EXCEL_JSON)) throw new Error("excel-export.json not found");
  const data = JSON.parse(fs.readFileSync(EXCEL_JSON, "utf-8")) as { mappings: ExcelMappingDto[] };
  await db.exec("DELETE FROM excel_mappings");
  return db.transaction(async (tx) => {
    await insertMappings(tx, data.mappings);
    return data.mappings.length;
  });
}

export async function getExcelStats(db: OkoDb) {
  const total = ((await db.prepare("SELECT COUNT(*) AS c FROM excel_mappings").get()) as { c: number })
    .c;
  const formsCount = (
    (await db.prepare("SELECT COUNT(DISTINCT form_name) AS c FROM excel_mappings").get()) as {
      c: number;
    }
  ).c;
  return { total, formsCount };
}

export async function exportExcelPayload(db: OkoDb) {
  const rows = (await db
    .prepare(
      `SELECT id, form_name, sheet_name, excel_row, excel_column,
              form_column, form_row, period, add_text
       FROM excel_mappings ORDER BY form_name, id`
    )
    .all()) as ExcelMappingRow[];
  const stats = await getExcelStats(db);
  return {
    version: "2.0",
    source: "sqlite:excel_mappings",
    total: stats.total,
    formsCount: stats.formsCount,
    mappings: rows.map(rowToDto),
  };
}

export async function getExcelMapping(db: OkoDb, id: number): Promise<ExcelMappingDto | null> {
  const row = (await db
    .prepare(
      `SELECT id, form_name, sheet_name, excel_row, excel_column,
              form_column, form_row, period, add_text
       FROM excel_mappings WHERE id = ?`
    )
    .get(id)) as ExcelMappingRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function createExcelMapping(db: OkoDb, dto: ExcelMappingDto): Promise<ExcelMappingDto> {
  const r = dtoToRow(dto);
  const inserted = (await db
    .prepare(`${INSERT_EXCEL} RETURNING id`)
    .get(
      r.form_name,
      r.sheet_name,
      r.excel_row,
      r.excel_column,
      r.form_column,
      r.form_row,
      r.period,
      r.add_text
    )) as { id: number };
  return (await getExcelMapping(db, inserted.id))!;
}

export async function updateExcelMapping(
  db: OkoDb,
  id: number,
  dto: ExcelMappingDto
): Promise<ExcelMappingDto | null> {
  const r = dtoToRow(dto);
  const result = await db
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

export async function deleteExcelMapping(db: OkoDb, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM excel_mappings WHERE id = ?").run(id);
  return result.changes > 0;
}
