export interface RowRashRowMeta {
  defaultKod?: number;
  columns?: Record<string, number>;
}

export interface RowRashIndexData {
  version: string;
  source?: string;
  forms: Record<string, Record<string, RowRashRowMeta>>;
  stats?: { forms: number; rows: number; placements?: number };
}

import { apiFetchRaw } from "../apiClient";

let cached: RowRashIndexData | null = null;

export async function loadRowRashIndex(): Promise<RowRashIndexData> {
  if (cached) return cached;
  try {
    const apiRes = await apiFetchRaw("/api/rash/placements/export");
    if (apiRes.ok) {
      const data = (await apiRes.json()) as RowRashIndexData;
      if (data.forms && Object.keys(data.forms).length > 0) {
        cached = data;
        return cached;
      }
    }
  } catch {
    /* fall through to static JSON */
  }
  try {
    const res = await fetch("/data/row-rash-index.json");
    if (res.ok) {
      cached = (await res.json()) as RowRashIndexData;
      return cached;
    }
  } catch {
    /* fallback */
  }
  cached = { version: "0", forms: {} };
  return cached;
}

export function clearRowRashIndexCache(): void {
  cached = null;
}

export function rowMeta(
  index: RowRashIndexData,
  formId: string,
  rowNum: string
): RowRashRowMeta | undefined {
  return index.forms[formId]?.[rowNum.trim()];
}

export function rashKodForCell(
  index: RowRashIndexData,
  formId: string,
  rowNum: string,
  columnKey: string
): number | null {
  const meta = rowMeta(index, formId, rowNum);
  if (!meta) return null;
  const col = columnKey.toUpperCase();
  if (meta.columns?.[col] != null) return meta.columns[col];
  if (meta.columns?.[columnKey] != null) return meta.columns[columnKey];
  return meta.defaultKod ?? null;
}
