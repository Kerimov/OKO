/** Stub for portal `api.ts` — Tauri loads from publicDir (portal/public),
 * with optional overlay from package `app_meta` (rules synced from ЦО). */
import { invoke } from "@tauri-apps/api/core";
import type { FormCatalog } from "@portal/types";

async function readAppMetaJson(key: string): Promise<unknown | null> {
  try {
    const raw = await invoke<string | null>("get_app_meta", { key });
    if (!raw?.trim()) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function loadJsonPreferMeta(
  metaKey: string,
  url: string,
  fallback: unknown
): Promise<unknown> {
  const fromMeta = await readAppMetaJson(metaKey);
  if (fromMeta != null) return fromMeta;
  const res = await fetch(url);
  if (!res.ok) return fallback;
  return res.json();
}

export async function loadCatalog(): Promise<FormCatalog> {
  const res = await fetch("/schemas/catalog.json");
  if (!res.ok) throw new Error("Каталог форм не найден");
  return res.json();
}

export async function loadChecks(): Promise<{ checks: unknown[] }> {
  const data = await loadJsonPreferMeta("rules_checks", "/data/checks.json", {
    checks: [],
  });
  if (Array.isArray(data)) return { checks: data };
  const obj = data as { checks?: unknown[] };
  return { checks: obj.checks ?? [] };
}

export async function loadRecalcRules(): Promise<unknown> {
  return loadJsonPreferMeta("rules_recalc", "/data/recalc-rules.json", {
    byForm: {},
  });
}

export async function loadRowFormulas(): Promise<unknown> {
  return loadJsonPreferMeta("rules_row_formulas", "/data/row-formulas.json", {
    byForm: {},
  });
}

export async function loadRashRules(): Promise<unknown> {
  return loadJsonPreferMeta("rules_rash", "/data/rash-rules.json", {
    rules: [],
    thresholds: { level1: 0, level2: 0, level3: 0 },
  });
}

export async function loadFormCorrespondence(): Promise<unknown> {
  return loadJsonPreferMeta(
    "rules_correspondence",
    "/data/form-correspondence.json",
    { forms: [] }
  );
}

export async function loadSaldoRules(): Promise<unknown> {
  return loadJsonPreferMeta("rules_saldo", "/data/saldo-rules.json", {
    rules: [],
  });
}

export async function loadKontrAgents(): Promise<unknown> {
  const data = await loadJsonPreferMeta("rules_kontr", "/data/kontr.json", []);
  if (Array.isArray(data)) return data;
  const obj = data as { items?: unknown; agents?: unknown };
  return obj.items ?? obj.agents ?? data;
}

export interface ReorgCheckRule {
  variant: 1 | 2 | 3 | 4;
  number: number;
  expression: string;
  expressionAlt?: string | null;
  message?: string | null;
  reorg?: string | null;
}

export interface ReorgChecksData {
  version?: string;
  source?: string;
  total?: number;
  checks: ReorgCheckRule[];
}

export async function loadReorgChecks(): Promise<ReorgChecksData> {
  const data = await loadJsonPreferMeta(
    "rules_checks_reorg",
    "/data/checks-reorg.json",
    { checks: [] }
  );
  if (Array.isArray(data)) return { checks: data as ReorgCheckRule[] };
  const obj = data as ReorgChecksData;
  return { ...obj, checks: obj.checks ?? [] };
}
