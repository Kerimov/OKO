/** Stub for portal `api.ts` — Tauri loads rules from public / later from package DB. */
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
