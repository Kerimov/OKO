/**
 * Controlled XLSX import for OKO forms.
 * VBA / macros / external links are never executed.
 */
import ExcelJS from "exceljs";
import type { FormSchema, RowData } from "../types";
import { loadWorkbookFromArrayBuffer } from "./excelWorkbook";

export interface XlsxImportCellDiff {
  rowNo: number;
  columnKey: string;
  excelValue: string | number;
  formValue: string | number;
  readonly: boolean;
}

export interface XlsxImportPreview {
  sheetName: string;
  matchedRows: number;
  diffs: XlsxImportCellDiff[];
  warnings: string[];
  proposedRows: RowData[];
}

function cellText(cell: ExcelJS.Cell): string | number {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === "number" || typeof r === "string") return r;
  }
  if (typeof v === "object" && v && "text" in v) {
    return String((v as { text?: string }).text ?? "");
  }
  return String(v);
}

/**
 * Preview mapping a worksheet into form rows by row.num in column A (or form num column).
 * Only overwrites non-readonly numeric/text columns that exist on the schema.
 */
export async function previewXlsxFormImport(options: {
  buffer: ArrayBuffer;
  schema: FormSchema;
  currentRows: RowData[];
  sheetName?: string;
  /** Excel column index (1-based) that holds business row numbers. Default 1. */
  rowNoExcelCol?: number;
}): Promise<XlsxImportPreview> {
  const wb = await loadWorkbookFromArrayBuffer(options.buffer);
  const ws =
    (options.sheetName ? wb.getWorksheet(options.sheetName) : null) ??
    wb.worksheets[0];
  if (!ws) {
    return {
      sheetName: "",
      matchedRows: 0,
      diffs: [],
      warnings: ["В книге нет листов"],
      proposedRows: options.currentRows.map((r) => ({ ...r })),
    };
  }

  const warnings: string[] = [];
  if (wb.worksheets.length > 1 && !options.sheetName) {
    warnings.push(`Взять первый лист «${ws.name}» (в книге ${wb.worksheets.length})`);
  }

  const rowNoCol = options.rowNoExcelCol ?? 1;
  const dataCols = options.schema.columns.filter(
    (c) => c.key !== "num" && c.key !== "name" && c.key !== "code" && !c.hidden
  );

  // Map letter keys to excel column: B→2 if we assume header row uses same letters.
  // Fallback: sequential from column 2.
  const excelColForKey = (key: string, fallbackIndex: number): number => {
    if (/^[A-Z]+$/i.test(key)) {
      let n = 0;
      for (const ch of key.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n;
    }
    return fallbackIndex;
  };

  const byNum = new Map<string, number>();
  options.currentRows.forEach((r, i) => {
    const n = String(r.num ?? "").trim();
    if (n) byNum.set(n, i);
  });

  const proposed = options.currentRows.map((r) => ({ ...r }));
  const diffs: XlsxImportCellDiff[] = [];
  let matchedRows = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header guess
    const numCell = row.getCell(rowNoCol);
    const rowNo = String(cellText(numCell)).trim();
    if (!rowNo || !byNum.has(rowNo)) return;
    matchedRows++;
    const idx = byNum.get(rowNo)!;
    dataCols.forEach((col, i) => {
      const excelCol = excelColForKey(col.key, i + 2);
      const val = cellText(row.getCell(excelCol));
      if (val === "") return;
      // Never import executable formulas — only computed results / literals.
      if (typeof val === "string" && val.trim().startsWith("=")) {
        warnings.push(`Пропуск формулы Excel ${col.key} строка ${rowNo}`);
        return;
      }
      if (col.type === "number" && typeof val === "string" && val.trim() !== "") {
        const n = Number(String(val).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) {
          warnings.push(`Нечисловое значение ${col.key} строка ${rowNo}: ${val}`);
          return;
        }
      }
      const prev = proposed[idx][col.key] ?? "";
      if (String(prev) === String(val)) return;
      diffs.push({
        rowNo: Number(rowNo) || 0,
        columnKey: col.key,
        excelValue: val,
        formValue: prev as string | number,
        readonly: !!col.readonly,
      });
      if (!col.readonly) {
        proposed[idx] = { ...proposed[idx], [col.key]: val };
      } else {
        warnings.push(`Пропуск readonly ${col.key} строка ${rowNo}`);
      }
    });
  });

  return {
    sheetName: ws.name,
    matchedRows,
    diffs: diffs.slice(0, 500),
    warnings: [...new Set(warnings)].slice(0, 50),
    proposedRows: proposed,
  };
}

export async function listXlsxSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  const wb = await loadWorkbookFromArrayBuffer(buffer);
  return wb.worksheets.map((w) => w.name);
}
