import * as XLSX from "xlsx";
import { loadExcelExport } from "../api";
import { isBackendMode } from "../storage";
import type { FormMeta, FormSchema, OkoFormInstance, RowData } from "../types";

function colIndexToLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    num--;
    s = String.fromCharCode(65 + (num % 26)) + s;
    num = Math.floor(num / 26);
  }
  return s;
}

function cellRef(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row}`;
}

function rowValue(rows: RowData[], formRow: number, formColumn: string): string | number {
  const row = rows.find((r) => String(r.num) === String(formRow));
  if (!row) return "";
  const v = row[formColumn];
  if (v === undefined || v === null || v === "") return "";
  return v;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 80);
}

function excelColIndex(col: number | string): number {
  if (typeof col === "number") return col;
  return XLSX.utils.decode_col(col) + 1;
}

function setCell(ws: XLSX.WorkSheet, row: number, col: number, val: string | number): void {
  const ref = cellRef(row, col);
  const isNum = typeof val === "number" || (typeof val === "string" && /^-?\d+([.,]\d+)?$/.test(val.trim()));
  if (isNum && val !== "") {
    const n = typeof val === "number" ? val : parseFloat(String(val).replace(",", "."));
    ws[ref] = { t: "n", v: n };
  } else {
    ws[ref] = { t: "s", v: String(val) };
  }
}

function applyMappings(
  ws: XLSX.WorkSheet,
  mappings: Array<{
    excelRow: number | null;
    excelColumn: number | string | null;
    formColumn: string | null;
    formRow: number | null;
  }>,
  rows: RowData[]
): void {
  for (const m of mappings) {
    if (m.formRow == null || !m.formColumn || m.excelRow == null || m.excelColumn == null)
      continue;
    const val = rowValue(rows, m.formRow, m.formColumn);
    if (val === "") continue;
    setCell(ws, Math.round(m.excelRow), excelColIndex(m.excelColumn), val);
  }
}

async function loadMinfinWorkbook(): Promise<XLSX.WorkBook | null> {
  try {
    const url = isBackendMode() ? "/api/templates/minfin" : "/templates/minfin.xlsx";
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return XLSX.read(buf, { type: "array" });
  } catch {
    return null;
  }
}

function writeBlankWorkbook(
  schema: FormSchema,
  meta: FormMeta,
  rows: RowData[],
  mappings: Awaited<ReturnType<typeof loadExcelExport>>["mappings"]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  if (mappings.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([
      [schema.title],
      [`${meta.organization} · ${meta.periodStart} — ${meta.periodEnd}`],
      [],
      schema.columns.map((c) => c.label),
      ...rows.map((row, i) =>
        schema.columns.map((col) => {
          if (col.key === "num") return row.num ?? i + 1;
          return row[col.key] ?? "";
        })
      ),
    ]);
    XLSX.utils.book_append_sheet(wb, ws, schema.id.slice(0, 31));
    return wb;
  }

  const bySheet = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const sheet = m.sheetName ?? schema.id;
    const list = bySheet.get(sheet) ?? [];
    list.push(m);
    bySheet.set(sheet, list);
  }

  for (const [sheetName, sheetMaps] of bySheet) {
    const ws: XLSX.WorkSheet = {};
    let maxRow = 1;
    let maxCol = 1;
    applyMappings(ws, sheetMaps, rows);
    for (const m of sheetMaps) {
      if (m.excelRow != null && m.excelColumn != null) {
        maxRow = Math.max(maxRow, Math.round(m.excelRow));
        maxCol = Math.max(maxCol, excelColIndex(m.excelColumn));
      }
    }
    ws["!ref"] = `A1:${cellRef(maxRow, maxCol)}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  }
  return wb;
}

export async function exportFormToExcel(options: {
  schema: FormSchema;
  displayName: string;
  meta: FormMeta;
  rows: RowData[];
}): Promise<void> {
  const { schema, displayName, meta, rows } = options;
  const data = await loadExcelExport();
  const mappings = data.mappings.filter((m) => m.formName === schema.id);

  const minfin = await loadMinfinWorkbook();
  let wb: XLSX.WorkBook;

  if (minfin && mappings.length > 0) {
    wb = minfin;
    const bySheet = new Map<string, typeof mappings>();
    for (const m of mappings) {
      if (!m.sheetName) continue;
      const list = bySheet.get(m.sheetName) ?? [];
      list.push(m);
      bySheet.set(m.sheetName, list);
    }
    for (const [sheetName, sheetMaps] of bySheet) {
      const ws = wb.Sheets[sheetName];
      if (ws) applyMappings(ws, sheetMaps, rows);
    }
  } else {
    wb = writeBlankWorkbook(schema, meta, rows, mappings);
  }

  XLSX.writeFile(wb, sanitizeFilename(`${schema.id}_${displayName}`) + ".xlsx");
}

export async function exportPackageToExcel(
  instances: OkoFormInstance[],
  schemas: Map<string, FormSchema>
): Promise<void> {
  const data = await loadExcelExport();
  const minfin = await loadMinfinWorkbook();

  let wb: XLSX.WorkBook;
  if (minfin) {
    wb = minfin;
    for (const inst of instances) {
      const mappings = data.mappings.filter((m) => m.formName === inst.templateId);
      const bySheet = new Map<string, typeof mappings>();
      for (const m of mappings) {
        if (!m.sheetName) continue;
        const list = bySheet.get(m.sheetName) ?? [];
        list.push(m);
        bySheet.set(m.sheetName, list);
      }
      for (const [sheetName, sheetMaps] of bySheet) {
        const ws = wb.Sheets[sheetName];
        if (ws) applyMappings(ws, sheetMaps, inst.rows);
      }
    }
  } else {
    wb = XLSX.utils.book_new();
    for (const inst of instances) {
      const schema = schemas.get(inst.templateId);
      if (!schema) continue;
      const mappings = data.mappings.filter((m) => m.formName === inst.templateId);
      const sub = writeBlankWorkbook(schema, inst.meta, inst.rows, mappings);
      for (const name of sub.SheetNames) {
        XLSX.utils.book_append_sheet(wb, sub.Sheets[name], inst.templateId.slice(0, 31));
      }
    }
  }

  XLSX.writeFile(wb, `oko_package_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
