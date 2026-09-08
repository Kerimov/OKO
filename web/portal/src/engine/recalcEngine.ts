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

type ModernRules = Awaited<ReturnType<typeof loadRecalcRules>>;
type LegacyRules = Awaited<ReturnType<typeof loadRowFormulas>>;

let cachedModern: ModernRules | null | undefined;
let cachedLegacy: LegacyRules | null | undefined;
let modernPromise: Promise<ModernRules | null> | null = null;
let legacyPromise: Promise<LegacyRules | null> | null = null;

async function getModernRules(): Promise<ModernRules | null> {
  if (cachedModern !== undefined) return cachedModern;
  if (!modernPromise) {
    modernPromise = loadRecalcRules()
      .then((data) => {
        cachedModern = data;
        return data;
      })
      .catch(() => {
        cachedModern = null;
        return null;
      })
      .finally(() => {
        modernPromise = null;
      });
  }
  return modernPromise;
}

async function getLegacyRules(): Promise<LegacyRules | null> {
  if (cachedLegacy !== undefined) return cachedLegacy;
  if (!legacyPromise) {
    legacyPromise = loadRowFormulas()
      .then((data) => {
        cachedLegacy = data;
        return data;
      })
      .catch(() => {
        cachedLegacy = null;
        return null;
      })
      .finally(() => {
        legacyPromise = null;
      });
  }
  return legacyPromise;
}

async function loadRulesPair(): Promise<[ModernRules | null, LegacyRules | null]> {
  return Promise.all([getModernRules(), getLegacyRules()]);
}

/** Drop cached recalc/row-formula payloads after admin edits. */
export function clearRecalcCache(): void {
  cachedModern = undefined;
  cachedLegacy = undefined;
  modernPromise = null;
  legacyPromise = null;
}

function rulesForForm(
  modern: ModernRules | null,
  legacy: LegacyRules | null,
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
  const [modern, legacy] = await loadRulesPair();
  const rules = rulesForForm(modern, legacy, schema.id);
  return recalcRowsFull(schema, rows, rules);
}

export async function countRecalcRules(formId: string): Promise<number> {
  const [modern, legacy] = await loadRulesPair();
  return rulesForForm(modern, legacy, formId).length;
}

export async function recalcAllForms(
  instances: Array<{ schema: FormSchema; rows: RowData[] }>
): Promise<RowData[][]> {
  const [modern, legacy] = await loadRulesPair();

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
  const [modern, legacy] = await loadRulesPair();

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
