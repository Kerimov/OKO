import type { RowData } from "@portal/types";
import { findRowIndexByRowNo } from "./rowIndex";

export interface CellChange {
  rowNo: number;
  columnKey: string;
  value: string | number;
  updatedAt: string;
  updatedBy: string | null;
}

export function applyCellChanges(
  rows: RowData[],
  changes: CellChange[],
  skipKeys: Set<string>
): RowData[] {
  if (changes.length === 0) return rows;
  let next = rows.map((r) => ({ ...r }));

  for (const ch of changes) {
    const key = `${ch.rowNo}:${ch.columnKey}`;
    if (skipKeys.has(key)) continue;

    const idx = findRowIndexByRowNo(next, ch.rowNo);
    if (idx < 0) continue;

    if (next[idx][ch.columnKey] !== ch.value) {
      next[idx] = { ...next[idx], [ch.columnKey]: ch.value };
    }
  }

  return next;
}
