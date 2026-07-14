import { loadExcelExport } from "../api";
import { isBackendMode } from "../storage";
import type { FormMeta, FormSchema, OkoFormInstance, RowData } from "../types";
import ExcelJS from "exceljs";
import {
  loadWorkbookFromArrayBuffer,
  safeSheetName,
  sanitizeExcelFilename,
  setWorksheetCell,
  triggerBrowserDownload,
  writeWorkbookToArrayBuffer,
} from "./excelWorkbook";

function rowValue(rows: RowData[], formRow: number, formColumn: string): string | number {
  const row = rows.find((r) => String(r.num) === String(formRow));
  if (!row) return "";
  const v = row[formColumn];
  if (v === undefined || v === null || v === "") return "";
  return v;
}

function applyMappings(
  ws: ExcelJS.Worksheet,
  mappings: Array<{
    excelRow: number | null;
    excelColumn: number | string | null;
    formColumn: string | null;
    formRow: number | null;
    addText?: string | null;
  }>,
  rows: RowData[],
  meta?: FormMeta
): void {
  for (const m of mappings) {
    // Metadata mappings (org / period) — formRow may be null.
    if (m.formRow == null) {
      if (m.excelRow == null || m.excelColumn == null) continue;
      const col = String(m.formColumn ?? "").toLowerCase();
      let val: string | number = m.addText ?? "";
      if (meta) {
        if (col === "org" || col === "organization") val = meta.organization;
        else if (col === "per_rep" || col === "period" || col === "period_end")
          val = meta.periodEnd || meta.periodStart;
        else if (col === "period_start") val = meta.periodStart;
        else if (col === "date()" || col === "date")
          val = new Date().toISOString().slice(0, 10);
        else if (col === "unit") val = meta.unit;
        else if (m.addText) val = m.addText;
        else continue;
      } else if (!m.addText) {
        continue;
      }
      if (val === "") continue;
      setWorksheetCell(ws, Math.round(m.excelRow), m.excelColumn, val);
      continue;
    }
    if (!m.formColumn || m.excelRow == null || m.excelColumn == null) continue;
    const val = rowValue(rows, m.formRow, m.formColumn);
    if (val === "") continue;
    setWorksheetCell(ws, Math.round(m.excelRow), m.excelColumn, val);
  }
}

async function loadMinfinWorkbook(): Promise<ExcelJS.Workbook | null> {
  try {
    const url = isBackendMode() ? "/api/templates/minfin" : "/templates/minfin.xlsx";
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return loadWorkbookFromArrayBuffer(buf);
  } catch {
    return null;
  }
}

function writeBlankWorkbook(
  schema: FormSchema,
  meta: FormMeta,
  rows: RowData[],
  mappings: Awaited<ReturnType<typeof loadExcelExport>>["mappings"],
  cellFormulas?: Map<string, string>
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  if (mappings.length === 0) {
    const ws = wb.addWorksheet(safeSheetName(schema.id));
    ws.addRow([schema.title]);
    ws.addRow([`${meta.organization} · ${meta.periodStart} — ${meta.periodEnd}`]);
    ws.addRow([]);
    ws.addRow(schema.columns.map((c) => c.label));
    rows.forEach((row, i) => {
      const values = schema.columns.map((col) => {
        if (col.key === "num") return row.num ?? i + 1;
        const formulaKey = `${String(row.num ?? "").trim()}:${col.key}`;
        const f = cellFormulas?.get(formulaKey) ?? cellFormulas?.get(`${i}:${col.key}`);
        if (f?.trim().startsWith("=") && col.readonly) {
          return { formula: f.replace(/^=/, "") };
        }
        return row[col.key] ?? "";
      });
      ws.addRow(values);
    });
    // Freeze label columns when present.
    const freezeAt = schema.columns.findIndex((c) => c.frozen);
    if (freezeAt >= 0) {
      ws.views = [{ state: "frozen", xSplit: freezeAt + 1, ySplit: 4 }];
    }
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
    const ws = wb.addWorksheet(safeSheetName(sheetName));
    applyMappings(ws, sheetMaps, rows, meta);
  }
  return wb;
}

export async function exportFormToExcel(options: {
  schema: FormSchema;
  displayName: string;
  meta: FormMeta;
  rows: RowData[];
  /** Optional A1 formulas keyed `rowNo:columnKey` or `rowIndex:columnKey`. */
  cellFormulas?: Map<string, string>;
  /** Desktop/Electron: avoid <a download> which reloads the webview */
  saveAs?: (fileName: string, data: Uint8Array) => void | Promise<void>;
}): Promise<void> {
  const { schema, displayName, meta, rows, cellFormulas, saveAs } = options;
  const data = await loadExcelExport();
  const mappings = data.mappings.filter((m) => m.formName === schema.id);

  const minfin = await loadMinfinWorkbook();
  let wb: ExcelJS.Workbook;

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
      const ws = wb.getWorksheet(sheetName);
      if (ws) applyMappings(ws, sheetMaps, rows, meta);
    }
  } else {
    wb = writeBlankWorkbook(schema, meta, rows, mappings, cellFormulas);
  }

  const fileName = sanitizeExcelFilename(`${schema.id}_${displayName}`) + ".xlsx";
  const bytes = await writeWorkbookToArrayBuffer(wb);
  if (saveAs) {
    await saveAs(fileName, bytes);
  } else {
    triggerBrowserDownload(fileName, bytes);
  }
}

export async function exportPackageToExcel(
  instances: OkoFormInstance[],
  schemas: Map<string, FormSchema>
): Promise<void> {
  const data = await loadExcelExport();
  const minfin = await loadMinfinWorkbook();

  let wb: ExcelJS.Workbook;
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
        const ws = wb.getWorksheet(sheetName);
        if (ws) applyMappings(ws, sheetMaps, inst.rows, inst.meta);
      }
    }
  } else {
    wb = new ExcelJS.Workbook();
    for (const inst of instances) {
      const schema = schemas.get(inst.templateId);
      if (!schema) continue;
      const mappings = data.mappings.filter((m) => m.formName === inst.templateId);
      const sub = writeBlankWorkbook(schema, inst.meta, inst.rows, mappings);
      for (const ws of sub.worksheets) {
        const copy = wb.addWorksheet(safeSheetName(inst.templateId));
        ws.eachRow((row, rowNumber) => {
          copy.getRow(rowNumber).values = row.values;
        });
      }
    }
  }

  triggerBrowserDownload(
    `oko_package_${new Date().toISOString().slice(0, 10)}.xlsx`,
    await writeWorkbookToArrayBuffer(wb)
  );
}
