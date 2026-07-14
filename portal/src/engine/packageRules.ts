import {
  loadChecks,
  loadFormCorrespondence,
  loadRashRules,
  loadRecalcRules,
  loadReorgChecks,
  loadRowFormulas,
  loadSaldoRules,
  type ReorgChecksData,
} from "../api";
import type {
  ChecksData,
  FormCorrespondenceData,
  RecalcRulesData,
  RowFormulasData,
  SaldoRulesData,
} from "../api";
import { loadKontrAgents } from "../storage";
import type { KontrAgent, RashRulesData } from "../types";
import { apiFetch } from "../apiClient";
import { isBackendMode } from "../storage";

export interface MethodologyChecksums {
  checks?: string;
  rash?: string;
  recalc?: string;
  rowFormulas?: string;
  saldo?: string;
  correspondence?: string;
  kontr?: string;
}

/** Правила и справочники, выгружаемые ЦО вместе с комплектом для дочки. */
export interface PackageRulesBundle {
  kind?: "methodology-release";
  version?: string;
  exportedAt: string;
  activatedAt?: string | null;
  source?: string | null;
  checksums?: MethodologyChecksums;
  checks?: ChecksData;
  rash?: RashRulesData;
  recalc?: RecalcRulesData;
  rowFormulas?: RowFormulasData;
  saldo?: SaldoRulesData;
  correspondence?: FormCorrespondenceData;
  kontr?: { items: KontrAgent[] };
  /** Access CheckItReorg* catalogues for desktop package sync. */
  checksReorg?: ReorgChecksData;
}

export type MethodologyRelease = PackageRulesBundle & {
  kind: "methodology-release";
  version: string;
  id?: string;
  active?: boolean;
  checksums: MethodologyChecksums;
};

function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) out[key] = normalize(obj[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

async function sha256Hex(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildMethodologyChecksums(parts: {
  checks?: unknown;
  rash?: unknown;
  recalc?: unknown;
  rowFormulas?: unknown;
  saldo?: unknown;
  correspondence?: unknown;
  kontr?: unknown;
}): Promise<MethodologyChecksums> {
  const out: MethodologyChecksums = {};
  if (parts.checks != null) out.checks = await sha256Hex(parts.checks);
  if (parts.rash != null) out.rash = await sha256Hex(parts.rash);
  if (parts.recalc != null) out.recalc = await sha256Hex(parts.recalc);
  if (parts.rowFormulas != null) out.rowFormulas = await sha256Hex(parts.rowFormulas);
  if (parts.saldo != null) out.saldo = await sha256Hex(parts.saldo);
  if (parts.correspondence != null) out.correspondence = await sha256Hex(parts.correspondence);
  if (parts.kontr != null) out.kontr = await sha256Hex(parts.kontr);
  return out;
}

/** Актуальные правила с портала (БД или JSON-фолбэк). */
export async function loadPackageRulesBundle(): Promise<PackageRulesBundle> {
  const [checks, checksReorg, rash, recalc, rowFormulas, saldo, correspondence, kontrItems] =
    await Promise.all([
      loadChecks(),
      loadReorgChecks().catch(
        (): ReorgChecksData => ({
          version: "0",
          source: "none",
          total: 0,
          checks: [],
        })
      ),
      loadRashRules(),
      loadRecalcRules(),
      loadRowFormulas(),
      loadSaldoRules(),
      loadFormCorrespondence(),
      loadKontrAgents(),
    ]);

  const parts = {
    checks,
    rash,
    recalc,
    rowFormulas,
    saldo,
    correspondence,
    kontr: { items: kontrItems },
  };
  const checksums = await buildMethodologyChecksums(parts);
  const version = `bundle-${new Date().toISOString().slice(0, 10)}`;

  return {
    kind: "methodology-release",
    version,
    exportedAt: new Date().toISOString(),
    checksums,
    checksReorg,
    ...parts,
  };
}

export async function fetchActiveMethodology(): Promise<MethodologyRelease | null> {
  if (!isBackendMode()) return null;
  try {
    const data = await apiFetch<MethodologyRelease | { active: false }>("/api/methodology");
    if (!data || (data as { active?: boolean }).active === false) return null;
    if (!(data as MethodologyRelease).version) return null;
    return data as MethodologyRelease;
  } catch {
    return null;
  }
}

export async function snapshotMethodology(version?: string): Promise<MethodologyRelease> {
  return apiFetch<MethodologyRelease>("/api/methodology/snapshot", {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export async function activateMethodology(
  release: MethodologyRelease
): Promise<MethodologyRelease> {
  return apiFetch<MethodologyRelease>("/api/methodology/activate", {
    method: "POST",
    body: JSON.stringify(release),
  });
}

export async function listMethodologyHistory(limit = 50): Promise<MethodologyRelease[]> {
  if (!isBackendMode()) return [];
  return apiFetch<MethodologyRelease[]>(
    `/api/methodology/history?limit=${encodeURIComponent(String(limit))}`
  );
}

export async function rollbackMethodology(id: string): Promise<MethodologyRelease> {
  return apiFetch<MethodologyRelease>("/api/methodology/rollback", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export async function diffMethodologyReleases(
  rightId: string,
  leftId?: string | null
): Promise<{
  left: MethodologyRelease | null;
  right: MethodologyRelease | null;
  diff: Array<{
    key: string;
    left: string | null;
    right: string | null;
    same: boolean;
  }>;
}> {
  const q = new URLSearchParams();
  q.set("right", rightId);
  if (leftId) q.set("left", leftId);
  return apiFetch(`/api/methodology/diff?${q}`);
}
