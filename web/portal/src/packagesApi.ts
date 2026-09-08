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
const LOCAL_EXCHANGE_KEY = "oko-package-exchange";

type LocalExchangeMap = Record<
  string,
  {
    lastExportedAt?: string | null;
    lastImportedAt?: string | null;
    importVersion?: number;
  }
>;

function exchangeKeyByPackageId(packageId: string): string {
  return `pkg:${packageId}`;
}

function readLocalExchange(): LocalExchangeMap {
  try {
    const raw = localStorage.getItem(LOCAL_EXCHANGE_KEY);
    if (raw) return JSON.parse(raw) as LocalExchangeMap;
  } catch {
    /* ignore */
  }
  return {};
}

function writeLocalExchange(map: LocalExchangeMap): void {
  localStorage.setItem(LOCAL_EXCHANGE_KEY, JSON.stringify(map));
}

function touchLocalExported(packageId: string, at = new Date().toISOString()): void {
  if (!packageId) return;
  const map = readLocalExchange();
  const key = exchangeKeyByPackageId(packageId);
  const prev = map[key] ?? {};
  map[key] = { ...prev, lastExportedAt: at };
  writeLocalExchange(map);
}

function touchLocalImported(packageId: string, at = new Date().toISOString()): void {
  if (!packageId) return;
  const map = readLocalExchange();
  const key = exchangeKeyByPackageId(packageId);
  const prev = map[key] ?? {};
  const prevVersion = Number(prev.importVersion ?? 0);
  map[key] = {
    ...prev,
    lastImportedAt: at,
    importVersion: prevVersion + 1,
  };
  writeLocalExchange(map);
}

function newLocalPackageGuid(): string {
  return crypto.randomUUID();
}

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
    packageId: newLocalPackageGuid(),
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

export type ListOrganizationsOpts = {
  q?: string;
  limit?: number;
  offset?: number;
};

export async function listOrganizations(
  opts?: ListOrganizationsOpts
): Promise<Organization[]> {
  if (isBackendMode()) {
    const qs = new URLSearchParams();
    if (opts?.q?.trim()) qs.set("q", opts.q.trim());
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    // Default cap matches server (2000) unless caller asks for more explicitly.
    if (opts?.limit == null) qs.set("limit", "2000");
    const q = qs.toString();
    return apiFetch<Organization[]>(`/api/organizations${q ? `?${q}` : ""}`);
  }
  await ensureLocalDefaults();
  let orgs = readLocalOrgs();
  const q = opts?.q?.trim().toLowerCase();
  if (q) {
    orgs = orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.code ?? "").toLowerCase().includes(q) ||
        String(o.zid) === q
    );
  }
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? orgs.length;
  return orgs.slice(offset, offset + limit);
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

