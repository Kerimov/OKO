import type { SheetColumn, SheetRow, StableCellRef } from "./types.js";
import { colToIndex, indexToCol } from "./formulaEngine.js";

/** Build A1 from sheet coordinates (1-based visual row index among visible columns). */
export function toA1(colIndex1: number, rowIndex1: number): string {
  return `${indexToCol(colIndex1)}${rowIndex1}`;
}

export function parseA1(a1: string): { col: number; row: number } | null {
  const m = a1.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: colToIndex(m[1]), row: Number(m[2]) };
}

export function makeRowId(formId: string, rowNo: string, index: number): string {
  const base = rowNo.trim() || `i${index}`;
  return `${formId}:${base}`;
}

/**
 * Map visual A1 formula onto stable refs using current column order + row list.
 * Example: `=B2+C2` → `={rid}:{col:B}+{rid}:{col:C}` where rid is row at visual index 2.
 */
function resolveColumnByA1Letters(
  letters: string,
  columns: SheetColumn[]
): SheetColumn | undefined {
  const key = letters.toUpperCase();
  const byKey = columns.find((c) => !c.hidden && c.key.toUpperCase() === key);
  if (byKey) return byKey;
  const visibleCols = columns.filter((c) => !c.hidden);
  return visibleCols[colToIndex(key) - 1];
}

export function a1FormulaToStable(
  formula: string,
  columns: SheetColumn[],
  rows: SheetRow[]
): string {
  return formula.replace(/\$?([A-Za-z]+)\$?(\d+)/g, (_m, letters, rowStr) => {
    const col = resolveColumnByA1Letters(String(letters), columns);
    const row = rows[Number(rowStr) - 1];
    if (!col || !row) return _m;
    return `{${row.rowId}}:{col:${col.key}}`;
  });
}

export function stableFormulaToA1(
  formula: string,
  columns: SheetColumn[],
  rows: SheetRow[]
): string {
  const rowPos = new Map(rows.map((r, i) => [r.rowId, i + 1]));
  return formula.replace(/\{([^}]+)\}:\{col:([^}]+)\}/g, (_m, rowId, colKey) => {
    const r = rowPos.get(rowId);
    const col = columns.find((c) => c.key === colKey);
    if (r == null || !col) return _m;
    if (/^[A-Z]+$/i.test(col.key)) return `${col.key.toUpperCase()}${r}`;
    const visibleCols = columns.filter((c) => !c.hidden);
    const idx = visibleCols.findIndex((c) => c.key === col.key);
    if (idx < 0) return _m;
    return `${indexToCol(idx + 1)}${r}`;
  });
}

export function stableRefFromA1(
  a1: string,
  columns: SheetColumn[],
  rows: SheetRow[]
): StableCellRef | null {
  const parsed = parseA1(a1);
  if (!parsed) return null;
  const letters = indexToCol(parsed.col);
  const col = resolveColumnByA1Letters(letters, columns);
  const row = rows[parsed.row - 1];
  if (!col || !row) return null;
  return { rowId: row.rowId, columnKey: col.key };
}
