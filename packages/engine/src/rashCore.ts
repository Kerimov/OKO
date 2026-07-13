import type { RowData } from "./types.js";

/** Parse numeric cell (spaces / comma). */
export function numVal(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export interface RashThresholds {
  level1: number;
  level2: number;
  level3: number;
}

export function rashThresholdLevel(
  absValue: number,
  thresholds: RashThresholds
): 0 | 1 | 2 | 3 {
  if (absValue >= thresholds.level3) return 3;
  if (absValue >= thresholds.level2) return 2;
  if (absValue >= thresholds.level1) return 1;
  return 0;
}

/** Sum numeric columns of a row (excluding meta keys). */
export function sumRowNumeric(row: RowData, keys: string[]): number {
  let s = 0;
  for (const k of keys) s += numVal(row[k]);
  return s;
}
