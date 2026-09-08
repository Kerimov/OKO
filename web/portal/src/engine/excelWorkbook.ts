import ExcelJS from "exceljs";

const MAX_SHEET_NAME = 31;
const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;

export function sanitizeExcelFilename(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 80);
}

export function excelColIndex(col: number | string): number {
  if (typeof col === "number") return col;
  const s = col.trim().toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

export function triggerBrowserDownload(fileName: string, data: Uint8Array | ArrayBuffer): void {
  const blob = new Blob([data as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadWorkbookFromArrayBuffer(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
  if (buf.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error(`Файл Excel слишком большой (>${MAX_WORKBOOK_BYTES / 1024 / 1024} МБ)`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

export async function writeWorkbookToArrayBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Uint8Array(buf);
}

export function setWorksheetCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number | string,
  val: string | number
): void {
  const cell = ws.getCell(Math.round(row), excelColIndex(col));
  if (val === "" || val === null || val === undefined) return;
  const isNum =
    typeof val === "number" ||
    (typeof val === "string" && /^-?\d+([.,]\d+)?$/.test(val.trim()));
  if (isNum) {
    const n = typeof val === "number" ? val : parseFloat(String(val).replace(",", "."));
    cell.value = n;
  } else {
    cell.value = String(val);
  }
}

export function safeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, "_").slice(0, MAX_SHEET_NAME);
}

export async function writeJsonSheetWorkbook(
  rows: Record<string, unknown>[],
  sheetName = "data"
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(sheetName));
  if (rows.length === 0) {
    return writeWorkbookToArrayBuffer(wb);
  }
  const keys = Object.keys(rows[0]);
  ws.addRow(keys);
  for (const row of rows) {
    ws.addRow(keys.map((k) => row[k] ?? ""));
  }
  return writeWorkbookToArrayBuffer(wb);
}
