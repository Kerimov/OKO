/**
 * Access F1: «Принять-Сохранить справочники» — займы (KZS) и объекты НЗС.
 * File handoff HQ → филиал (отдельный пакет, не ReportPackage форм).
 */

import { apiFetch } from "../apiClient";
import { isBackendMode } from "../storage";
import type { RashRefItem, RashRefsData } from "./rashRefs";

export const KZS_GROUP = "Крупнейшие заёмные средства";
export const NZS_GROUP = "Объекты НЗС";
export const LOAN_NZS_GROUPS = [KZS_GROUP, NZS_GROUP] as const;

export type LoanNzsGroupName = (typeof LOAN_NZS_GROUPS)[number];

export interface LoanNzsItem {
  kod: string;
  value: string;
  note?: string | null;
  newkod?: string | null;
  creditor?: string | null;
  dateStart?: string | null;
  dateFinish?: string | null;
  currency?: string | null;
  percent?: string | null;
  vfo?: string | null;
  period?: string | null;
  idObdnsi?: string | null;
  idKontr?: string | null;
  use?: boolean;
  dateRevision?: string | null;
  comment?: string | null;
}

export interface LoansNzsPackage {
  version: string;
  kind: "loans-nzs-refs";
  exportedAt: string;
  source?: string;
  organization?: string;
  zid?: number | null;
  groups: Record<string, LoanNzsItem[]>;
  counts?: Record<string, number>;
}

const LOCAL_KEY = "oko.loansNzRefs";
const SETTINGS_KEY = "loansNzRefs";

function itemKey(item: LoanNzsItem): string {
  return (item.newkod || item.kod || item.value || "").trim().toLowerCase();
}

export function loanItemToRashRef(item: LoanNzsItem): RashRefItem {
  return {
    kod: item.newkod || item.kod || item.value,
    value: item.value || item.kod,
    note: item.note ?? null,
  };
}

export function mergeLoanGroups(
  base: Record<string, LoanNzsItem[]>,
  incoming: Record<string, LoanNzsItem[]>,
  mode: "replace" | "merge" = "merge"
): Record<string, LoanNzsItem[]> {
  const out: Record<string, LoanNzsItem[]> = {};
  for (const g of LOAN_NZS_GROUPS) {
    if (mode === "replace") {
      out[g] = [...(incoming[g] ?? [])];
      continue;
    }
    const map = new Map<string, LoanNzsItem>();
    for (const it of base[g] ?? []) {
      const k = itemKey(it);
      if (k) map.set(k, it);
    }
    for (const it of incoming[g] ?? []) {
      const k = itemKey(it);
      if (k) map.set(k, it);
      else map.set(`_${map.size}_${it.value}`, it);
    }
    out[g] = Array.from(map.values()).sort((a, b) =>
      (a.value || "").localeCompare(b.value || "", "ru")
    );
  }
  return out;
}

export async function loadBundledLoansNzs(): Promise<LoansNzsPackage | null> {
  try {
    const res = await fetch("/data/loans-nzs-refs.json");
    if (!res.ok) return null;
    const data = (await res.json()) as LoansNzsPackage;
    if (!data?.groups) return null;
    return data;
  } catch {
    return null;
  }
}

async function readStoredOverlay(): Promise<LoansNzsPackage | null> {
  if (isBackendMode()) {
    try {
      const settings = await apiFetch<Record<string, string>>("/api/settings");
      const raw = settings[SETTINGS_KEY];
      if (!raw) return null;
      return JSON.parse(raw) as LoansNzsPackage;
    } catch {
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LoansNzsPackage;
  } catch {
    return null;
  }
}

export async function saveLoansNzsOverlay(pkg: LoansNzsPackage): Promise<void> {
  const payload: LoansNzsPackage = {
    ...pkg,
    kind: "loans-nzs-refs",
    version: pkg.version || "1.0",
    exportedAt: pkg.exportedAt || new Date().toISOString(),
  };
  if (isBackendMode()) {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ [SETTINGS_KEY]: JSON.stringify(payload) }),
    });
    return;
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
}