export async function updateOrganization(
  zid: number,
  input: { name: string; code?: string | null; parentZid?: number | null }
): Promise<Organization> {
  if (isBackendMode()) {
    return apiFetch<Organization>(`/api/organizations/${zid}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }
  await ensureLocalDefaults();
  const orgs = readLocalOrgs();
  const idx = orgs.findIndex((o) => o.zid === zid);
  if (idx < 0) throw new Error(`Организация ZID=${zid} не найдена`);
  if (input.parentZid != null && input.parentZid === zid) {
    throw new Error("Организация не может быть головной для самой себя");
  }
  const next: Organization = {
    ...orgs[idx],
    name: input.name.trim(),
    code:
      input.code === undefined
        ? orgs[idx].code
        : input.code?.trim() || null,
    parentZid:
      input.parentZid === undefined ? orgs[idx].parentZid : input.parentZid,
  };
  orgs[idx] = next;
  writeLocalOrgs(orgs);
  return next;
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
    packageId: newLocalPackageGuid(),
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

export type CreatePeriodsBulkResult = {
  summary: {
    targets: number;
    created: number;
    reused: number;
    errors: number;
  };
  rows: Array<{
    zid: number;
    organizationName: string;
    eid?: number;
    periodName: string;
    status: "created" | "reused" | "error";
    error?: string;
  }>;
};

/** Open the same calendar period for all (or selected) organizations. */
export async function createPeriodsBulk(input: {
  zids?: number[];
  name?: string;
  periodStart?: string;
  periodEnd?: string;
  quarter: number;
  year: number;
  packageKind?: "OKO" | "BALANCE";
  reuseExisting?: boolean;
}): Promise<CreatePeriodsBulkResult> {
  if (isBackendMode()) {
    return apiFetch<CreatePeriodsBulkResult>("/api/periods/bulk", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  // Local fallback: loop createPeriod with reuse by Q/Y/kind.
  await ensureLocalDefaults();
  const periods = readLocalPeriods();
  const orgs = await listOrganizations();
  const targets =
    input.zids?.length
      ? orgs.filter((o) => input.zids!.includes(o.zid))
      : orgs;
  const kind = input.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const name =
    input.name?.trim() ||
    `${Math.min(4, Math.max(1, input.quarter))} квартал ${input.year}`;
  const rows: CreatePeriodsBulkResult["rows"] = [];
  for (const org of targets) {
    const existing = periods.find(
      (p) =>
        p.zid === org.zid &&
        p.quarter === input.quarter &&
        p.year === input.year &&
        (p.packageKind ?? "OKO") === kind
    );
    if (existing) {
      rows.push({
        zid: org.zid,
        organizationName: org.name,
        eid: existing.eid,
        periodName: existing.name,
        status: "reused",
      });
      continue;
    }
    const created = await createPeriod({
      zid: org.zid,
      name,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      quarter: input.quarter,
      year: input.year,
      packageKind: kind,
    });
    rows.push({
      zid: org.zid,
      organizationName: org.name,
      eid: created.eid,
      periodName: created.name,
      status: "created",
    });
  }
  return {
    summary: {
      targets: rows.length,
      created: rows.filter((r) => r.status === "created").length,
      reused: rows.filter((r) => r.status === "reused").length,
      errors: rows.filter((r) => r.status === "error").length,
    },
    rows,
  };
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

export type FetchPackageWorkspaceOpts = {
  zid?: number;
  periodName?: string;
  packageKind?: "OKO" | "BALANCE";
  q?: string;
  limit?: number;
  offset?: number;
};

export async function fetchPackageCampaigns(opts?: {
  zid?: number;
  packageKind?: "OKO" | "BALANCE";
  q?: string;
}): Promise<
  Array<{
    key: string;
    periodName: string;
    packageKind: "OKO" | "BALANCE";
    periodStart: string | null;
    periodEnd: string | null;
    orgCount: number;
    withoutForms: number;
    openCount: number;
    closedCount: number;
    status: "open" | "closed" | "mixed";
    closableCount: number;
    blockedCloseCount: number;
  }>
> {
  if (!isBackendMode()) {
    const rows = await fetchPackageWorkspace(
      opts?.zid != null ? { zid: opts.zid } : undefined
    );
    // Local fallback: derive from full workspace (small datasets only).
    const byKey = new Map<
      string,
      {
        key: string;
        periodName: string;
        packageKind: "OKO" | "BALANCE";
        periodStart: string | null;
        periodEnd: string | null;
        orgCount: number;
        withoutForms: number;
        openCount: number;
        closedCount: number;
        status: "open" | "closed" | "mixed";
        closableCount: number;
        blockedCloseCount: number;
      }
    >();
    for (const r of rows) {
      if (opts?.packageKind && r.packageKind !== opts.packageKind) continue;
      const key = `${r.periodName}||${r.packageKind}`;
      const prev = byKey.get(key);
      const closed = r.periodStatus === "closed";
      const closable = !closed && r.bpStatus === "completed";
      if (prev) {
        prev.orgCount += 1;
        if (r.filled === 0) prev.withoutForms += 1;
        if (closed) prev.closedCount += 1;
        else prev.openCount += 1;
        if (closable) prev.closableCount += 1;
        else if (!closed) prev.blockedCloseCount += 1;
      } else {
        byKey.set(key, {
          key,
          periodName: r.periodName,
          packageKind: r.packageKind,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          orgCount: 1,
          withoutForms: r.filled === 0 ? 1 : 0,
          openCount: closed ? 0 : 1,
          closedCount: closed ? 1 : 0,
          status: closed ? "closed" : "open",
          closableCount: closable ? 1 : 0,
          blockedCloseCount: !closed && !closable ? 1 : 0,
        });
      }
    }
    for (const c of byKey.values()) {
      if (c.openCount > 0 && c.closedCount > 0) c.status = "mixed";
      else if (c.closedCount > 0 && c.openCount === 0) c.status = "closed";
      else c.status = "open";
    }
    return [...byKey.values()];
  }
  const qs = new URLSearchParams();
  if (opts?.zid != null) qs.set("zid", String(opts.zid));
  if (opts?.packageKind) qs.set("packageKind", opts.packageKind);
  if (opts?.q?.trim()) qs.set("q", opts.q.trim());
  const q = qs.toString();
  return apiFetch(`/api/packages/workspace/campaigns${q ? `?${q}` : ""}`);
}

export async function fetchPackageWorkspace(
  opts?: number | FetchPackageWorkspaceOpts
): Promise<import("./types").PackageWorkspaceRow[]> {
  const normalized: FetchPackageWorkspaceOpts =
    typeof opts === "number" ? { zid: opts } : opts ?? {};
  if (isBackendMode()) {
    const qs = new URLSearchParams();
    if (normalized.zid != null) qs.set("zid", String(normalized.zid));
    if (normalized.periodName) qs.set("periodName", normalized.periodName);
    if (normalized.packageKind) qs.set("packageKind", normalized.packageKind);
    if (normalized.q?.trim()) qs.set("q", normalized.q.trim());
    if (normalized.limit != null) qs.set("limit", String(normalized.limit));
    if (normalized.offset != null) qs.set("offset", String(normalized.offset));
    const q = qs.toString();
    return apiFetch(`/api/packages/workspace${q ? `?${q}` : ""}`);
  }
  const zid = normalized.zid;
  // Local fallback: synthesize from orgs + periods + completeness
  const orgs = await listOrganizations();
  const periods = await listPeriods(zid);
  const exchange = readLocalExchange();
  const rows: import("./types").PackageWorkspaceRow[] = [];
  for (const p of periods) {
    const org = orgs.find((o) => o.zid === p.zid);
    if (!org) continue;
    const c = await fetchPackageCompleteness(p.zid, p.eid);
    let packageId = p.packageId?.trim() || "";
    if (!packageId) {
      packageId = newLocalPackageGuid();
      p.packageId = packageId;
      writeLocalPeriods(periods);
    }
    const mark = exchange[exchangeKeyByPackageId(packageId)];
    rows.push({
      zid: p.zid,
      eid: p.eid,
      packageId,
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
      lastExportedAt: mark?.lastExportedAt ?? null,
      lastImportedAt: mark?.lastImportedAt ?? null,
      importVersion: Number(mark?.importVersion ?? 0),
    });
  }
  let filtered = rows;
  if (normalized.periodName) {
    filtered = filtered.filter((r) => r.periodName === normalized.periodName);
  }
  if (normalized.packageKind) {
    filtered = filtered.filter((r) => r.packageKind === normalized.packageKind);
  }
  if (normalized.q?.trim()) {
    const qq = normalized.q.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.organizationName.toLowerCase().includes(qq) ||
        (r.organizationCode ?? "").toLowerCase().includes(qq)
    );
  }
  const offset = normalized.offset ?? 0;
  if (normalized.limit != null) {
    filtered = filtered.slice(offset, offset + normalized.limit);
  }
  return filtered;
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

/** Bulk construct via background job (progress org i/N). Sync fallback for offline. */
export async function constructPackagesAsync(
  input: import("./types").PackageConstructInput,
  opts?: {
    onProgress?: (job: BackgroundJobStatusDto) => void;
    pollMs?: number;
  }
): Promise<import("./types").PackageConstructResult> {
  if (!isBackendMode()) {
    throw new Error("Конструктор комплектов доступен только в backend-режиме");
  }
  const targets = Array.isArray(input.targets) ? input.targets.length : 0;
  // Small batches stay sync; large campaigns go through the job worker.
  if (targets <= 1) {
    return constructPackages(input);
  }

  const started = await apiFetch<{ jobId: string; status: string }>(
    "/api/packages/construct-async",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  const pollMs = opts?.pollMs ?? 600;
  for (;;) {
    const job = await getBackgroundJob(started.jobId);
    opts?.onProgress?.(job);
    if (job.status === "succeeded") {
      const result = job.result as import("./types").PackageConstructResult | null;
      if (!result || !result.summary) {
        throw new Error("Job finished without result");
      }
      return result;
    }
    if (job.status === "failed") {
      throw new Error(job.errorMessage || job.message || "Ошибка массового создания комплектов");
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
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

export interface BackgroundJobStatusDto {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  progress: number;
  message: string | null;
  payload: Record<string, unknown>;
  result: unknown | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Enqueue create + poll until done (backend). Falls back to sync create offline. */
export async function createReportPackageAsync(
  zid: number,
  eid: number,
  opts?: {
    onProgress?: (job: BackgroundJobStatusDto) => void;
    pollMs?: number;
  }
): Promise<CreatePackageResult> {
  if (!isBackendMode()) {
    return createReportPackage(zid, eid);
  }

  const started = await apiFetch<{ jobId: string; status: string }>(
    "/api/packages/create-async",
    {
      method: "POST",
      body: JSON.stringify({ zid, eid }),
    }
  );
  const pollMs = opts?.pollMs ?? 500;
  const jobKey = `oko.createPackageJob.${zid}.${eid}`;
  try {
    sessionStorage.setItem(jobKey, started.jobId);
  } catch {
    /* ignore */
  }

  for (;;) {
    const job = await getBackgroundJob(started.jobId);
    opts?.onProgress?.(job);
    if (job.status === "succeeded") {
      try {
        sessionStorage.removeItem(jobKey);
      } catch {
        /* ignore */
      }
      const result = job.result as CreatePackageResult | null;
      if (!result || typeof result.created !== "number") {
        throw new Error("Job finished without result");
      }
      return result;
    }
    if (job.status === "failed") {
      try {
        sessionStorage.removeItem(jobKey);
      } catch {
        /* ignore */
      }
      throw new Error(job.errorMessage || job.message || "Ошибка создания комплекта");
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function getBackgroundJob(jobId: string): Promise<BackgroundJobStatusDto> {
  return apiFetch<BackgroundJobStatusDto>(`/api/packages/jobs/${encodeURIComponent(jobId)}`);
}

/** Resume polling a previously started create job (same browser tab session). */
export function peekCreatePackageJobId(zid: number, eid: number): string | null {
  try {
    return sessionStorage.getItem(`oko.createPackageJob.${zid}.${eid}`);
  } catch {
    return null;
  }
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

  const nextPeriods = periods.filter((p) => !(p.zid === zid && p.eid === eid));
  writeLocalPeriods(nextPeriods);
  const oldId = period.packageId;
  if (oldId) {
    const map = readLocalExchange();
    delete map[exchangeKeyByPackageId(oldId)];
    writeLocalExchange(map);
  }

  return { deletedInstances: toDelete.length, periodRemoved: true };
}

/** Matches server BULK_DELETE_MAX; set-based delete handles a full chunk in one transaction. */
const BULK_DELETE_CHUNK = 500;
const BULK_DELETE_CONCURRENCY = 2;
/** Above this — use background job instead of sync HTTP chunks. */
const BULK_DELETE_ASYNC_THRESHOLD = 50;

function normalizeDeleteItems(
  items: Array<{ zid: number; eid: number }>
): Array<{ zid: number; eid: number }> {
  const seen = new Set<string>();
  const unique: Array<{ zid: number; eid: number }> = [];
  for (const raw of items) {
    const zid = Number(raw?.zid);
    const eid = Number(raw?.eid);
    if (!Number.isFinite(zid) || !Number.isFinite(eid) || zid <= 0 || eid <= 0) {
      continue;
    }
    const key = `${zid}:${eid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ zid, eid });
  }
  return unique;
}

