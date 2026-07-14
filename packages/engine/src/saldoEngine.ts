import type { OkoFormInstance, RowData } from "./types.js";
import { columnsFromCorrespondenceSpec } from "./correspondenceSpec.js";

export type SaldoPhase = "previous_period" | "analog_period";

export interface SaldoTransferResult {
  rowsUpdated: number;
  columnsCopied: string[];
  rows: RowData[];
}

export interface SaldoCellDiff {
  rowNum: string;
  column: string;
  sourceValue: string | number | null;
  targetValue: string | number | null;
}

export interface SaldoCompareResult {
  columns: string[];
  wouldUpdateRows: number;
  diffs: SaldoCellDiff[];
}

/** Parse rule like `B,C,G-*;` or `B,C,D-10,30;` → column keys. */
export function parseSaldoColumnRule(rule: string | null | undefined): string[] {
  return columnsFromCorrespondenceSpec(rule);
}

function rowKey(row: RowData): string {
  return String(row.num ?? "").trim();
}

function cellEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || a === "") {
    return b === undefined || b === null || b === "";
  }
  if (b === undefined || b === null || b === "") return false;
  return String(a).trim() === String(b).trim();
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

/** Access «Только проверить данные»: diff source vs target without writing. */
export function compareSaldoColumns(
  sourceRows: RowData[],
  targetRows: RowData[],
  columns: string[]
): SaldoCompareResult {
  const srcMap = new Map<string, RowData>();
  for (const r of sourceRows) {
    const k = rowKey(r);
    if (k) srcMap.set(k, r);
  }

  const diffs: SaldoCellDiff[] = [];
  const changedRows = new Set<string>();

  for (const tgt of targetRows) {
    const num = rowKey(tgt);
    if (!num) continue;
    const src = srcMap.get(num);
    if (!src) continue;
    for (const col of columns) {
      const sv = src[col];
      if (sv === undefined || sv === "") continue;
      const tv = tgt[col];
      if (cellEquals(sv, tv)) continue;
      changedRows.add(num);
      diffs.push({
        rowNum: num,
        column: col,
        sourceValue: sv as string | number,
        targetValue:
          tv === undefined || tv === "" ? null : (tv as string | number),
      });
    }
  }

  return {
    columns,
    wouldUpdateRows: changedRows.size,
    diffs,
  };
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

export function compareSaldoWithColumns(
  source: OkoFormInstance,
  target: OkoFormInstance,
  columns: string[]
): SaldoCompareResult {
  if (source.templateId !== target.templateId) {
    throw new Error(
      `Формы должны совпадать: ${source.templateId} ≠ ${target.templateId}`
    );
  }
  if (columns.length === 0) {
    throw new Error(`Нет правил переноса сальдо для ${target.templateId}`);
  }
  return compareSaldoColumns(source.rows, target.rows, columns);
}

export type SaldoDetailedRule = {
  sourceRow: number | string | null;
  targetRow: number | string | null;
  sourceColumn: string | null;
  targetColumn: string | null;
  endRow?: number | string | null;
  endColumn?: string | null;
  endForm?: string | null;
  saldoT?: boolean;
  saldoS?: boolean;
  saldoG?: boolean;
  targetForm?: string;
  sourceForm?: string | null;
  /** Access a_tblsaldo.usl — skip when true and options.skipConditional */
  conditional?: boolean;
  kontr?: boolean | number | null;
};

export type SaldoDetailedType = "t" | "s" | "g";

export type ApplySaldoDetailedOptions = {
  /** Skip rules marked conditional (default: apply them). */
  includeConditional?: boolean;
  /** When set, only rules with matching sourceForm (or empty) are applied. */
  resolveSourceForm?: (formId: string) => OkoFormInstance | null;
};

/**
 * Match a_tblsaldo rule to T/S/G.
 * When MDB flags are all false (common in exports), fall back to triplet presence:
 * T/S → source→target; G → end→target.
 */
export function ruleMatchesSaldoType(
  rule: SaldoDetailedRule,
  saldoType: SaldoDetailedType
): boolean {
  const flagged = !!(rule.saldoT || rule.saldoS || rule.saldoG);
  if (flagged) {
    if (saldoType === "t") return !!rule.saldoT;
    if (saldoType === "s") return !!rule.saldoS;
    return !!rule.saldoG;
  }
  if (saldoType === "g") {
    return rule.endColumn != null && rule.endColumn !== "" && rule.endRow != null;
  }
  return rule.sourceColumn != null && rule.sourceColumn !== "" && rule.sourceRow != null;
}

function resolveDetailedSource(
  rule: SaldoDetailedRule,
  saldoType: SaldoDetailedType
): { row: string; column: string } | null {
  if (saldoType === "g") {
    if (rule.endColumn == null || rule.endColumn === "" || rule.endRow == null) return null;
    return { row: String(rule.endRow), column: rule.endColumn };
  }
  if (rule.sourceColumn == null || rule.sourceColumn === "" || rule.sourceRow == null) return null;
  return { row: String(rule.sourceRow), column: rule.sourceColumn };
}

function sourceRowsForRule(
  rule: SaldoDetailedRule,
  defaultSource: OkoFormInstance,
  target: OkoFormInstance,
  options?: ApplySaldoDetailedOptions
): RowData[] {
  const formId = (rule.sourceForm || "").trim();
  if (!formId || formId === target.templateId || formId === defaultSource.templateId) {
    return defaultSource.rows;
  }
  if (options?.resolveSourceForm) {
    const other = options.resolveSourceForm(formId);
    if (other) return other.rows;
  }
  return defaultSource.rows;
}

/** Apply a_tblsaldo-style row/column rules (pure). */
export function applySaldoDetailedRules(
  source: OkoFormInstance,
  target: OkoFormInstance,
  rules: SaldoDetailedRule[],
  saldoType: SaldoDetailedType = "t",
  options?: ApplySaldoDetailedOptions
): { rows: RowData[]; applied: number } {
  const rows = target.rows.map((r) => ({ ...r }));
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = rowKey(r);
    if (k) rowIndex.set(k, i);
  });

  let applied = 0;
  for (const rule of rules) {
    if (!ruleMatchesSaldoType(rule, saldoType)) continue;
    if (rule.conditional && options?.includeConditional === false) continue;
    const srcRef = resolveDetailedSource(rule, saldoType);
    if (!srcRef || !rule.targetColumn || rule.targetRow == null) continue;

    const srcRows = sourceRowsForRule(rule, source, target, options);
    const srcIndex = new Map<string, RowData>();
    for (const r of srcRows) {
      const k = rowKey(r);
      if (k) srcIndex.set(k, r);
    }

    const srcRow = srcIndex.get(srcRef.row);
    const tgtIdx = rowIndex.get(String(rule.targetRow));
    if (!srcRow || tgtIdx === undefined) continue;
    const val = srcRow[srcRef.column];
    if (val === undefined || val === "") continue;
    if (rows[tgtIdx][rule.targetColumn] !== val) {
      rows[tgtIdx][rule.targetColumn] = val;
      applied++;
    }
  }

  return { rows, applied };
}