/** Effective KZS/NZS catalogue: overlay > bundled seed. */
export async function loadEffectiveLoansNzs(): Promise<LoansNzsPackage> {
  const overlay = await readStoredOverlay();
  if (overlay?.groups) return overlay;
  const bundled = await loadBundledLoansNzs();
  if (bundled) {
    return {
      ...bundled,
      exportedAt: bundled.exportedAt || new Date().toISOString(),
      kind: "loans-nzs-refs",
      version: bundled.version || "1.0",
    };
  }
  return {
    version: "1.0",
    kind: "loans-nzs-refs",
    exportedAt: new Date().toISOString(),
    groups: { [KZS_GROUP]: [], [NZS_GROUP]: [] },
    counts: { [KZS_GROUP]: 0, [NZS_GROUP]: 0 },
  };
}

export function buildLoansNzsPackage(
  groups: Record<string, LoanNzsItem[]>,
  meta?: { organization?: string; zid?: number | null; source?: string }
): LoansNzsPackage {
  const normalized: Record<string, LoanNzsItem[]> = {};
  for (const g of LOAN_NZS_GROUPS) {
    normalized[g] = [...(groups[g] ?? [])];
  }
  return {
    version: "1.0",
    kind: "loans-nzs-refs",
    exportedAt: new Date().toISOString(),
    source: meta?.source,
    organization: meta?.organization,
    zid: meta?.zid ?? null,
    groups: normalized,
    counts: Object.fromEntries(
      LOAN_NZS_GROUPS.map((g) => [g, normalized[g].length])
    ),
  };
}

export async function downloadLoansNzsPackage(
  pkg?: LoansNzsPackage
): Promise<LoansNzsPackage> {
  const data = pkg ?? (await loadEffectiveLoansNzs());
  const out = buildLoansNzsPackage(data.groups, {
    organization: data.organization,
    zid: data.zid,
    source: data.source,
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oko-loans-nzs-${out.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return out;
}

export async function readLoansNzsPackageFile(file: File): Promise<LoansNzsPackage> {
  const text = await file.text();
  const data = JSON.parse(text) as LoansNzsPackage;
  if (!data?.groups || typeof data.groups !== "object") {
    throw new Error("Неверный файл справочников займов/НЗС");
  }
  return data;
}

export async function importLoansNzsPackage(
  incoming: LoansNzsPackage,
  mode: "replace" | "merge" = "merge"
): Promise<{ package: LoansNzsPackage; added: number; total: number }> {
  const current = await loadEffectiveLoansNzs();
  const groups = mergeLoanGroups(current.groups, incoming.groups ?? {}, mode);
  const pkg = buildLoansNzsPackage(groups, {
    organization: incoming.organization || current.organization,
    zid: incoming.zid ?? current.zid,
    source: incoming.source || current.source,
  });
  await saveLoansNzsOverlay(pkg);
  const before = LOAN_NZS_GROUPS.reduce(
    (n, g) => n + (current.groups[g]?.length ?? 0),
    0
  );
  const total = LOAN_NZS_GROUPS.reduce((n, g) => n + (groups[g]?.length ?? 0), 0);
  return { package: pkg, added: Math.max(0, total - before), total };
}

/** Apply KZS/NZS overlay into rash-refs for dropdown consumers. */
export function applyLoansNzsToRashRefs(
  refs: RashRefsData,
  loans: LoansNzsPackage
): RashRefsData {
  const byName = { ...(refs.byName ?? {}) };
  for (const g of LOAN_NZS_GROUPS) {
    const items = loans.groups[g] ?? [];
    if (items.length === 0) continue;
    byName[g] = items.map(loanItemToRashRef);
  }
  return {
    ...refs,
    byName,
    total: Object.values(byName).reduce((n, arr) => n + arr.length, 0),
    groups: Object.keys(byName).length,
  };
}
