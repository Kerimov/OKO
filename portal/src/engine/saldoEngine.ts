import { loadFormCorrespondence, loadSaldoRules } from "../api";
import type { OkoFormInstance, RowData } from "../types";

export type SaldoPhase = "previous_period" | "analog_period";

export interface SaldoTransferOptions {
  source: OkoFormInstance;
  target: OkoFormInstance;
  phase: SaldoPhase;
}

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

export async function getSaldoColumnsForForm(
  formId: string,
  phase: SaldoPhase
): Promise<string[]> {
  const data = await loadFormCorrespondence();
  const fc = data.forms.find((f) => f.formId === formId);
  if (!fc) return [];
  if (phase === "previous_period") {
    return parseSaldoColumnRule(fc.saldoYellow);
  }
  return parseSaldoColumnRule(fc.saldoRed);
}

function rowKey(row: RowData): string {
  return String(row.num ?? "").trim();
}

function copySaldoColumns(
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

/** Transfer saldo using FormCorrespondence Yellow/Red column rules. */
export async function transferSaldoByColumns(
  options: SaldoTransferOptions
): Promise<SaldoTransferResult> {
  const { source, target, phase } = options;
  if (source.templateId !== target.templateId) {
    throw new Error(
      `Формы должны совпадать: ${source.templateId} ≠ ${target.templateId}`
    );
  }
  const columns = await getSaldoColumnsForForm(target.templateId, phase);
  if (columns.length === 0) {
    throw new Error(`Нет правил переноса сальdo для ${target.templateId}`);
  }
  const { rows, updated } = copySaldoColumns(source.rows, target.rows, columns);
  return { rowsUpdated: updated, columnsCopied: columns, rows };
}

/** Detailed saldo using a_tblsaldo rules for a form pair. */
export async function transferSaldoDetailed(
  source: OkoFormInstance,
  target: OkoFormInstance,
  saldoType: "t" | "s" | "g"
): Promise<{ rows: RowData[]; applied: number }> {
  const data = await loadSaldoRules();
  const rules = data.rules.filter(
    (r) =>
      r.targetForm === target.templateId &&
      ((saldoType === "t" && r.saldoT) ||
        (saldoType === "s" && r.saldoS) ||
        (saldoType === "g" && r.saldoG))
  );

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
    if (!srcRow || tgtIdx === undefined || !rule.sourceColumn || !rule.targetColumn)
      continue;
    const val = srcRow[rule.sourceColumn];
    if (val === undefined || val === "") continue;
    if (rows[tgtIdx][rule.targetColumn] !== val) {
      rows[tgtIdx][rule.targetColumn] = val;
      applied++;
    }
  }

  return { rows, applied };
}

/** Count active a_tblsaldo rules for a form and saldo type. */
export async function countSaldoRulesForForm(
  formId: string,
  saldoType: "t" | "s" | "g"
): Promise<number> {
  const data = await loadSaldoRules();
  return data.rules.filter(
    (r) =>
      r.targetForm === formId &&
      ((saldoType === "t" && r.saldoT) ||
        (saldoType === "s" && r.saldoS) ||
        (saldoType === "g" && r.saldoG))
  ).length;
}

export type SaldoTransferMode = "columns" | "detailed";

export function applySaldoToTarget(
  target: OkoFormInstance,
  rows: RowData[]
): OkoFormInstance {
  return { ...target, rows, updatedAt: new Date().toISOString() };
}
