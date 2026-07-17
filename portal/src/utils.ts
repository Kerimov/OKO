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

/**
 * Подтягивает в экземпляр новые строки шаблона (после правки формы в редакторе),
 * не удаляя пользовательские строки (allowAddRows / без номера).
 */
export function alignInstanceRowsToSchema(
  schema: FormSchema,
  rows: RowData[]
): { rows: RowData[]; added: number } {
  if (!schema.rows.length) return { rows, added: 0 };

  const byNum = new Map<string, RowData>();
  const extras: RowData[] = [];
  for (const row of rows) {
    const num = String(row.num ?? "").trim();
    if (num && !byNum.has(num)) byNum.set(num, row);
    else extras.push(row);
  }

  const aligned: RowData[] = [];
  let added = 0;
  for (const t of schema.rows) {
    const num = String(t.num ?? "").trim();
    if (!num) {
      // Строки шаблона без номера нельзя однозначно сопоставить — пропускаем автодобавление.
      continue;
    }
    const existing = byNum.get(num);
    if (existing) {
      byNum.delete(num);
      const base = templateToRow(t, schema);
      aligned.push({
        ...base,
        ...existing,
        num: existing.num || t.num || "",
        name: existing.name || t.name || "",
        code: existing.code || t.code || "",
      });
    } else {
      aligned.push(templateToRow(t, schema));
      added++;
    }
  }

  for (const row of byNum.values()) aligned.push(row);
  for (const row of extras) aligned.push(row);
  return { rows: aligned, added };
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
