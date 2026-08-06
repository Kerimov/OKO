/**
 * Server-side effective rash-refs: bundled JSON + app_settings overlays.
 * Order matches portal/src/engine/rashRefs.ts: loans overlay, then refs overlay.
 */

import fs from "fs";
import path from "path";
import type { OkoDb } from "./oko-db.js";
import { ROOT } from "./paths.js";

const RASH_REFS_PATH = path.join(ROOT, "portal", "public", "data", "rash-refs.json");

const LOANS_NZ_REFS_KEY = "loansNzRefs";
const REFS_OVERLAY_KEY = "rashRefsOverlay";

const KZS_GROUP = "Крупнейшие заёмные средства";
const NZS_GROUP = "Объекты НЗС";
const LOAN_NZS_GROUPS = [KZS_GROUP, NZS_GROUP] as const;

export interface RashRefItem {
  kod: string;
  value: string;
  note?: string | null;
  newkod?: string | null;
}

export interface RashRefsData {
  version: string;
  source?: string;
  total?: number;
  groups?: number;
  byName: Record<string, RashRefItem[]>;
}

interface LoansNzsPackage {
  groups?: Record<string, Array<{
    kod?: string;
    value?: string;
    note?: string | null;
    newkod?: string | null;
  }>>;
}

interface RefsOverlayPackage {
  byName?: Record<string, RashRefItem[]>;
}

function emptyRefs(): RashRefsData {
  return { version: "0", byName: {} };
}

function loadBundledRashRefs(): RashRefsData {
  try {
    if (!fs.existsSync(RASH_REFS_PATH)) return emptyRefs();
    const data = JSON.parse(fs.readFileSync(RASH_REFS_PATH, "utf-8")) as RashRefsData;
    if (!data?.byName || typeof data.byName !== "object") return emptyRefs();
    return data;
  } catch {
    return emptyRefs();
  }
}

async function readSettingJson<T>(db: OkoDb, key: string): Promise<T | null> {
  const row = (await db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)) as
    | { value: string }
    | undefined;
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function applyLoansNzsToRashRefs(refs: RashRefsData, loans: LoansNzsPackage | null): RashRefsData {
  if (!loans?.groups) return refs;
  const byName = { ...(refs.byName ?? {}) };
  for (const g of LOAN_NZS_GROUPS) {
    const items = loans.groups[g] ?? [];
    if (items.length === 0) continue;
    byName[g] = items.map((item) => ({
      kod: item.newkod || item.kod || item.value || "",
      value: item.value || item.kod || "",
      note: item.note ?? null,
    }));
  }
  return {
    ...refs,
    byName,
    total: Object.values(byName).reduce((n, arr) => n + arr.length, 0),
    groups: Object.keys(byName).length,
  };
}

function applyRefsOverlay(
  base: RashRefsData,
  overlay: RefsOverlayPackage | null
): RashRefsData {
  if (!overlay?.byName || !Object.keys(overlay.byName).length) return base;
  const byName = { ...base.byName };
  for (const [name, items] of Object.entries(overlay.byName)) {
    // KZS/НЗС — только из loansNzRefs (как в portal refsOverlay).
    if (!name.trim() || (LOAN_NZS_GROUPS as readonly string[]).includes(name)) continue;
    byName[name] = Array.isArray(items) ? items.map((it) => ({ ...it })) : [];
  }
  return {
    ...base,
    byName,
    groups: Object.keys(byName).length,
    total: Object.values(byName).reduce((s, list) => s + list.length, 0),
  };
}

/** Effective rash-refs.byName: bundled JSON + loansNzRefs + rashRefsOverlay. */
export async function loadEffectiveRashRefsByName(
  db: OkoDb
): Promise<Record<string, RashRefItem[]>> {
  let base = loadBundledRashRefs();
  const loans = await readSettingJson<LoansNzsPackage>(db, LOANS_NZ_REFS_KEY);
  base = applyLoansNzsToRashRefs(base, loans);
  const overlay = await readSettingJson<RefsOverlayPackage>(db, REFS_OVERLAY_KEY);
  base = applyRefsOverlay(base, overlay);
  return base.byName ?? {};
}

/** Recommend F4/rash articles by optional group + query substring. */
export async function recommendRashArticles(
  db: OkoDb,
  input: { q?: string; group?: string; limit?: number }
): Promise<Array<RashRefItem & { group: string }>> {
  const byName = await loadEffectiveRashRefsByName(db);
  const q = String(input.q ?? "").trim().toLowerCase();
  const groupFilter = String(input.group ?? "").trim();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const out: Array<RashRefItem & { group: string }> = [];
  for (const [group, items] of Object.entries(byName)) {
    if (groupFilter && group !== groupFilter) continue;
    for (const it of items ?? []) {
      if (
        q &&
        !String(it.kod ?? "").toLowerCase().includes(q) &&
        !String(it.value ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({ ...it, group });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