/** Dry-run for detailed rules — cell-level diffs without writing. */
export function compareSaldoDetailedRules(
  source: OkoFormInstance,
  target: OkoFormInstance,
  rules: SaldoDetailedRule[],
  saldoType: SaldoDetailedType = "t",
  options?: ApplySaldoDetailedOptions
): SaldoCompareResult {
  const { rows } = applySaldoDetailedRules(source, target, rules, saldoType, options);
  const diffs: SaldoCellDiff[] = [];
  const changedRows = new Set<string>();
  const columns = new Set<string>();

  for (let i = 0; i < target.rows.length; i++) {
    const before = target.rows[i];
    const after = rows[i];
    if (!after) continue;
    const num = rowKey(before);
    for (const key of Object.keys({ ...before, ...after })) {
      if (key === "num" || key === "name" || key === "code" || key === "account") continue;
      if (cellEquals(before[key], after[key])) continue;
      if (num) changedRows.add(num);
      columns.add(key);
      diffs.push({
        rowNum: num || String(i),
        column: key,
        sourceValue:
          after[key] === undefined || after[key] === ""
            ? null
            : (after[key] as string | number),
        targetValue:
          before[key] === undefined || before[key] === ""
            ? null
            : (before[key] as string | number),
      });
    }
  }

  return {
    columns: [...columns],
    wouldUpdateRows: changedRows.size,
    diffs,
  };
}

export function applySaldoToTarget(
  target: OkoFormInstance,
  rows: RowData[]
): OkoFormInstance {
  return { ...target, rows, updatedAt: new Date().toISOString() };
}
