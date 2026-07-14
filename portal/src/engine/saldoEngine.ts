import { loadFormCorrespondence, loadSaldoRules } from "../api";
import { listPeriods } from "../packagesApi";
import type { OkoFormInstance, RowData } from "../types";
import {
  applySaldoDetailedRules,
  applySaldoToTarget,
  compareSaldoDetailedRules,
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

/** Gate: target period must be open. Source preferred closed (warn if open). */
export async function assertSaldoPeriodGate(
  source: OkoFormInstance,
  target: OkoFormInstance
): Promise<{ warning?: string }> {
  if (target.zid == null || target.eid == null) return {};
  const targetPeriods = await listPeriods(target.zid);
  const tgt = targetPeriods.find((p) => p.eid === target.eid);
  if (tgt?.periodStatus === "closed") {
    throw new Error("Целевой период закрыт — перенос сальдо запрещён");
  }
  if (source.zid != null && source.eid != null && source.eid !== target.eid) {
    const sourcePeriods = await listPeriods(source.zid);
    const src = sourcePeriods.find((p) => p.eid === source.eid);
    if (src && src.periodStatus !== "closed") {
      return {
        warning:
          "Источник не из закрытого периода — по регламенту остатки переносят из закрытого комплекта",
      };
    }
  }
  return {};
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
): Promise<SaldoTransferResult & { warning?: string }> {
  const { source, target, phase } = options;
  const gate = await assertSaldoPeriodGate(source, target);
  const columns = await getSaldoColumnsForForm(target.templateId, phase);
  return { ...transferSaldoWithColumns(source, target, columns), ...gate };
}

/** Dry-run: compare cells that would change (Access «Только проверить»). */
export async function compareSaldoByColumns(
  options: SaldoTransferOptions
): Promise<SaldoCompareResult> {
  const { source, target, phase } = options;
  const columns = await getSaldoColumnsForForm(target.templateId, phase);
  return compareSaldoWithColumns(source, target, columns);
}

function buildCrossFormResolver(
  packageInstances: OkoFormInstance[],
  sourceEid: number | null | undefined
): ((formId: string) => OkoFormInstance | null) | undefined {
  if (sourceEid == null) return undefined;
  return (formId: string) => {
    const hit = packageInstances.find(
      (i) => i.templateId === formId && i.eid === sourceEid
    );
    return hit ?? null;
  };
}

/** Detailed saldo using a_tblsaldo rules for a form pair. */
export async function transferSaldoDetailed(
  source: OkoFormInstance,
  target: OkoFormInstance,
  saldoType: "t" | "s" | "g",
  packageInstances: OkoFormInstance[] = []
): Promise<{ rows: RowData[]; applied: number; warning?: string }> {
  const gate = await assertSaldoPeriodGate(source, target);
  const data = await loadSaldoRules();
  const rules = data.rules.filter(
    (r) => r.targetForm === target.templateId && ruleMatchesSaldoType(r, saldoType)
  );
  const result = applySaldoDetailedRules(source, target, rules, saldoType, {
    includeConditional: true,
    resolveSourceForm: buildCrossFormResolver(packageInstances, source.eid),
  });
  return { ...result, ...gate };
}

export async function compareSaldoDetailed(
  source: OkoFormInstance,
  target: OkoFormInstance,
  saldoType: "t" | "s" | "g",
  packageInstances: OkoFormInstance[] = []
): Promise<SaldoCompareResult> {
  const data = await loadSaldoRules();
  const rules = data.rules.filter(
    (r) => r.targetForm === target.templateId && ruleMatchesSaldoType(r, saldoType)
  );
  return compareSaldoDetailedRules(source, target, rules, saldoType, {
    includeConditional: true,
    resolveSourceForm: buildCrossFormResolver(packageInstances, source.eid),
  });
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
