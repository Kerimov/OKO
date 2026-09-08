import type { RowData } from "@portal/types";

export function resolveRowNo(row: RowData, index: number): number {
  const parsed = parseInt(String(row.num ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  return 900_000_000 + index;
}

export function findRowIndexByRowNo(rows: RowData[], rowNo: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (resolveRowNo(rows[i], i) === rowNo) return i;
  }
  return -1;
}
