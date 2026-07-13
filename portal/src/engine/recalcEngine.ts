import { loadRecalcRules, loadRowFormulas } from "../api";
import type { FormSchema, RowData } from "../types";
import {
  mergeRules,
  recalcRows,
  recalcRowsFull,
  type RecalcRule,
  type RowFormula,
} from "@oko/engine";

export type { RecalcRule, RowFormula };
export { recalcRows, recalcRowsFull, mergeRules };

function rulesForForm(
  modern: Awaited<ReturnType<typeof loadRecalcRules>> | null,
  legacy: Awaited<ReturnType<typeof loadRowFormulas>> | null,
  formId: string
): RecalcRule[] {
  return mergeRules(
    modern?.byForm[formId] as RecalcRule[] | undefined,
    legacy?.byForm[formId]
  );
}

export async function recalcForm(
  schema: FormSchema,
  rows: RowData[]
): Promise<RowData[]> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);

  const rules = rulesForForm(modern, legacy, schema.id);

  return recalcRowsFull(schema, rows, rules);
}

export async function countRecalcRules(formId: string): Promise<number> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);
  return rulesForForm(modern, legacy, formId).length;
}

export async function recalcAllForms(
  instances: Array<{ schema: FormSchema; rows: RowData[] }>
): Promise<RowData[][]> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);

  return instances.map(({ schema, rows }) => {
    const rules = rulesForForm(modern, legacy, schema.id);
    return recalcRowsFull(schema, rows, rules);
  });
}
