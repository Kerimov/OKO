/**
 * Editable overlay for Access classifier groups (rash-refs.byName).
 * Stored in app_settings / localStorage — does not rewrite bundled JSON.
 */

import { apiFetch } from "../apiClient";
import { isBackendMode } from "../storage";
import type { RashRefItem, RashRefsData } from "./rashRefs";
import { LOAN_NZS_GROUPS } from "./refsPackage";
import { parseRefFilter } from "./rashEngine";
import type { RashRule } from "../types";

function isLoanOwnedGroup(name: string): boolean {
  return (LOAN_NZS_GROUPS as readonly string[]).includes(name);
}

export const REFS_OVERLAY_SETTINGS_KEY = "rashRefsOverlay";
const LOCAL_KEY = "oko.rashRefsOverlay";

export interface RefsOverlayPackage {
  version: string;
  kind: "rash-refs-overlay";
  updatedAt: string;
  /** Full replacement sets for groups that were edited. */
  byName: Record<string, RashRefItem[]>;
}

export function emptyRefsOverlay(): RefsOverlayPackage {
  return {
    version: "1.0",
    kind: "rash-refs-overlay",
    updatedAt: new Date().toISOString(),
    byName: {},
  };
}

export async function loadRefsOverlay(): Promise<RefsOverlayPackage> {
  if (isBackendMode()) {
    try {
      const settings = await apiFetch<Record<string, string>>("/api/settings");
      const raw = settings[REFS_OVERLAY_SETTINGS_KEY];
      if (raw) {
        const parsed = JSON.parse(raw) as RefsOverlayPackage;
        if (parsed?.byName && typeof parsed.byName === "object") return parsed;
      }
    } catch {
      /* fall through */
    }
  } else {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RefsOverlayPackage;
        if (parsed?.byName && typeof parsed.byName === "object") return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return emptyRefsOverlay();
}

export async function saveRefsOverlay(pkg: RefsOverlayPackage): Promise<void> {
  const byName = { ...pkg.byName };
  // KZS/НЗС владеет loansNzRefs — не храним их в общем overlay.
  for (const g of LOAN_NZS_GROUPS) {
    delete byName[g];
  }
  const next: RefsOverlayPackage = {
    ...pkg,
    byName,
    kind: "rash-refs-overlay",
    version: pkg.version || "1.0",
    updatedAt: new Date().toISOString(),
  };
  if (isBackendMode()) {
    await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ [REFS_OVERLAY_SETTINGS_KEY]: JSON.stringify(next) }),
    });
  } else {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  }
}

export function applyRefsOverlay(
  base: RashRefsData,
  overlay: RefsOverlayPackage | null | undefined
): RashRefsData {
  if (!overlay?.byName || !Object.keys(overlay.byName).length) return base;
  const byName = { ...base.byName };
  for (const [name, items] of Object.entries(overlay.byName)) {
    if (!name.trim() || isLoanOwnedGroup(name)) continue;
    byName[name] = Array.isArray(items) ? items.map((it) => ({ ...it })) : [];
  }
  return {
    ...base,
    byName,
    groups: Object.keys(byName).length,
    total: Object.values(byName).reduce((s, list) => s + list.length, 0),
  };
}

export interface UsedRefDirectory {
  kind: string;
  /** How many rules reference this classifier as A2–A4 (or A1 kind). */
  ruleCount: number;
  itemCount: number;
  /** True when kind is Контрагент (edited in /admin/refs as a table). */
  isKontr: boolean;
  /** True when kind is Организации (portal orgs / ZID). */
  isOrg?: boolean;
  /** True when overlay replaces bundled content. */
  overridden: boolean;
  /** Hide Access-internal helpers by default. */
  technical: boolean;
}

export const ORG_REF_KIND = "Организации";

function isTechnicalGroup(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (n.startsWith("a_") || n.startsWith("a__") || n.startsWith("type ")) return true;
  if (/^a_tbl/i.test(n)) return true;
  return false;
}

/** Collect classifier kinds used by rash rules + all known groups. */
export function listRefDirectories(
  rules: RashRule[],
  refs: RashRefsData,
  overlay?: RefsOverlayPackage | null
): UsedRefDirectory[] {
  const usage = new Map<string, number>();
  const bump = (kind: string | null | undefined) => {
    const k = (kind ?? "").trim();
    if (!k) return;
    usage.set(k, (usage.get(k) ?? 0) + 1);
  };

  for (const rule of rules) {
    for (const spec of [rule.refA1Name, rule.refA2Name, rule.refA3Name, rule.refA4Name]) {
      const parsed = parseRefFilter(spec);
      if (parsed) bump(parsed.kind);
      else if (spec?.trim()) bump(spec.split("/")[0]?.trim());
    }
  }

  // Always surface Контрагент — primary A1 directory.
  if (!usage.has("Контрагент")) usage.set("Контрагент", 0);
  // Portal organizations (ZID) — managed as a directory with cards.
  if (!usage.has(ORG_REF_KIND)) usage.set(ORG_REF_KIND, 0);

  const names = new Set<string>([
    ...Object.keys(refs.byName ?? {}),
    ...Object.keys(overlay?.byName ?? {}),
    ...usage.keys(),
  ]);

  const out: UsedRefDirectory[] = [];
  for (const kind of names) {
    const isKontr = kind.toLowerCase() === "контрагент";
    const isOrg = kind === ORG_REF_KIND;
    const itemCount = isKontr || isOrg ? 0 : (refs.byName[kind]?.length ?? 0);
    out.push({
      kind,
      ruleCount: usage.get(kind) ?? 0,
      itemCount,
      isKontr,
      isOrg,
      overridden: Boolean(overlay?.byName && kind in overlay.byName),
      technical: isTechnicalGroup(kind),
    });
  }

  return out.sort((a, b) => {
    const aPin = a.isKontr || a.isOrg;
    const bPin = b.isKontr || b.isOrg;
    if (aPin !== bPin) return aPin ? -1 : 1;
    if (a.isOrg !== b.isOrg) return a.isOrg ? -1 : 1;
    if (a.isKontr !== b.isKontr) return a.isKontr ? -1 : 1;
    if ((a.ruleCount > 0) !== (b.ruleCount > 0)) return a.ruleCount > 0 ? -1 : 1;
    if (a.technical !== b.technical) return a.technical ? 1 : -1;
    return a.kind.localeCompare(b.kind, "ru");
  });
}
