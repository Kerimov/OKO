/**
 * Form engines for Tauri bridge — mirrors desktop/filler/electron/db/formEngineRunner.ts
 * using portal public assets via fetch.
 */
import { mergeRules, recalcRowsFull, type RecalcRule, type RowFormula } from "@oko/engine";
import {
  countRashRulesForForm,
  validateAllRash,
  type RashValidationIssue,
} from "@portal/engine/rashEngine";
import type {
  FormCatalog,
  FormRashEntry,
  FormSchema,
  KontrAgent,
  RashRulesData,
  RowData,
} from "@portal/types";
import type { RowRashIndexData } from "@portal/engine/rowRashIndex";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/${path.replace(/^\//, "")}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadSchema(formId: string): Promise<FormSchema> {
  const schema = await fetchJson<FormSchema>(`schemas/${formId}.json`);
  if (!schema) throw new Error(`Схема ${formId} не найдена`);
  return schema;
}

export async function loadCatalog(): Promise<FormCatalog> {
  const catalog = await fetchJson<FormCatalog>("schemas/catalog.json");
  if (!catalog) throw new Error("Каталог форм не найден");
  return catalog;
}

async function rulesForForm(formId: string): Promise<RecalcRule[]> {
  const [modern, legacy] = await Promise.all([
    fetchJson<{ byForm?: Record<string, RecalcRule[]> }>("data/recalc-rules.json"),
    fetchJson<{ byForm?: Record<string, RowFormula[]> }>("data/row-formulas.json"),
  ]);
  return mergeRules(modern?.byForm?.[formId], legacy?.byForm?.[formId]);
}

export async function runPackageRecalc(formId: string, rows: RowData[]): Promise<RowData[]> {
  const schema = await loadSchema(formId);
  const rules = await rulesForForm(formId);
  return recalcRowsFull(schema, rows, rules);
}

export async function countPackageRecalcRules(formId: string): Promise<number> {
  return (await rulesForForm(formId)).length;
}

export async function runPackageRashChecks(
  formId: string,
  rows: RowData[],
  rashEntries: FormRashEntry[] = []
): Promise<RashValidationIssue[]> {
  const schema = await loadSchema(formId);
  const data = await fetchJson<RashRulesData>("data/rash-rules.json");
  if (!data) return [];
  const index = (await fetchJson<RowRashIndexData>("data/row-rash-index.json")) ?? undefined;
  const kontrRaw = await fetchJson<{ items?: KontrAgent[]; agents?: KontrAgent[] }>("data/kontr.json");
  const kontrAgents = kontrRaw?.items ?? kontrRaw?.agents ?? [];
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

export async function countPackageRashRules(formId: string): Promise<number> {
  const data = await fetchJson<RashRulesData>("data/rash-rules.json");
  if (!data?.rules) return 0;
  return countRashRulesForForm(formId, data.rules);
}

export async function getPackageKontrAgents(): Promise<KontrAgent[]> {
  const data = await fetchJson<{ items?: KontrAgent[]; agents?: KontrAgent[] }>("data/kontr.json");
  return data?.items ?? data?.agents ?? [];
}

export async function getPackageFormRuleCounts(formId: string): Promise<{
  rashRuleCount: number;
  recalcRuleCount: number;
}> {
  const [rashRuleCount, recalcRuleCount] = await Promise.all([
    countPackageRashRules(formId),
    countPackageRecalcRules(formId),
  ]);
  return { rashRuleCount, recalcRuleCount };
}
