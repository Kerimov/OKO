import type { RowData, FormRashEntry } from "@portal/types";
import type { RashRulesData } from "@portal/types";
import {
  countRashRulesForForm,
  validateAllRash,
  type RashValidationIssue,
} from "@portal/engine/rashEngine";
import {
  recalcRowsFull,
  type RecalcRule,
  type RowFormula,
} from "@portal/engine/recalcEngine";
import { loadSchemaFromDisk, readPublicJson } from "./packageDb.js";

function mergeRecalcRules(
  modern: RecalcRule[] | undefined,
  legacy: RowFormula[] | undefined
): RecalcRule[] {
  const out: RecalcRule[] = [...(modern ?? [])];
  const haveRow = new Set(
    out.filter((r) => r.kind === "rows").map((r) => (r as { rowNo: number }).rowNo)
  );
  for (const lf of legacy ?? []) {
    if (haveRow.has(lf.rowNo)) continue;
    out.push({ kind: "rows", rowNo: lf.rowNo, formula: lf.formula, sign: lf.sign });
  }
  return out;
}

function rulesForForm(formId: string): RecalcRule[] {
  try {
    const modern = readPublicJson("data/recalc-rules.json") as {
      byForm?: Record<string, RecalcRule[]>;
    };
    const legacy = readPublicJson("data/row-formulas.json") as {
      byForm?: Record<string, RowFormula[]>;
    };
    return mergeRecalcRules(modern?.byForm?.[formId], legacy?.byForm?.[formId]);
  } catch {
    return [];
  }
}

export function runPackageRashChecks(
  formId: string,
  rows: RowData[],
  rashEntries: FormRashEntry[] = []
): RashValidationIssue[] {
  const schema = loadSchemaFromDisk(formId);
  const data = readPublicJson("data/rash-rules.json") as RashRulesData;
  let index: import("@portal/engine/rowRashIndex").RowRashIndexData | undefined;
  let kontrAgents: import("@portal/types").KontrAgent[] = [];
  try {
    index = readPublicJson("data/row-rash-index.json") as import("@portal/engine/rowRashIndex").RowRashIndexData;
  } catch {
    index = undefined;
  }
  try {
    const kontr = readPublicJson("data/kontr.json") as { items?: import("@portal/types").KontrAgent[] };
    kontrAgents = kontr.items ?? [];
  } catch {
    kontrAgents = [];
  }
  return validateAllRash(
    formId,
    rows,
    schema.columns,
    rashEntries,
    data,
    index,
    kontrAgents
  );
}

export function countPackageRashRules(formId: string): number {
  try {
    const data = readPublicJson("data/rash-rules.json") as RashRulesData;
    return countRashRulesForForm(formId, data.rules);
  } catch {
    return 0;
  }
}

export function runPackageRecalc(formId: string, rows: RowData[]): RowData[] {
  const schema = loadSchemaFromDisk(formId);
  const rules = rulesForForm(formId);
  return recalcRowsFull(schema, rows, rules);
}

export function countPackageRecalcRules(formId: string): number {
  return rulesForForm(formId).length;
}

export function getPackageKontrAgents(): unknown[] {
  try {
    const data = readPublicJson("data/kontr.json") as { items?: unknown[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

export function getPackageFormRuleCounts(formId: string): {
  rashRuleCount: number;
  recalcRuleCount: number;
} {
  return {
    rashRuleCount: countPackageRashRules(formId),
    recalcRuleCount: countPackageRecalcRules(formId),
  };
}
