import type { OkoFormInstance, RowData } from "./types.js";

export type SaldoPhase = "previous_period" | "analog_period";

export interface SaldoTransferResult {
  rowsUpdated: number;
  columnsCopied: string[];
  rows: RowData[];
}

/** Parse rule like `B,C,G-*;` -> column keys (without -* suffix). */
export function parseSaldoColumnRule(rule: string | null | undefined): string[] {
  if (!rule) return [];
  return rule
    .split(";")
    .map((part) => part.trim().replace(/-\*$/, "").trim())
    .filter(Boolean)
    .flatMap((part) => part.split(",").map((c) => c.trim()))
    .filter(Boolean);
}

function rowKey(row: RowData): string {
  return String(row.num ?? "").trim();
}

export function copySaldoColumns(
  sourceRows: RowData[],
  targetRows: RowData[],
  columns: string[]
): { rows: RowData[]; updated: number } {
  const srcMap = new Map<string, RowData>();
  for (const r of sourceRows) {
    const k = rowKey(r);
    if (k) srcMap.set(k, r);
  }

  let updated = 0;
  const next = targetRows.map((tgt) => {
    const src = srcMap.get(rowKey(tgt));
    if (!src) return tgt;
    let changed = false;
    const row = { ...tgt };
    for (const col of columns) {
      const val = src[col];
      if (val !== undefined && val !== "" && val !== row[col]) {
        row[col] = val;
        changed = true;
      }
    }
    if (changed) updated++;
    return row;
  });

  return { rows: next, updated };
}

export function transferSaldoWithColumns(
  source: OkoFormInstance,
  target: OkoFormInstance,
  columns: string[]
): SaldoTransferResult {
  if (source.templateId !== target.templateId) {
    throw new Error(
      `Формы должны совпадать: ${source.templateId} ≠ ${target.templateId}`
    );
  }
  if (columns.length === 0) {
    throw new Error(`Нет правил переноса сальдо для ${target.templateId}`);
  }
  const { rows, updated } = copySaldoColumns(source.rows, target.rows, columns);
  return { rowsUpdated: updated, columnsCopied: columns, rows };
}

export type SaldoDetailedRule = {
  sourceRow: number | string | null;
  targetRow: number | string | null;
  sourceColumn: string | null;
  targetColumn: string | null;
  saldoT?: boolean;
  saldoS?: boolean;
  saldoG?: boolean;
  targetForm?: string;
};

/** Apply a_tblsaldo-style row/column rules (pure). */
export function applySaldoDetailedRules(
  source: OkoFormInstance,
  target: OkoFormInstance,
  rules: SaldoDetailedRule[]
): { rows: RowData[]; applied: number } {
  const srcIndex = new Map<string, RowData>();
  for (const r of source.rows) {
    const k = rowKey(r);
    if (k) srcIndex.set(k, r);
  }

  const rows = target.rows.map((r) => ({ ...r }));
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = rowKey(r);
    if (k) rowIndex.set(k, i);
  });

  let applied = 0;
  for (const rule of rules) {
    const srcRow = srcIndex.get(String(rule.sourceRow));
    const tgtIdx = rowIndex.get(String(rule.targetRow));
    if (!srcRow || tgtIdx === undefined || !rule.sourceColumn || !rule.targetColumn) continue;
    const val = srcRow[rule.sourceColumn];
    if (val === undefined || val === "") continue;
    if (rows[tgtIdx][rule.targetColumn] !== val) {
      rows[tgtIdx][rule.targetColumn] = val;
      applied++;
    }
  }

  return { rows, applied };
}

export function applySaldoToTarget(
  target: OkoFormInstance,
  rows: RowData[]
): OkoFormInstance {
  return { ...target, rows, updatedAt: new Date().toISOString() };
}