/** Large bulk delete via background job (progress org i/N). */
export async function deleteReportPackagesBulkAsync(
  items: Array<{ zid: number; eid: number }>,
  opts?: {
    onProgress?: (job: BackgroundJobStatusDto) => void;
    pollMs?: number;
  }
): Promise<BulkDeletePackageResult> {
  const unique = normalizeDeleteItems(items);
  if (!unique.length) {
    return { deleted: 0, failed: 0, deletedInstances: 0, results: [] };
  }
  if (!isBackendMode()) {
    return deleteReportPackagesBulk(unique, {
      onProgress: (done, total) =>
        opts?.onProgress?.({
          id: "local",
          type: "delete_packages",
          status: "running",
          progress: Math.round((done / total) * 100),
          message: `Удаление: ${done}/${total}`,
          payload: {},
          result: null,
          errorMessage: null,
          errorStack: null,
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
    });
  }
  if (unique.length < BULK_DELETE_ASYNC_THRESHOLD) {
    return deleteReportPackagesBulk(unique, {
      onProgress: (done, total) =>
        opts?.onProgress?.({
          id: "sync",
          type: "delete_packages",
          status: "running",
          progress: Math.round((done / total) * 100),
          message: `Удаление: ${done}/${total}`,
          payload: {},
          result: null,
          errorMessage: null,
          errorStack: null,
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
    });
  }
  const started = await apiFetch<{ jobId: string; status: string }>(
    "/api/packages/bulk-delete-async",
    {
      method: "POST",
      body: JSON.stringify({ items: unique }),
    }
  );
  const pollMs = opts?.pollMs ?? 600;
  for (;;) {
    const job = await getBackgroundJob(started.jobId);
    opts?.onProgress?.(job);
    if (job.status === "succeeded") {
      const result = job.result as BulkDeletePackageResult | null;
      if (!result || typeof result.deleted !== "number") {
        throw new Error("Job finished without result");
      }
      return result;
    }
    if (job.status === "failed") {
      throw new Error(job.errorMessage || job.message || "Ошибка массового удаления");
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function deleteReportPackagesBulk(
  items: Array<{ zid: number; eid: number }>,
  opts?: { onProgress?: (done: number, total: number) => void }
): Promise<BulkDeletePackageResult> {
  const unique = normalizeDeleteItems(items);

  if (isBackendMode()) {
    const results: BulkDeletePackageResult["results"] = [];
    let deleted = 0;
    let failed = 0;
    let deletedInstances = 0;
    const chunks: Array<Array<{ zid: number; eid: number }>> = [];
    for (let i = 0; i < unique.length; i += BULK_DELETE_CHUNK) {
      chunks.push(unique.slice(i, i + BULK_DELETE_CHUNK));
    }
    let completedItems = 0;
    for (let i = 0; i < chunks.length; i += BULK_DELETE_CONCURRENCY) {
      const batch = chunks.slice(i, i + BULK_DELETE_CONCURRENCY);
      const parts = await Promise.all(
        batch.map((chunk) =>
          apiFetch<BulkDeletePackageResult>("/api/packages/bulk-delete", {
            method: "POST",
            body: JSON.stringify({ items: chunk }),
          })
        )
      );
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j]!;
        deleted += part.deleted;
        failed += part.failed;
        deletedInstances += part.deletedInstances;
        results.push(...part.results);
        completedItems += batch[j]!.length;
      }
      opts?.onProgress?.(Math.min(completedItems, unique.length), unique.length);
    }
    return { deleted, failed, deletedInstances, results };
  }

  const results: BulkDeletePackageResult["results"] = [];
  let deleted = 0;
  let failed = 0;
  let deletedInstances = 0;
  for (let i = 0; i < unique.length; i++) {
    const item = unique[i]!;
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
    if ((i + 1) % BULK_DELETE_CHUNK === 0 || i + 1 === unique.length) {
      opts?.onProgress?.(i + 1, unique.length);
    }
  }
  return { deleted, failed, deletedInstances, results };
}

export async function exportReportPackagesBulk(
  items: Array<{ zid: number; eid: number }>
): Promise<{ blob: Blob; filename: string; exported: number; failed: number }> {
  if (!items.length) throw new Error("Выберите хотя бы один комплект");

  if (isBackendMode()) {
    const { apiFetchRaw } = await import("./apiClient");
    const res = await apiFetchRaw("/api/packages/export/bulk", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        message = body.error || body.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="?([^";]+)"?/i.exec(cd);
    const filename = match?.[1] ?? `oko_packages_${items.length}orgs.zip`;
    const exported = Number(res.headers.get("X-Packages-Exported") ?? items.length);
    const failed = Number(res.headers.get("X-Packages-Failed") ?? 0);
    return { blob, filename, exported, failed };
  }

  // Local fallback: build ZIP in browser
  const { buildReportPackage } = await import("./engine/packageExport");
  const { zipStoreFiles } = await import("./engine/zipStore");
  const { listInstances, loadInstance } = await import("./storage");
  const files: Array<{ name: string; data: string }> = [];
  const manifestPackages: Array<Record<string, unknown>> = [];
  let exported = 0;
  let failed = 0;
  const exportedAt = new Date().toISOString();
  for (const item of items) {
    try {
      const summaries = await listInstances({ zid: item.zid, eid: item.eid });
      const instances = [];
      for (const s of summaries) {
        const inst = await loadInstance(s.instanceId);
        if (inst) instances.push(inst);
      }
      if (!instances.length) {
        failed += 1;
        manifestPackages.push({
          zid: item.zid,
          eid: item.eid,
          ok: false,
          error: "Нет форм",
        });
        continue;
      }
      const pkg = await buildReportPackage(instances);
      const org = (pkg.organization || `zid${item.zid}`)
        .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
        .slice(0, 30);
      const filename = `oko_package_${org}_z${item.zid}_e${item.eid}.json`;
      files.push({ name: filename, data: JSON.stringify(pkg, null, 2) });
      manifestPackages.push({
        zid: item.zid,
        eid: item.eid,
        organizationName: pkg.organization,
        periodStart: pkg.periodStart,
        periodEnd: pkg.periodEnd,
        formCount: instances.length,
        filename,
        ok: true,
      });
      exported += 1;
      const packageId =
        (pkg as ReportPackage & { packageId?: string }).packageId ||
        (
          await listPeriods(item.zid).then((ps) =>
            ps.find((p) => p.eid === item.eid)
          )
        )?.packageId;
      if (packageId) touchLocalExported(packageId, exportedAt);
    } catch (e) {
      failed += 1;
      manifestPackages.push({
        zid: item.zid,
        eid: item.eid,
        ok: false,
        error: e instanceof Error ? e.message : "Ошибка",
      });
    }
  }
  if (exported === 0) throw new Error("Не удалось выгрузить ни одного комплекта");
  files.unshift({
    name: "manifest.json",
    data: JSON.stringify({ exportedAt, packages: manifestPackages }, null, 2),
  });
  const zip = zipStoreFiles(files);
  const filename = `oko_packages_${exportedAt.slice(0, 10)}_${exported}orgs.zip`;
  const blob = new Blob([zip], { type: "application/zip" });
  return { blob, filename, exported, failed };
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
  if (result.created > 0 || result.updated > 0 || result.skipped > 0) {
    const periods = await listPeriods(zid);
    const packageId = periods.find((p) => p.eid === eid)?.packageId;
    if (packageId) touchLocalImported(packageId);
  }
  return result;
}

export interface BulkImportPackageItemResult {
  name: string;
  zid: number | null;
  eid: number | null;
  organization: string;
  ok: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
}

export interface BulkImportPackageResult {
  imported: number;
  failed: number;
  created: number;
  updated: number;
  skipped: number;
  results: BulkImportPackageItemResult[];
}

function resolvePackageTarget(
  pkg: ReportPackage,
  fallback?: { zid: number; eid: number } | null
): { zid: number; eid: number } {
  const zid = pkg.zid != null ? Number(pkg.zid) : fallback?.zid;
  const eid = pkg.eid != null ? Number(pkg.eid) : fallback?.eid;
  if (zid == null || eid == null || !Number.isFinite(zid) || !Number.isFinite(eid)) {
    throw new Error(
      `В файле «${pkg.organization || "комплект"}» нет zid/eid — укажите комплект в списке или выгрузите пакет заново`
    );
  }
  return { zid, eid };
}

/** Import one or many packages; target zid/eid taken from each file (optional fallback). */
export async function importReportPackagesBulk(
  packages: Array<{ name: string; package: ReportPackage }>,
  options: {
    overwrite: boolean;
    fallbackTarget?: { zid: number; eid: number } | null;
  }
): Promise<BulkImportPackageResult> {
  const results: BulkImportPackageItemResult[] = [];
  let imported = 0;
  let failed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of packages) {
    try {
      const target = resolvePackageTarget(item.package, options.fallbackTarget);
      const result = await importReportPackage(
        target.zid,
        target.eid,
        item.package,
        options.overwrite
      );
      imported += 1;
      created += result.created;
      updated += result.updated;
      skipped += result.skipped;
      results.push({
        name: item.name,
        zid: target.zid,
        eid: target.eid,
        organization: item.package.organization,
        ok: true,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        error: result.errors.length ? result.errors.slice(0, 2).join("; ") : undefined,
      });
    } catch (e) {
      failed += 1;
      results.push({
        name: item.name,
        zid: item.package.zid ?? null,
        eid: item.package.eid ?? null,
        organization: item.package.organization,
        ok: false,
        error: e instanceof Error ? e.message : "Ошибка импорта",
      });
    }
  }

  return { imported, failed, created, updated, skipped, results };
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
