import type { FormRowTemplate, FormSchema, RowData } from "./types";

export function buildInitialRows(schema: FormSchema): RowData[] {
  if (schema.rows.length > 0) {
    return schema.rows.map((r) => templateToRow(r, schema));
  }
  return [emptyRow(schema)];
}

export function templateToRow(t: FormRowTemplate, schema: FormSchema): RowData {
  const row: RowData = {};
  for (const col of schema.columns) {
    row[col.key] = col.type === "number" ? "" : "";
  }
  if (t.num) row.num = t.num;
  if (t.code) row.code = t.code;
  if (t.name) row.name = t.name;
  if (t.rashKod != null) (row as RowData & { rashKod?: number }).rashKod = t.rashKod;
  const accountCode = t.code ?? t.num;
  if (schema.columns.some((c) => c.key === "account") && accountCode) {
    row.account = `${accountCode} ${t.name ?? ""}`.trim();
  }
  return row;
}

export function emptyRow(schema: FormSchema): RowData {
  const row: RowData = {};
  for (const col of schema.columns) {
    row[col.key] = "";
  }
  return row;
}

export function formatPeriod(start: string, end: string): string {
  if (!start && !end) return "не указан";
  if (start && end) return `${start} — ${end}`;
  return start || end;
}

export function formStatusLabel(status?: "draft" | "submitted"): string {
  return status === "submitted" ? "Сдано" : "Черновик";
}

export function packageWorkflowLabel(
  status?: "draft" | "submitted" | "returned" | "corrected" | "accepted"
): string {
  switch (status) {
    case "submitted":
      return "Сдан на проверку";
    case "returned":
      return "Возвращён";
    case "corrected":
      return "Исправлен";
    case "accepted":
      return "Принят";
    default:
      return "Черновик";
  }
}

export function categoryLabel(
  categories: Record<string, string>,
  cat: string
): string {
  return categories[cat] ?? cat;
}
