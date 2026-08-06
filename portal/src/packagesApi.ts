import { apiFetch } from "./apiClient";
import { loadCatalog, loadSchema } from "./api";
import { isBackendMode, loadGlobalMeta, saveInstance, listInstances, defaultDisplayName, deleteInstance } from "./storage";
import { buildInitialRows } from "./utils";
import type {
  BulkDeletePackageResult,
  CreatePackageResult,
  DeletePackageResult,
  Organization,
  PackageCompleteness,
  PackageDashboardRow,
  ReportingPeriod,
  WorkContext,
} from "./types";
import type { ReportPackage } from "./engine/packageExport";
import type { ImportPackageResult } from "./engine/packageImport";

const LOCAL_ORGS_KEY = "oko-local-orgs";
const LOCAL_PERIODS_KEY = "oko-local-periods";
const LOCAL_WORK_CTX_KEY = "oko-work-context";

function readLocalOrgs(): Organization[] {
  try {
    const raw = localStorage.getItem(LOCAL_ORGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function writeLocalOrgs(orgs: Organization[]): void {
  localStorage.setItem(LOCAL_ORGS_KEY, JSON.stringify(orgs));
}

function readLocalPeriods(): ReportingPeriod[] {
  try {
    const raw = localStorage.getItem(LOCAL_PERIODS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function writeLocalPeriods(periods: ReportingPeriod[]): void {
  localStorage.setItem(LOCAL_PERIODS_KEY, JSON.stringify(periods));
}

async function ensureLocalDefaults(): Promise<void> {
  if (readLocalOrgs().length > 0) return;
  const meta = await loadGlobalMeta();
  const org: Organization = {
    zid: 1,
    name: meta.organization.trim() || "Организация по умолчанию",
    code: null,
    parentZid: null,
  };
  const period: ReportingPeriod = {
    eid: 1,
    zid: 1,
    name:
      meta.periodStart && meta.periodEnd
        ? `${meta.periodStart} — ${meta.periodEnd}`
        : "Текущий период",
    periodStart: meta.periodStart || null,
    periodEnd: meta.periodEnd || null,
    quarter: null,
    year: null,
  };
  writeLocalOrgs([org]);
  writeLocalPeriods([period]);
  localStorage.setItem(LOCAL_WORK_CTX_KEY, JSON.stringify({ zid: 1, eid: 1 }));
}

export async function listOrganizations(): Promise<Organization[]> {
  if (isBackendMode()) {
    return apiFetch<Organization[]>("/api/organizations");
  }
  await ensureLocalDefaults();
  return readLocalOrgs();
}

export async function createOrganization(input: {
  name: string;
  code?: string;
  parentZid?: number | null;
}): Promise<Organization> {
  if (isBackendMode()) {
    return apiFetch<Organization>("/api/organizations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  await ensureLocalDefaults();
  const orgs = readLocalOrgs();
  const zid = Math.max(0, ...orgs.map((o) => o.zid)) + 1;
  const org: Organization = {
    zid,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    parentZid: input.parentZid ?? null,
  };
  orgs.push(org);
  writeLocalOrgs(orgs);
  return org;
}

export async function listPeriods(zid?: number): Promise<ReportingPeriod[]> {
  if (isBackendMode()) {
    const q = zid != null ? `?zid=${zid}` : "";
    return apiFetch<ReportingPeriod[]>(`/api/periods${q}`);
  }
  await ensureLocalDefaults();
  const periods = readLocalPeriods();
  return zid != null ? periods.filter((p) => p.zid === zid) : periods;
}

export async function createPeriod(input: {
  zid: number;
  name: string;
  periodStart?: string;
  periodEnd?: string;
  quarter?: number;
  year?: number;
  methodologyReleaseId?: string | null;
  packageKind?: "OKO" | "BALANCE";
  collectionUnitZid?: number | null;
}): Promise<ReportingPeriod> {
  if (isBackendMode()) {
    return apiFetch<ReportingPeriod>("/api/periods", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  await ensureLocalDefaults();
  const periods = readLocalPeriods();
  const eid = Math.max(0, ...periods.map((p) => p.eid)) + 1;
  const period: ReportingPeriod = {
    eid,
    zid: input.zid,
    name: input.name.trim(),
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd || null,
    quarter: input.quarter ?? null,
    year: input.year ?? null,
    periodStatus: "open",
    methodologyReleaseId: input.methodologyReleaseId ?? null,
    packageKind: input.packageKind === "BALANCE" ? "BALANCE" : "OKO",
    collectionUnitZid: input.collectionUnitZid ?? input.zid,
  };
  periods.push(period);
  writeLocalPeriods(periods);
  return period;
}

export async function closePeriod(
  zid: number,
  eid: number,
  opts?: { requireAccepted?: boolean }
): Promise<{
  eid: number;
  zid: number;
  periodStatus: "closed";
  closedAt: string;
}> {
  return apiFetch(`/api/periods/${eid}/close?zid=${zid}`, {
    method: "POST",
    body: JSON.stringify({ requireAccepted: opts?.requireAccepted !== false }),
  });
}

export async function reopenPeriod(
  zid: number,
  eid: number
): Promise<{ eid: number; zid: number; periodStatus: "open" }> {
  return apiFetch(`/api/periods/${eid}/reopen?zid=${zid}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function distributePackagesToChildren(input: {
  parentZid: number;
  sourceEid: number;
  createEmptyPackages?: boolean;
  childZids?: number[];
  fallbackAllOthers?: boolean;
}): Promise<{
  createdPeriods: number;
  createdPackages: number;
  children: Array<{ zid: number; name: string; eid: number; created: number }>;
}> {
  return apiFetch("/api/periods/distribute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loadWorkContext(): Promise<WorkContext> {
  if (isBackendMode()) {
    return apiFetch<WorkContext>("/api/work-context");
  }
  await ensureLocalDefaults();
  try {
    const raw = localStorage.getItem(LOCAL_WORK_CTX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { zid: 1, eid: 1 };
}

export async function saveWorkContext(ctx: WorkContext): Promise<WorkContext> {
  if (isBackendMode()) {
    return apiFetch<WorkContext>("/api/work-context", {
      method: "PUT",
      body: JSON.stringify(ctx),
    });
  }
  localStorage.setItem(LOCAL_WORK_CTX_KEY, JSON.stringify(ctx));
  return ctx;
}

export async function fetchPackageCompleteness(
  zid: number,
  eid: number
): Promise<PackageCompleteness> {
  if (isBackendMode()) {
    return apiFetch<PackageCompleteness>(
      `/api/packages/completeness?zid=${zid}&eid=${eid}`
    );
  }
  const catalog = await loadCatalog();
  const summaries = await listInstances();
  const filtered = summaries.filter((s) => s.zid === zid && s.eid === eid);
  const latestByTemplate = new Map<string, (typeof summaries)[0]>();
  for (const s of filtered) {
    const prev = latestByTemplate.get(s.templateId);
    if (!prev || s.updatedAt > prev.updatedAt) latestByTemplate.set(s.templateId, s);
  }
  const items = catalog.forms.map((f) => {
    const inst = latestByTemplate.get(f.id);
    return {
      formId: f.id,
      title: f.title,
      category: f.category,
      filled: !!inst,
      instanceId: inst?.instanceId,
      displayName: inst?.displayName,
      status: inst?.status,
    };
  });
  const filled = items.filter((i) => i.filled).length;
  const draft = items.filter((i) => i.filled && i.status !== "submitted").length;
  const submitted = items.filter((i) => i.status === "submitted").length;
  return { zid, eid, total: items.length, filled, draft, submitted, items };
}

export async function fetchPackagesDashboard(): Promise<PackageDashboardRow[]> {
  return apiFetch<PackageDashboardRow[]>("/api/packages/dashboard");
}

export async function fetchPackageWorkspace(zid?: number): Promise<
  import("./types").PackageWorkspaceRow[]
> {
  if (isBackendMode()) {
    const q = zid != null ? `?zid=${zid}` : "";
    return apiFetch(`/api/packages/workspace${q}`);
  }
  // Local fallback: synthesize from orgs + periods + completeness
  const orgs = await listOrganizations();
  const periods = await listPeriods(zid);
  const rows: import("./types").PackageWorkspaceRow[] = [];
  for (const p of periods) {
    const org = orgs.find((o) => o.zid === p.zid);
    if (!org) continue;
    const c = await fetchPackageCompleteness(p.zid, p.eid);
    rows.push({
      zid: p.zid,
      eid: p.eid,
      organizationName: org.name,
      organizationCode: org.code ?? null,
      periodName: p.name,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      periodStatus: p.periodStatus === "closed" ? "closed" : "open",
      packageKind: p.packageKind === "BALANCE" ? "BALANCE" : "OKO",
      total: c.total,
      filled: c.filled,
      draft: c.draft,
      submitted: c.submitted,
      percent: c.total > 0 ? Math.round((c.filled / c.total) * 100) : 0,
      bpId: null,
      bpStatus: null,
      curatorUserId: null,
      curatorName: null,
      bpLastChangedAt: null,
      bpIteration: null,
      hasBlockers: false,
      methodologyReleaseId: p.methodologyReleaseId ?? null,
    });
  }
  return rows;
}

export async function fetchPackageWorkspaceDetail(
  zid: number,
  eid: number,
  packageKind?: "OKO" | "BALANCE"
): Promise<import("./types").PackageWorkspaceDetail> {
  if (isBackendMode()) {
    const q = new URLSearchParams({
      zid: String(zid),
      eid: String(eid),
    });
    if (packageKind) q.set("packageKind", packageKind);
    return apiFetch(`/api/packages/workspace/detail?${q.toString()}`);
  }
  const rows = await fetchPackageWorkspace(zid);
  const row = rows.find((r) => r.eid === eid);
  if (!row) throw new Error("Комплект не найден");
  const completeness = await fetchPackageCompleteness(zid, eid);
  return {
    row: {
      ...row,
      total: completeness.total,
      filled: completeness.filled,
      draft: completeness.draft,
      submitted: completeness.submitted,
      percent:
        completeness.total > 0
          ? Math.round((completeness.filled / completeness.total) * 100)
          : 0,
    },
    completeness,
    bp: null,
    blockers: null,
    childOrgCount: 0,
  };
}

export async function previewPackageConstruct(
  input: import("./types").PackageConstructInput
): Promise<import("./types").PackageConstructPreview> {
  if (!isBackendMode()) {
    throw new Error("Конструктор комплектов доступен только в backend-режиме");
  }
  return apiFetch("/api/packages/construct/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function constructPackages(
  input: import("./types").PackageConstructInput
): Promise<import("./types").PackageConstructResult> {
  if (!isBackendMode()) {
    throw new Error("Конструктор комплектов доступен только в backend-режиме");
  }
  return apiFetch("/api/packages/construct", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createReportPackage(
  zid: number,
  eid: number
): Promise<CreatePackageResult> {
  if (isBackendMode()) {
    return apiFetch<CreatePackageResult>("/api/packages/create", {
      method: "POST",
      body: JSON.stringify({ zid, eid }),
    });
  }

  const orgs = await listOrganizations();
  const org = orgs.find((o) => o.zid === zid);
  if (!org) throw new Error("Организация не найдена");

  const periods = await listPeriods(zid);
  const period = periods.find((p) => p.eid === eid);
  if (!period) throw new Error("Период не найден");

  const catalog = await loadCatalog();
  const summaries = await listInstances();
  const existing = new Set(
    summaries.filter((s) => s.zid === zid && s.eid === eid).map((s) => s.templateId)
  );

  const meta = await loadGlobalMeta();
  const now = new Date().toISOString();
  const instanceIds: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const form of catalog.forms) {
    if (existing.has(form.id)) {
      skipped++;
      continue;
    }
    const schema = await loadSchema(form.id);
    const signatures: Record<string, string> = {};
    for (const name of schema.signatures) signatures[name] = "";

    const inst = {
      instanceId: crypto.randomUUID(),
      templateId: schema.id,
      templateTitle: schema.title,
      displayName: defaultDisplayName(schema.id, schema.title, {
        organization: org.name,
        enterpriseCode: meta.enterpriseCode,
        periodStart: period.periodStart ?? "",
        periodEnd: period.periodEnd ?? "",
        unit: meta.unit,
      }),
      zid,
      eid,
      meta: {
        organization: org.name,
        enterpriseCode: meta.enterpriseCode,
        periodStart: period.periodStart ?? "",
        periodEnd: period.periodEnd ?? "",
        unit: schema.meta.unit || meta.unit,
      },
      rows: buildInitialRows(schema),
      signatures,
      createdAt: now,
      updatedAt: now,
    };
    await saveInstance(inst);
    instanceIds.push(inst.instanceId);
    created++;
  }

  return { created, skipped, total: catalog.forms.length, instanceIds };
}

export async function deleteReportPackage(
  zid: number,
  eid: number
): Promise<DeletePackageResult> {
  if (isBackendMode()) {
    return apiFetch<DeletePackageResult>(`/api/packages?zid=${zid}&eid=${eid}`, {
      method: "DELETE",
    });
  }

  const periods = readLocalPeriods();
  const period = periods.find((p) => p.zid === zid && p.eid === eid);
  if (!period) throw new Error("Период не найден");

  const summaries = await listInstances();
  const toDelete = summaries.filter((s) => s.zid === zid && s.eid === eid);
  await Promise.all(toDelete.map((s) => deleteInstance(s.instanceId)));

  writeLocalPeriods(periods.filter((p) => !(p.zid === zid && p.eid === eid)));

  const ctx = await loadWorkContext();
  if (ctx.zid === zid && ctx.eid === eid) {
    const remaining = readLocalPeriods().filter((p) => p.zid === zid);
    await saveWorkContext({ zid, eid: remaining[0]?.eid ?? null });
  }

  return { deletedInstances: toDelete.length, periodRemoved: true };
}

export async function deleteReportPackagesBulk(
  items: Array<{ zid: number; eid: number }>
): Promise<BulkDeletePackageResult> {
  if (isBackendMode()) {
    return apiFetch<BulkDeletePackageResult>("/api/packages/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  }

  const results: BulkDeletePackageResult["results"] = [];
  let deleted = 0;
  let failed = 0;
  let deletedInstances = 0;
  for (const item of items) {
    try {
      const result = await deleteReportPackage(item.zid, item.eid);
      deleted += 1;
      deletedInstances += result.deletedInstances;
      results.push({
        zid: item.zid,
        eid: item.eid,
        ok: true,
        deletedInstances: result.deletedInstances,
      });
    } catch (e) {
      failed += 1;
      results.push({
        zid: item.zid,
        eid: item.eid,
        ok: false,
        error: e instanceof Error ? e.message : "Ошибка удаления",
      });
    }
  }
  return { deleted, failed, deletedInstances, results };
}

export async function importReportPackage(
  zid: number,
  eid: number,
  pkg: ReportPackage,
  overwrite: boolean,
  templateIds?: string[]
): Promise<ImportPackageResult> {
  if (isBackendMode()) {
    return apiFetch<ImportPackageResult>("/api/packages/import", {
      method: "POST",
      body: JSON.stringify({
        zid,
        eid,
        overwrite,
        templateIds: templateIds?.length ? templateIds : undefined,
        package: {
          organization: pkg.organization,
          periodStart: pkg.periodStart,
          periodEnd: pkg.periodEnd,
          instances: pkg.instances,
        },
      }),
    });
  }

  const { loadAllInstances, saveInstance } = await import("./storage");
  const { mergePackageIntoInstances } = await import("./engine/packageImport");
  const existing = await loadAllInstances();
  const { instances, result } = mergePackageIntoInstances(pkg, existing, {
    targetZid: zid,
    targetEid: eid,
    overwrite,
    templateIds,
  });
  for (const inst of instances) {
    await saveInstance(inst);
  }
  return result;
}

export interface PackageInboxItem {
  id: string;
  receivedAt: string;
  actor: string | null;
  filename: string | null;
  sha256: string;
  status: string;
  pkgZid: number | null;
  pkgEid: number | null;
  organization: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  targetZid: number | null;
  targetEid: number | null;
  validationErrors: string[];
  warnings: string[];
  instanceCount: number;
  acceptedAt: string | null;
  rejectedReason: string | null;
}

export async function listPackageInbox(status?: string): Promise<PackageInboxItem[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<PackageInboxItem[]>(`/api/packages/inbox${q}`);
}

export async function receivePackageInbox(input: {
  rawJson: string;
  filename?: string;
  targetZid?: number | null;
  targetEid?: number | null;
}): Promise<PackageInboxItem> {
  return apiFetch<PackageInboxItem>("/api/packages/inbox", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getPackageInboxDetail(id: string): Promise<
  PackageInboxItem & {
    packageJson: {
      version?: string;
      organization?: string;
      periodStart?: string;
      periodEnd?: string;
      zid?: number | null;
      eid?: number | null;
      instances: import("./types").OkoFormInstance[];
      rules?: unknown;
    };
  }
> {
  return apiFetch(`/api/packages/inbox/${encodeURIComponent(id)}`);
}

export async function previewPackageInbox(
  id: string,
  body: { zid: number; eid: number }
): Promise<{
  inbox: PackageInboxItem;
  organization: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  diff: Array<{
    templateId: string;
    title: string;
    verdict: "new" | "same" | "changed" | "only-local";
    selectedDefault: boolean;
  }>;
  summary: {
    new: number;
    same: number;
    changed: number;
    onlyLocal: number;
    selectedDefault: number;
  };
}> {
  const q = `?zid=${encodeURIComponent(String(body.zid))}&eid=${encodeURIComponent(String(body.eid))}`;
  return apiFetch(`/api/packages/inbox/${id}/preview${q}`);
}

export async function acceptPackageInbox(
  id: string,
  body: { zid: number; eid: number; overwrite?: boolean; templateIds?: string[] }
): Promise<{ inbox: PackageInboxItem; result: ImportPackageResult }> {
  return apiFetch(`/api/packages/inbox/${id}/accept`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function rejectPackageInbox(
  id: string,
  reason?: string
): Promise<PackageInboxItem> {
  return apiFetch(`/api/packages/inbox/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
