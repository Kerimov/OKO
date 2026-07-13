import { extractCellRefs } from "./cellExpression.js";
import type { CheckRunResult } from "./checkRunCore.js";

/** Cell key: `${rowNo}:${column}` -> error message */
export function failedCellsForForm(
  formId: string,
  result: CheckRunResult | null
): Map<string, string> {
  const map = new Map<string, string>();
  if (!result) return map;

  for (const item of result.items) {
    if (item.passed) continue;
    const msg = item.message ?? item.error ?? "Ошибка увязки";
    for (const ref of extractCellRefs(item.expression)) {
      if (ref.form === formId) {
        const key = `${ref.row}:${ref.column}`;
        if (!map.has(key)) map.set(key, msg);
      }
    }
  }
  return map;
}

export function cellErrorKey(row: { num?: string | number }, rowIdx: number, colKey: string): string {
  const num = String(row.num ?? "").trim();
  return num ? `${num}:${colKey}` : `idx${rowIdx}:${colKey}`;
}
