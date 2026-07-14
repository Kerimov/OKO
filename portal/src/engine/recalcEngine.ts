import { loadRecalcRules, loadRowFormulas } from "../api";
import type { FormSchema, OkoFormInstance, RowData } from "../types";
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

export type RecalcPackageItem = {
  instanceId: string;
  templateId: string;
  displayName: string;
  ok: boolean;
  changed: boolean;
  error?: string;
};

export type RecalcPackagePrepareResult = {
  /** False if any form failed to recalculate — do not save. */
  ok: boolean;
  computed: OkoFormInstance[];
  items: RecalcPackageItem[];
  changedCount: number;
};

function rowsFingerprint(rows: RowData[]): string {
  return JSON.stringify(rows);
}

/**
 * Recalculate every form in memory first. If any form fails, `ok` is false and
 * `computed` is empty — caller must not persist partial results.
 */
export async function prepareRecalcPackage(
  instances: OkoFormInstance[],
  loadSchema: (templateId: string) => Promise<FormSchema>
): Promise<RecalcPackagePrepareResult> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);

  const schemaCache = new Map<string, FormSchema>();
  const items: RecalcPackageItem[] = [];
  const computed: OkoFormInstance[] = [];
  let failed = false;

  for (const inst of instances) {
    try {
      let schema = schemaCache.get(inst.templateId);
      if (!schema) {
        schema = await loadSchema(inst.templateId);
        schemaCache.set(inst.templateId, schema);
      }
      const rules = rulesForForm(modern, legacy, schema.id);
      const rows = recalcRowsFull(schema, inst.rows, rules);
      const changed = rowsFingerprint(rows) !== rowsFingerprint(inst.rows);
      computed.push({ ...inst, rows });
      items.push({
        instanceId: inst.instanceId,
        templateId: inst.templateId,
        displayName: inst.displayName,
        ok: true,
        changed,
      });
    } catch (e) {
      failed = true;
      items.push({
        instanceId: inst.instanceId,
        templateId: inst.templateId,
        displayName: inst.displayName,
        ok: false,
        changed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const changedCount = items.filter((i) => i.ok && i.changed).length;
  if (failed) {
    return { ok: false, computed: [], items, changedCount: 0 };
  }
  return { ok: true, computed, items, changedCount };
}
