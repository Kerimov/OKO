import type { ReportPackage } from "./engine/packageExport";
import { parseReportPackageFile } from "./engine/packageExport";
import { importReportPackage } from "./packagesApi";
import {
  loadGlobalMeta,
  saveGlobalMeta,
  listInstances,
} from "./storage";
import type { Organization, ReportingPeriod } from "./types";

const LOCAL_ORGS_KEY = "oko-local-orgs";
const LOCAL_PERIODS_KEY = "oko-local-periods";
const LOCAL_WORK_CTX_KEY = "oko-work-context";
const OFFLINE_SEEDED_KEY = "oko-offline-seeded";

/** Сборка offline-kit: VITE_OFFLINE_KIT=true */
export function isOfflineKitMode(): boolean {
  return import.meta.env.VITE_OFFLINE_KIT === "true";
}

export async function initOfflineKit(): Promise<void> {
  if (!isOfflineKitMode()) return;
  if (localStorage.getItem(OFFLINE_SEEDED_KEY)) return;

  try {
    const res = await fetch("/offline-package.json", { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    const pkg = parseReportPackageFile(text);
    await applyOfflinePackage(pkg);
    localStorage.setItem(OFFLINE_SEEDED_KEY, "1");
  } catch {
    /* нет seed-файла — пустой offline */
  }
}

export async function applyOfflinePackage(pkg: ReportPackage): Promise<void> {
  const zid = pkg.zid ?? 1;
  const eid = pkg.eid ?? 1;
  const orgName = pkg.organization || pkg.instances[0]?.meta?.organization || "Организация";

  const org: Organization = {
    zid,
    name: orgName,
    code: null,
    parentZid: null,
  };
  const period: ReportingPeriod = {
    eid,
    zid,
    name:
      pkg.periodStart && pkg.periodEnd
        ? `${pkg.periodStart} — ${pkg.periodEnd}`
        : "Отчётный период",
    periodStart: pkg.periodStart || null,
    periodEnd: pkg.periodEnd || null,
    quarter: null,
    year: null,
  };

  localStorage.setItem(LOCAL_ORGS_KEY, JSON.stringify([org]));
  localStorage.setItem(LOCAL_PERIODS_KEY, JSON.stringify([period]));
  localStorage.setItem(LOCAL_WORK_CTX_KEY, JSON.stringify({ zid, eid }));

  const meta = await loadGlobalMeta();
  await saveGlobalMeta({
    ...meta,
    organization: orgName,
    periodStart: pkg.periodStart || meta.periodStart,
    periodEnd: pkg.periodEnd || meta.periodEnd,
  });

  const existing = await listInstances();
  if (existing.length === 0 && pkg.instances.length > 0) {
    await importReportPackage(zid, eid, pkg, true);
  } else if (pkg.instances.length > 0) {
    await importReportPackage(zid, eid, pkg, true);
  }
}

export async function loadOfflinePackageForExport(): Promise<ReportPackage | null> {
  try {
    const res = await fetch("/offline-package.json", { cache: "no-store" });
    if (!res.ok) return null;
    return parseReportPackageFile(await res.text());
  } catch {
    return null;
  }
}
