/** Stub for portal `api.ts` — Tauri loads from publicDir (portal/public). */
import type { FormCatalog } from "@portal/types";

export async function loadCatalog(): Promise<FormCatalog> {
  const res = await fetch("/schemas/catalog.json");
  if (!res.ok) throw new Error("Каталог форм не найден");
  return res.json();
}

export async function loadChecks(): Promise<{ checks: unknown[] }> {
  const res = await fetch("/data/checks.json");
  if (!res.ok) return { checks: [] };
  return res.json();
}

export async function loadRecalcRules(): Promise<unknown> {
  const res = await fetch("/data/recalc-rules.json");
  if (!res.ok) return { byForm: {} };
  return res.json();
}

export async function loadRowFormulas(): Promise<unknown> {
  const res = await fetch("/data/row-formulas.json");
  if (!res.ok) return { byForm: {} };
  return res.json();
}

export async function loadRashRules(): Promise<unknown> {
  const res = await fetch("/data/rash-rules.json");
  if (!res.ok) return { rules: [], thresholds: { level1: 0, level2: 0, level3: 0 } };
  return res.json();
}

export async function loadFormCorrespondence(): Promise<unknown> {
  const res = await fetch("/data/form-correspondence.json");
  if (!res.ok) return { forms: [] };
  return res.json();
}

export async function loadSaldoRules(): Promise<unknown> {
  const res = await fetch("/data/saldo-rules.json");
  if (!res.ok) return { rules: [] };
  return res.json();
}

export async function loadKontrAgents(): Promise<unknown> {
  const res = await fetch("/data/kontr.json");
  if (!res.ok) return [];
  const data = await res.json();
  return data.agents ?? data;
}
