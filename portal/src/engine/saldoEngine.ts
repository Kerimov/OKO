import { loadFormCorrespondence, loadSaldoRules } from "../api";
import type { OkoFormInstance, RowData } from "../types";
import {
  applySaldoDetailedRules,
  applySaldoToTarget,
  compareSaldoWithColumns,
  parseSaldoColumnRule,
  ruleMatchesSaldoType,
  transferSaldoWithColumns,
  type SaldoCompareResult,
  type SaldoPhase,
  type SaldoTransferResult,
} from "@oko/engine";

export type { SaldoPhase, SaldoTransferResult, SaldoCompareResult };
export { parseSaldoColumnRule, applySaldoToTarget };

export interface SaldoTransferOptions {
  source: OkoFormInstance;
  target: OkoFormInstance;
  phase: SaldoPhase;
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

/** Transfer saldo using FormCorrespondence Yellow/Red column rules. */
export async function transferSaldoByColumns(
  options: SaldoTransferOptions
): Promise<SaldoTransferResult> {
  const { source, target, phase } = options;
  const columns = await getSaldoColumnsForForm(target.templateId, phase);
  return transferSaldoWithColumns(source, target, columns);
}

/** Dry-run: compare cells that would change (Access «Только проверить»). */
export async function compareSaldoByColumns(
  options: SaldoTransferOptions
): Promise<SaldoCompareResult> {
  const { source, target, phase } = options;
  const columns = await getSaldoColumnsForForm(target.templateId, phase);
  return compareSaldoWithColumns(source, target, columns);
}

/** Detailed saldo using a_tblsaldo rules for a form pair. */
export async function transferSaldoDetailed(
  source: OkoFormInstance,
  target: OkoFormInstance,
  saldoType: "t" | "s" | "g"
): Promise<{ rows: RowData[]; applied: number }> {
  const data = await loadSaldoRules();
  const rules = data.rules.filter(
    (r) => r.targetForm === target.templateId && ruleMatchesSaldoType(r, saldoType)
  );
  return applySaldoDetailedRules(source, target, rules, saldoType);
}

/** Count active a_tblsaldo rules for a form and saldo type. */
export async function countSaldoRulesForForm(
  formId: string,
  saldoType: "t" | "s" | "g"
): Promise<number> {
  const data = await loadSaldoRules();
  return data.rules.filter(
    (r) => r.targetForm === formId && ruleMatchesSaldoType(r, saldoType)
  ).length;
}

export type SaldoTransferMode = "columns" | "detailed";
