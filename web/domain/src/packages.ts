import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { dateOrNull, dateToString, intOrNull } from "./dbValues.js";
import { buildInitialRowsFromSchema, exportCatalog, loadFormSchemas, type FormSchemaDto } from "./forms.js";
import {
  deleteInstancesForPackages,
  isLazyCellsEnabled,
  saveInstanceCells,
  saveInstanceHeadersBulk,
} from "./instances.js";
import {
  assertPeriodWritable,
  ensurePeriodFormSet,
  listActiveFormTemplates,
  listChildOrganizations,
  migratePeriodLifecycle,
  normalizePeriodStatus,
  replacePeriodFormSet,
  resolveActiveMethodologyId,
  snapshotPeriodFormSet,
  snapshotPeriodFormSetWithForms,
  type PeriodLifecycleStatus,
} from "./periodLifecycle.js";
import { saveRashEntries } from "./rash-data.js";
import { withTiming } from "./perf.js";
import type { OkoFormInstance } from "./types.js";

export interface OrganizationDto {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
  unitKind?: string | null;
  headZid?: number | null;
  branchCode?: string | null;
  unitCode?: string | null;
  compositeCode?: string | null;
  guid?: string | null;
}

export interface PeriodDto {
  eid: number;
  zid: number;
  packageId?: string | null;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  quarter: number | null;
  year: number | null;
  packageStatus?: PackageWorkflowStatus;
  packageComment?: string | null;
  periodStatus?: PeriodLifecycleStatus;
  closedAt?: string | null;
  closedBy?: string | null;
  methodologyReleaseId?: string | null;
  formSetCount?: number;
  packageKind?: "OKO" | "BALANCE";
  collectionUnitZid?: number | null;
}

export interface PackageContext {
  packageId: string;
  zid: number;
  eid: number;
  packageKind: "OKO" | "BALANCE";
  collectionUnitZid: number;
}

export interface WorkContextDto {
  zid: number | null;
  eid: number | null;
}

export type PackageWorkflowStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "corrected"
  | "accepted";

export interface PackageWorkflowDto {
  status: PackageWorkflowStatus;
  comment: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const WORKFLOW_TRANSITIONS: Record<PackageWorkflowStatus, PackageWorkflowStatus[]> = {
  draft: ["submitted"],
  submitted: ["returned", "accepted"],
  returned: ["corrected", "draft"],
  corrected: ["submitted"],
  accepted: ["returned"],
};

const ORG_TRANSITIONS = new Set<string>([
  "draft:submitted",
  "returned:corrected",
  "corrected:submitted",
]);

export function normalizePackageWorkflowStatus(
  raw: string | null | undefined
): PackageWorkflowStatus {
  if (
    raw === "submitted" ||
    raw === "returned" ||
    raw === "corrected" ||
    raw === "accepted"
  ) {
    return raw;
  }
  return "draft";
}

export function canTransitionPackageStatus(
  from: PackageWorkflowStatus,
  to: PackageWorkflowStatus,
  isAdmin: boolean
): boolean {
  if (!WORKFLOW_TRANSITIONS[from]?.includes(to)) return false;
  if (isAdmin) return true;
  return ORG_TRANSITIONS.has(`${from}:${to}`);
}

export interface PackageCompletenessItem {
  formId: string;
  title: string;
  category: string;
  filled: boolean;
  instanceId?: string;
  displayName?: string;
  status?: "draft" | "submitted";
}

export interface PackageCompletenessDto {
  zid: number;
  eid: number;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  items: PackageCompletenessItem[];
  workflow?: PackageWorkflowDto;
}

export interface PackageDashboardRow {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
  packageStatus: PackageWorkflowStatus;
  packageComment: string | null;
}

/** Aggregated package list row for the Package workspace UI. */
export interface PackageWorkspaceRow {
  zid: number;
  eid: number;
  /** Stable package GUID — exchange marks and identity key. */
  packageId: string;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodStatus: PeriodLifecycleStatus;
  packageKind: "OKO" | "BALANCE";
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
  bpId: string | null;
  bpStatus: import("./businessProcessTypes.js").BpStatus | null;
  curatorUserId: number | null;
  curatorName: string | null;
  bpLastChangedAt: string | null;
  bpIteration: number | null;
  hasBlockers: boolean;
  methodologyReleaseId: string | null;
  lastExportedAt: string | null;
  lastImportedAt: string | null;
  importVersion: number;
}

export interface PackageWorkspaceDetail {
  row: PackageWorkspaceRow;
  completeness: PackageCompletenessDto;
  bp: import("./businessProcessTypes.js").BusinessProcessDto | null;
  blockers: {
    blocked: boolean;
    missingExplanations: Array<{
      ruleNumber: number;
      formId: string | null;
      message: string | null;
    }>;
  } | null;
  childOrgCount: number;
}

export interface PackageConstructInput {
  mode: "single" | "bulk";
  targets: Array<{ zid: number }>;
  period: {
    /** Prefer existing period by eid when set (period-first flow). */
    eid?: number;
    name?: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
    packageKind?: "OKO" | "BALANCE";
    reuseExisting?: boolean;
    methodologyReleaseId?: string | null;
    collectionUnitZid?: number | null;
  };
  forms: {
    mode: "all" | "selected";
    formIds?: string[];
  };
  options?: {
    createInstances?: boolean;
    continueOnError?: boolean;
    /** When false (default), construct refuses to create a missing period. */
    allowCreatePeriod?: boolean;
  };
}

export interface PackageConstructRowResult {
  zid: number;
  organizationName: string;
  eid?: number;
  periodName: string;
  status: "ready" | "created" | "skipped" | "error";
  periodCreated: boolean;
  formsTotal: number;
  formsCreated: number;
  formsSkipped: number;
  warnings: string[];
  error?: string;
}

export interface PackageConstructResult {
  summary: {
    targets: number;
    periodsCreated: number;
    formsCreated: number;
    skipped: number;
    errors: number;
  };
  rows: PackageConstructRowResult[];
}

export interface CreatePackageResult {
  created: number;
  skipped: number;
  total: number;
  instanceIds: string[];
}

export interface ImportPackageResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ReportPackageInput {
  organization?: string;
  periodStart?: string;
  periodEnd?: string;
  zid?: number | null;
  eid?: number | null;
  packageId?: string | null;
  instances: OkoFormInstance[];
}

export async function migrateOrgTables(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_instances_zid_eid ON form_instances(zid, eid);
    CREATE INDEX IF NOT EXISTS idx_instances_package ON form_instances(zid, eid, template_id);
    CREATE INDEX IF NOT EXISTS idx_periods_zid ON periods(zid);
  `);
  const workflowCols: Array<[string, string]> = [
    ["package_status", "TEXT DEFAULT 'draft'"],
    ["package_comment", "TEXT"],
    ["status_updated_at", "TEXT"],
    ["status_updated_by", "TEXT"],
  ];
  for (const [name, ddl] of workflowCols) {
    if (!(await db.columnExists("periods", name))) {
      await db.exec(`ALTER TABLE periods ADD COLUMN ${name} ${ddl}`);
    }
  }
  await migratePeriodLifecycle(db);
}

export async function seedOrganizationsFromSettings(db: OkoDb): Promise<number> {
  const count = (
    (await db.prepare("SELECT COUNT(*) AS c FROM organizations").get()) as { c: number }
  ).c;
  if (count > 0) return 0;

  let orgName = "Организация по умолчанию";
  let periodStart = "";
  let periodEnd = "";

  const settings = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
    key: string;
    value: string;
  }>;
  for (const s of settings) {
    if (s.key !== "globalMeta") continue;
    try {
      const meta = JSON.parse(s.value) as {
        organization?: string;
        periodStart?: string;
        periodEnd?: string;
      };
      if (meta.organization?.trim()) orgName = meta.organization.trim();
      periodStart = meta.periodStart ?? "";
      periodEnd = meta.periodEnd ?? "";
    } catch {
      /* ignore */
    }
  }

  await db.prepare("INSERT INTO organizations (zid, name, code) VALUES (1, ?, ?)").run(
    orgName,
    null
  );

  const periodName =
    periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : "Текущий период";
  await db
    .prepare(
      `INSERT INTO periods (eid, zid, name, period_start, period_end)
     VALUES (1, 1, ?, ?, ?)`
    )
    .run(periodName, dateOrNull(periodStart), dateOrNull(periodEnd));

  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await upsert.run("workZid", "1");
  await upsert.run("workEid", "1");

  return 1;
}

/**
 * Если организации уже насеяны (например, из agg-list.json), а периодов нет,
 * form_instances.eid из старого рабочего контекста нарушает FK на periods.
 * Создаём период по умолчанию, чтобы платформа работала «из коробки».
 */
export async function seedDefaultPeriodIfMissing(db: OkoDb): Promise<number> {
  const periods = (
    (await db.prepare("SELECT COUNT(*) AS c FROM periods").get()) as { c: number }
  ).c;
  if (periods > 0) return 0;

  let zid: number | null = null;
  const workZidRow = (await db
    .prepare("SELECT value FROM app_settings WHERE key = 'workZid'")
    .get()) as { value: string } | undefined;
  if (workZidRow) {
    const candidate = Number(workZidRow.value) || null;
    if (candidate != null) {
      const org = await db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(candidate);
      if (org) zid = candidate;
    }
  }
  if (zid == null) {
    const row = (await db.prepare("SELECT MIN(zid) AS z FROM organizations").get()) as
      | { z: number | null }
      | undefined;
    zid = row?.z ?? null;
  }
  if (zid == null) return 0;

  await db
    .prepare("INSERT INTO periods (eid, zid, name) VALUES (1, ?, 'Текущий период')")
    .run(zid);
  return 1;
}

function rowToOrg(row: {
  zid: number;
  name: string;
  code: string | null;
  parent_zid: number | null;
  unit_kind?: string | null;
  head_zid?: number | null;
  branch_code?: string | null;
  unit_code?: string | null;
  composite_code?: string | null;
  guid?: string | null;
}): OrganizationDto {
  return {
    zid: row.zid,
    name: row.name,
    code: row.code,
    parentZid: row.parent_zid,
    unitKind: row.unit_kind ?? "organization",
    headZid: row.head_zid == null ? row.zid : Number(row.head_zid),
    branchCode: row.branch_code ?? null,
    unitCode: row.unit_code ?? null,
    compositeCode: row.composite_code ?? null,
    guid: row.guid ?? null,
  };
}

function rowToPeriod(row: {
  eid: number;
  zid: number;
  package_id?: string | null;
  name: string;
  period_start: string | null;
  period_end: string | null;
  quarter: number | null;
  year: number | null;
  package_status?: string | null;
  package_comment?: string | null;
  period_status?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  methodology_release_id?: string | null;
  form_set_count?: number | null;
  package_kind?: string | null;
  collection_unit_zid?: number | null;
}): PeriodDto {
  return {
    eid: row.eid,
    zid: row.zid,
    packageId: row.package_id ?? packageIdFor(row.zid, row.eid, row.package_kind),
    name: row.name,
    periodStart: dateOrNull(row.period_start),
    periodEnd: dateOrNull(row.period_end),
    quarter: row.quarter,
    year: row.year,
    packageStatus: normalizePackageWorkflowStatus(row.package_status),
    packageComment: row.package_comment ?? null,
    periodStatus: normalizePeriodStatus(row.period_status),
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    methodologyReleaseId: row.methodology_release_id ?? null,
    formSetCount: row.form_set_count != null ? Number(row.form_set_count) : undefined,
    packageKind: row.package_kind === "BALANCE" ? "BALANCE" : "OKO",
    collectionUnitZid:
      row.collection_unit_zid == null ? row.zid : Number(row.collection_unit_zid),
  };
}

export function packageIdFor(
  zid: number,
  eid: number,
  packageKind: string | null | undefined
): string {
  return `pkg-${zid}-${eid}-${packageKind === "BALANCE" ? "BALANCE" : "OKO"}`;
}

/** New unique package GUID — never reuse zid/eid so exchange history cannot stick to recreations. */
export function newPackageGuid(): string {
  return randomUUID();
}

/** Resolve one package's complete context from its reporting-period record. */
export async function resolvePackageContext(
  db: OkoDb,
  input: { zid: number; eid: number; packageKind?: "OKO" | "BALANCE" }
): Promise<PackageContext | null> {
  const row = (await db
    .prepare(
      `SELECT zid, eid, package_kind, collection_unit_zid, package_id
       FROM periods WHERE zid = ? AND eid = ?`
    )
    .get(input.zid, input.eid)) as
    | {
        zid: number;
        eid: number;
        package_kind: string | null;
        collection_unit_zid: number | null;
        package_id: string | null;
      }
    | undefined;
  if (!row) return null;
  const packageKind = row.package_kind === "BALANCE" ? "BALANCE" : "OKO";
  if (input.packageKind && input.packageKind !== packageKind) return null;
  return {
    zid: Number(row.zid),
    eid: Number(row.eid),
    packageKind,
    collectionUnitZid:
      row.collection_unit_zid == null ? Number(row.zid) : Number(row.collection_unit_zid),
    packageId: row.package_id ?? packageIdFor(row.zid, row.eid, packageKind),
  };
}

async function loadPackageWorkflow(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<PackageWorkflowDto> {
  const row = (await db
    .prepare(
      `SELECT package_status, package_comment, status_updated_at, status_updated_by
       FROM periods WHERE zid = ? AND eid = ?`
    )
    .get(zid, eid)) as {
    package_status: string | null;
    package_comment: string | null;
    status_updated_at: string | null;
    status_updated_by: string | null;
  } | undefined;
  if (!row) {
    throw new Error("Период не найден");
  }
  return {
    status: normalizePackageWorkflowStatus(row.package_status),
    comment: row.package_comment ?? null,
    updatedAt: row.status_updated_at ?? null,
    updatedBy: row.status_updated_by ?? null,
  };
}

export async function setPackageWorkflow(
  db: OkoDb,
  zid: number,
  eid: number,
  input: {
    status: PackageWorkflowStatus;
    comment?: string | null;
    actor?: string | null;
    isAdmin?: boolean;
    force?: boolean;
  }
): Promise<PackageWorkflowDto> {
  const err = new Error(
    "Package status is derived from the business process; use a business-process transition"
  );
  (err as Error & { status: number }).status = 409;
  throw err;

  /* Legacy implementation retained below for migration history only. */
  await assertPeriodWritable(db, eid, zid, { force: input.force === true });
  const current = await loadPackageWorkflow(db, zid, eid);
  if (
    !canTransitionPackageStatus(current.status, input.status, input.isAdmin === true)
  ) {
    const err = new Error(
      `Недопустимый переход статуса: ${current.status} → ${input.status}`
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  if (
    (input.status === "submitted" || input.status === "accepted") &&
    input.force !== true
  ) {
    const completeness = await getPackageCompleteness(db, zid, eid);
    const formSet = await ensurePeriodFormSet(db, eid);
    const required = formSet.length > 0 ? formSet.length : completeness.total;
    if (completeness.filled < required) {
      const err = new Error(
        `Комплект неполон: заведено ${completeness.filled} из ${required} форм. Нажмите «Завести пустые формы» или дозаполните комплект.`
      );
      (err as Error & { status: number }).status = 400;
      throw err;
    }
    // Package «на проверку» — достаточно заведённых форм.
    // «Принять» — все формы должны быть сданы по отдельности.
    if (input.status === "accepted" && completeness.submitted < required) {
      const err = new Error(
        `Нельзя принять: сдано форм ${completeness.submitted} из ${required} (черновиков: ${completeness.draft}). Сдайте каждую форму в «Мои формы», затем примите комплект.`
      );
      (err as Error & { status: number }).status = 400;
      throw err;
    }
  }

  const now = new Date().toISOString();
  const comment =
    input.comment !== undefined ? input.comment : current.comment;
  await db
    .prepare(
      `UPDATE periods
       SET package_status = ?, package_comment = ?, status_updated_at = ?, status_updated_by = ?
       WHERE zid = ? AND eid = ?`
    )
    .run(input.status, comment, now, input.actor ?? null, zid, eid);
  return {
    status: input.status,
    comment: comment ?? null,
    updatedAt: now,
    updatedBy: input.actor ?? null,
  };
}

export type ListOrganizationsOpts = {
  /** Case-insensitive search on name / code / zid. */
  q?: string;
  /** Max rows (default: all). Cap at 5000. */
  limit?: number;
  offset?: number;
  /** Restrict to a single zid (org-scoped users). */
  zid?: number;
};

export async function listOrganizations(
  db: OkoDb,
  opts?: ListOrganizationsOpts
): Promise<OrganizationDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts?.zid != null && Number.isFinite(opts.zid)) {
    conditions.push("zid = ?");
    params.push(opts.zid);
  }
  const q = opts?.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const asZid = Number(q);
    if (Number.isFinite(asZid) && asZid > 0 && String(Math.trunc(asZid)) === q) {
      conditions.push("(zid = ? OR name ILIKE ? OR COALESCE(code, '') ILIKE ?)");
      params.push(Math.trunc(asZid), like, like);
    } else {
      conditions.push("(name ILIKE ? OR COALESCE(code, '') ILIKE ?)");
      params.push(like, like);
    }
  }
  let sql = `SELECT zid, name, code, parent_zid, unit_kind, head_zid, branch_code, unit_code, composite_code, guid
       FROM organizations`;
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += ` ORDER BY name`;
  const limit = opts?.limit != null ? Math.min(5000, Math.max(1, Math.trunc(opts.limit))) : null;
  const offset =
    opts?.offset != null && opts.offset > 0 ? Math.trunc(opts.offset) : 0;
  if (limit != null) {
    sql += ` LIMIT ?`;
    params.push(limit);
    if (offset > 0) {
      sql += ` OFFSET ?`;
      params.push(offset);
    }
  }
  const rows = (await db.prepare(sql).all(...params)) as Array<{
    zid: number;
    name: string;
    code: string | null;
    parent_zid: number | null;
    unit_kind: string | null;
    head_zid: number | null;
    branch_code: string | null;
    unit_code: string | null;
    composite_code: string | null;
    guid: string | null;
  }>;
  return rows.map(rowToOrg);
}

export async function countOrganizations(
  db: OkoDb,
  opts?: Omit<ListOrganizationsOpts, "limit" | "offset">
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts?.zid != null && Number.isFinite(opts.zid)) {
    conditions.push("zid = ?");
    params.push(opts.zid);
  }
  const q = opts?.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    conditions.push("(name ILIKE ? OR COALESCE(code, '') ILIKE ?)");
    params.push(like, like);
  }
  let sql = `SELECT COUNT(*)::int AS c FROM organizations`;
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  const row = (await db.prepare(sql).get(...params)) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

/** Lightweight campaign (period × kind) aggregates for the workspace sidebar. */
export interface PackageCampaignSummary {
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

export async function listPackageCampaigns(
  db: OkoDb,
  opts?: { zid?: number; packageKind?: "OKO" | "BALANCE"; q?: string }
): Promise<PackageCampaignSummary[]> {
  return withTiming(
    "packages.campaigns",
    async () => {
      const { normalizePackageKind } = await import("./businessProcessTypes.js");
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (opts?.zid != null) {
        conditions.push("p.zid = ?");
        params.push(opts.zid);
      }
      if (opts?.packageKind) {
        conditions.push("COALESCE(p.package_kind, 'OKO') = ?");
        params.push(opts.packageKind);
      }
      const q = opts?.q?.trim();
      if (q) {
        conditions.push("p.name ILIKE ?");
        params.push(`%${q.replace(/[%_]/g, "\\$&")}%`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = (await db
        .prepare(
          `SELECT
             p.name AS period_name,
             COALESCE(p.package_kind, 'OKO') AS package_kind,
             MIN(p.period_start) AS period_start,
             MAX(p.period_end) AS period_end,
             COUNT(*)::int AS org_count,
             COUNT(*) FILTER (
               WHERE COALESCE(p.period_status, 'open') = 'closed'
             )::int AS closed_count,
             COUNT(*) FILTER (
               WHERE COALESCE(p.period_status, 'open') <> 'closed'
             )::int AS open_count,
             COUNT(*) FILTER (
               WHERE NOT EXISTS (
                 SELECT 1 FROM form_instances fi
                 WHERE fi.zid = p.zid AND fi.eid = p.eid
               )
             )::int AS without_forms,
             COUNT(*) FILTER (
               WHERE COALESCE(p.period_status, 'open') <> 'closed'
                 AND bp.status = 'completed'
             )::int AS closable_count,
             COUNT(*) FILTER (
               WHERE COALESCE(p.period_status, 'open') <> 'closed'
                 AND (bp.status IS NULL OR bp.status <> 'completed')
             )::int AS blocked_close_count
           FROM periods p
           LEFT JOIN business_processes bp
             ON bp.zid = p.zid AND bp.eid = p.eid
            AND COALESCE(bp.package_kind, 'OKO') = COALESCE(p.package_kind, 'OKO')
           ${where}
           GROUP BY p.name, COALESCE(p.package_kind, 'OKO')
           ORDER BY MIN(p.period_start) DESC NULLS LAST, p.name DESC`
        )
        .all(...params)) as Array<{
        period_name: string;
        package_kind: string;
        period_start: string | null;
        period_end: string | null;
        org_count: number;
        closed_count: number;
        open_count: number;
        without_forms: number;
        closable_count: number;
        blocked_close_count: number;
      }>;

      return rows.map((r) => {
        const packageKind = normalizePackageKind(r.package_kind);
        const openCount = Number(r.open_count ?? 0);
        const closedCount = Number(r.closed_count ?? 0);
        let status: "open" | "closed" | "mixed" = "open";
        if (openCount > 0 && closedCount > 0) status = "mixed";
        else if (closedCount > 0 && openCount === 0) status = "closed";
        return {
          key: `${r.period_name}||${packageKind}`,
          periodName: r.period_name,
          packageKind,
          periodStart: dateOrNull(r.period_start),
          periodEnd: dateOrNull(r.period_end),
          orgCount: Number(r.org_count ?? 0),
          withoutForms: Number(r.without_forms ?? 0),
          openCount,
          closedCount,
          status,
          closableCount: Number(r.closable_count ?? 0),
          blockedCloseCount: Number(r.blocked_close_count ?? 0),
        };
      });
    },
    () => ({ zid: opts?.zid ?? null })
  );
}

export async function createOrganization(
  db: OkoDb,
  input: { name: string; code?: string; parentZid?: number }
): Promise<OrganizationDto> {
  const max = (await db.prepare("SELECT COALESCE(MAX(zid), 0) AS m FROM organizations").get()) as {
    m: number;
  };
  const zid = max.m + 1;
  const code = input.code?.trim() || null;
  const composite = `${zid}@${code || zid}`;
  await db
    .prepare(
      `INSERT INTO organizations (
         zid, name, code, parent_zid, unit_kind, head_zid, composite_code
       ) VALUES (?, ?, ?, ?, 'organization', ?, ?)`
    )
    .run(zid, input.name.trim(), code, input.parentZid ?? null, zid, composite);
  return {
    zid,
    name: input.name.trim(),
    code,
    parentZid: input.parentZid ?? null,
  };
}

export async function updateOrganization(
  db: OkoDb,
  zid: number,
  input: { name: string; code?: string | null; parentZid?: number | null }
): Promise<OrganizationDto> {
  const existing = await db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(zid);
  if (!existing) throw new Error(`Организация ZID=${zid} не найдена`);
  const name = input.name.trim();
  if (!name) throw new Error("Укажите наименование");
  const code =
    input.code === undefined
      ? (
          (await db
            .prepare("SELECT code FROM organizations WHERE zid = ?")
            .get(zid)) as { code: string | null }
        ).code
      : input.code?.trim() || null;
  const parentZid =
    input.parentZid === undefined
      ? (
          (await db
            .prepare("SELECT parent_zid FROM organizations WHERE zid = ?")
            .get(zid)) as { parent_zid: number | null }
        ).parent_zid
      : input.parentZid;
  if (parentZid != null && parentZid === zid) {
    throw new Error("Организация не может быть головной для самой себя");
  }
  if (parentZid != null) {
    const parent = await db
      .prepare("SELECT 1 FROM organizations WHERE zid = ?")
      .get(parentZid);
    if (!parent) throw new Error(`Головная организация ZID=${parentZid} не найдена`);
  }
  const composite = `${zid}@${code || zid}`;
  await db
    .prepare(
      `UPDATE organizations
       SET name = ?, code = ?, parent_zid = ?, composite_code = ?
       WHERE zid = ?`
    )
    .run(name, code, parentZid, composite, zid);
  return {
    zid,
    name,
    code,
    parentZid: parentZid ?? null,
  };
}

export async function listPeriods(db: OkoDb, zid?: number): Promise<PeriodDto[]> {
  const select = `SELECT p.eid, p.zid, p.package_id, p.name, p.period_start, p.period_end, p.quarter, p.year,
              p.package_status, p.package_comment,
              p.period_status, p.closed_at, p.closed_by, p.methodology_release_id,
              p.package_kind, p.collection_unit_zid,
              (SELECT COUNT(*) FROM period_form_set pfs WHERE pfs.eid = p.eid) AS form_set_count
       FROM periods p`;
  if (zid) {
    const rows = (await db
      .prepare(`${select} WHERE p.zid = ? ORDER BY p.period_start DESC, p.eid DESC`)
      .all(zid)) as Array<{
      eid: number;
      zid: number;
      package_id: string | null;
      name: string;
      period_start: string | null;
      period_end: string | null;
      quarter: number | null;
      year: number | null;
      package_status: string | null;
      package_comment: string | null;
      period_status: string | null;
      closed_at: string | null;
      closed_by: string | null;
      methodology_release_id: string | null;
      form_set_count: number | null;
    }>;
    return rows.map(rowToPeriod);
  }
  const rows = (await db
    .prepare(`${select} ORDER BY p.zid, p.period_start DESC, p.eid DESC`)
    .all()) as Array<{
    eid: number;
    zid: number;
    package_id: string | null;
    name: string;
    period_start: string | null;
    period_end: string | null;
    quarter: number | null;
    year: number | null;
    package_status: string | null;
    package_comment: string | null;
    period_status: string | null;
    closed_at: string | null;
    closed_by: string | null;
    methodology_release_id: string | null;
    form_set_count: number | null;
  }>;
  return rows.map(rowToPeriod);
}

export async function createPeriod(
  db: OkoDb,
  input: {
    zid: number;
    name: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
    methodologyReleaseId?: string | null;
    packageKind?: "OKO" | "BALANCE";
    collectionUnitZid?: number | null;
    /** Pre-resolved methodology id (skip lookup). */
    resolvedMethodologyId?: string | null;
    /** Preloaded catalog for period_form_set (skip catalog SELECT). */
    formTemplates?: Array<{ form_id: string; schema_version: number }>;
    /** When true, skip org existence check (caller already validated). */
    skipOrgCheck?: boolean;
  }
): Promise<PeriodDto> {
  if (!input.skipOrgCheck) {
    const org = await db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(input.zid);
    if (!org) throw new Error("Organization not found");
  }

  const max = (await db.prepare("SELECT COALESCE(MAX(eid), 0) AS m FROM periods").get()) as {
    m: number;
  };
  const eid = max.m + 1;
  const methodologyId =
    input.resolvedMethodologyId !== undefined
      ? input.resolvedMethodologyId
      : input.methodologyReleaseId !== undefined
        ? input.methodologyReleaseId
        : await resolveActiveMethodologyId(db);
  const packageKind = input.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const collectionUnitZid = input.collectionUnitZid ?? input.zid;
  if (!input.skipOrgCheck || collectionUnitZid !== input.zid) {
    const collectionUnit = await db
      .prepare("SELECT 1 FROM organizations WHERE zid = ?")
      .get(collectionUnitZid);
    if (!collectionUnit) throw new Error("Collection unit not found");
  }
  const packageId = newPackageGuid();

  await db
    .prepare(
      `INSERT INTO periods (
         eid, zid, name, period_start, period_end, quarter, year,
         period_status, methodology_release_id, package_kind, collection_unit_zid, package_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(
      eid,
      input.zid,
      input.name.trim(),
      dateOrNull(input.periodStart),
      dateOrNull(input.periodEnd),
      input.quarter ?? null,
      input.year ?? null,
      methodologyId,
      packageKind,
      collectionUnitZid,
      packageId
    );

  const formSetCount = input.formTemplates
    ? await snapshotPeriodFormSetWithForms(db, eid, input.formTemplates)
    : await snapshotPeriodFormSet(db, eid);

  // Ensure PSD business process row exists for this package.
  try {
    const { ensureBusinessProcess } = await import("./businessProcess.js");
    await ensureBusinessProcess(db, input.zid, eid, packageKind);
  } catch {
    /* table may not exist until migration; ignore */
  }

  return {
    eid,
    zid: input.zid,
    packageId,
    name: input.name.trim(),
    periodStart: dateOrNull(input.periodStart),
    periodEnd: dateOrNull(input.periodEnd),
    quarter: input.quarter ?? null,
    year: input.year ?? null,
    packageStatus: "draft",
    periodStatus: "open",
    methodologyReleaseId: methodologyId,
    formSetCount,
    packageKind,
    collectionUnitZid,
  };
}

/** Open the same reporting period for many organizations (one periods row per zid). */
export async function createPeriodsForOrganizations(
  db: OkoDb,
  input: {
    /** If omitted — all organizations. */
    zids?: number[];
    name?: string;
    periodStart?: string;
    periodEnd?: string;
    quarter: number;
    year: number;
    packageKind?: "OKO" | "BALANCE";
    methodologyReleaseId?: string | null;
    /** Reuse existing open/closed period with same Q/Y/kind (default true). */
    reuseExisting?: boolean;
  }
): Promise<{
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
}> {
  return withTiming(
    "packages.createPeriodsBulk",
    async () => {
      const quarter = Math.trunc(Number(input.quarter));
      const year = Math.trunc(Number(input.year));
      if (!(quarter >= 1 && quarter <= 4) || !(year >= 2000 && year <= 2100)) {
        const err = new Error("Укажите квартал и год отчётного периода");
        (err as Error & { status: number }).status = 400;
        throw err;
      }
      const packageKind = input.packageKind === "BALANCE" ? "BALANCE" : "OKO";
      const name = String(input.name ?? "").trim() || quarterPeriodName(quarter, year);
      const range = quarterDateRange(quarter, year);
      const periodStart = input.periodStart ?? range.periodStart;
      const periodEnd = input.periodEnd ?? range.periodEnd;
      const reuseExisting = input.reuseExisting !== false;

      let orgs: Array<{ zid: number; name: string }>;
      if (input.zids?.length) {
        const unique = [...new Set(input.zids.map((z) => Number(z)).filter((z) => z > 0))];
        if (unique.length === 0) {
          orgs = [];
        } else {
          const placeholders = unique.map(() => "?").join(",");
          orgs = (await db
            .prepare(
              `SELECT zid, name FROM organizations WHERE zid IN (${placeholders}) ORDER BY name`
            )
            .all(...unique)) as Array<{ zid: number; name: string }>;
        }
      } else {
        orgs = (await db
          .prepare("SELECT zid, name FROM organizations ORDER BY name")
          .all()) as Array<{ zid: number; name: string }>;
      }

      if (!orgs.length) {
        const err = new Error("Нет организаций для открытия периода");
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      const methodologyId =
        input.methodologyReleaseId !== undefined
          ? input.methodologyReleaseId
          : await resolveActiveMethodologyId(db);
      const formTemplates = await listActiveFormTemplates(db);

      const existingByZid = new Map<
        number,
        { eid: number; name: string; period_status: string | null }
      >();
      {
        const zids = orgs.map((o) => o.zid);
        const ZID_CHUNK = 500;
        for (let offset = 0; offset < zids.length; offset += ZID_CHUNK) {
          const chunk = zids.slice(offset, offset + ZID_CHUNK);
          const placeholders = chunk.map(() => "?").join(",");
          const existingRows = (await db
            .prepare(
              `SELECT DISTINCT ON (zid) zid, eid, name, period_status
               FROM periods
               WHERE zid IN (${placeholders})
                 AND quarter = ?
                 AND year = ?
                 AND COALESCE(package_kind, 'OKO') = ?
               ORDER BY zid, eid DESC`
            )
            .all(...chunk, quarter, year, packageKind)) as Array<{
            zid: number;
            eid: number;
            name: string;
            period_status: string | null;
          }>;
          for (const row of existingRows) {
            existingByZid.set(row.zid, {
              eid: row.eid,
              name: row.name,
              period_status: row.period_status,
            });
          }
        }
      }

      const rows: Array<{
        zid: number;
        organizationName: string;
        eid?: number;
        periodName: string;
        status: "created" | "reused" | "error";
        error?: string;
      }> = [];

      for (const org of orgs) {
        try {
          const existing = existingByZid.get(org.zid);
          if (existing) {
            if (!reuseExisting) {
              rows.push({
                zid: org.zid,
                organizationName: org.name,
                eid: existing.eid,
                periodName: existing.name,
                status: "error",
                error: "Период с таким кварталом уже есть",
              });
              continue;
            }
            rows.push({
              zid: org.zid,
              organizationName: org.name,
              eid: existing.eid,
              periodName: existing.name,
              status: "reused",
            });
            continue;
          }

          const created = await createPeriod(db, {
            zid: org.zid,
            name,
            periodStart,
            periodEnd,
            quarter,
            year,
            packageKind,
            resolvedMethodologyId: methodologyId,
            formTemplates,
            skipOrgCheck: true,
          });
          rows.push({
            zid: org.zid,
            organizationName: org.name,
            eid: created.eid,
            periodName: created.name,
            status: "created",
          });
        } catch (e) {
          rows.push({
            zid: org.zid,
            organizationName: org.name,
            periodName: name,
            status: "error",
            error: e instanceof Error ? e.message : "Ошибка создания периода",
          });
        }
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
    },
    () => ({
      quarter: input.quarter,
      year: input.year,
      zids: input.zids?.length ?? null,
    })
  );
}

export async function getWorkContext(
  db: OkoDb,
  userId?: number | null
): Promise<WorkContextDto> {
  const rows = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
    key: string;
    value: string;
  }>;
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const readPair = (zidKey: string, eidKey: string): WorkContextDto => {
    const zRaw = byKey.get(zidKey);
    const eRaw = byKey.get(eidKey);
    return {
      zid: zRaw ? Number(zRaw) || null : null,
      eid: eRaw ? Number(eRaw) || null : null,
    };
  };
  // Устаревший eid (период удалён/не создан или принадлежит другой организации)
  // приводит к FK-ошибке form_instances_eid_fkey и «Период не найден» — отбрасываем его.
  const sanitize = async (ctx: WorkContextDto): Promise<WorkContextDto> => {
    if (ctx.eid == null) return ctx;
    const exists =
      ctx.zid != null
        ? await db
            .prepare("SELECT 1 FROM periods WHERE eid = ? AND zid = ?")
            .get(ctx.eid, ctx.zid)
        : await db.prepare("SELECT 1 FROM periods WHERE eid = ?").get(ctx.eid);
    return exists ? ctx : { ...ctx, eid: null };
  };
  if (userId != null) {
    const scoped = readPair(`workZid:u${userId}`, `workEid:u${userId}`);
    if (scoped.zid != null || scoped.eid != null) return sanitize(scoped);
  }
  return sanitize(readPair("workZid", "workEid"));
}

export async function setWorkContext(
  db: OkoDb,
  ctx: WorkContextDto,
  userId?: number | null
): Promise<WorkContextDto> {
  if (ctx.eid != null) {
    const exists =
      ctx.zid != null
        ? await db
            .prepare("SELECT 1 FROM periods WHERE eid = ? AND zid = ?")
            .get(ctx.eid, ctx.zid)
        : await db.prepare("SELECT 1 FROM periods WHERE eid = ?").get(ctx.eid);
    if (!exists) {
      const err = new Error(`Период eid=${ctx.eid} не найден`);
      (err as Error & { status: number }).status = 400;
      throw err;
    }
  }
  const zidKey = userId != null ? `workZid:u${userId}` : "workZid";
  const eidKey = userId != null ? `workEid:u${userId}` : "workEid";
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  if (ctx.zid != null) await upsert.run(zidKey, String(ctx.zid));
  else await db.prepare("DELETE FROM app_settings WHERE key = ?").run(zidKey);
  if (ctx.eid != null) await upsert.run(eidKey, String(ctx.eid));
  else await db.prepare("DELETE FROM app_settings WHERE key = ?").run(eidKey);
  return getWorkContext(db, userId);
}

function buildInitialRows(schema: FormSchemaDto): Record<string, string | number>[] {
  return buildInitialRowsFromSchema(schema);
}

function defaultDisplayName(
  templateId: string,
  templateTitle: string,
  organization: string
): string {
  if (organization.trim()) {
    return `${templateId} — ${organization.trim().slice(0, 40)}`;
  }
  const shortTitle =
    templateTitle.length > 45 ? templateTitle.slice(0, 45) + "…" : templateTitle;
  return `${templateId} — ${shortTitle}`;
}

async function existingTemplatesForPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<Set<string>> {
  const rows = (await db
    .prepare(`SELECT template_id FROM form_instances WHERE zid = ? AND eid = ?`)
    .all(zid, eid)) as Array<{ template_id: string }>;
  return new Set(rows.map((r) => r.template_id));
}

export async function getPackageCompleteness(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<PackageCompletenessDto> {
  const catalog = await exportCatalog(db);
  const formSet = await ensurePeriodFormSet(db, eid);
  const catalogById = new Map(catalog.forms.map((f) => [f.id, f]));
  const forms =
    formSet.length > 0
      ? formSet.map((f) => {
          const cat = catalogById.get(f.formId);
          return {
            id: f.formId,
            title: cat?.title ?? f.formId,
            category: cat?.category ?? "",
          };
        })
      : catalog.forms.map((f) => ({ id: f.id, title: f.title, category: f.category }));

  const instances = (await db
    .prepare(
      `SELECT instance_id, template_id, display_name, status, updated_at
       FROM form_instances WHERE zid = ? AND eid = ?
       ORDER BY updated_at DESC`
    )
    .all(zid, eid)) as Array<{
    instance_id: string;
    template_id: string;
    display_name: string;
    status: string | null;
    updated_at: string;
  }>;

  const latestByTemplate = new Map<
    string,
    { instanceId: string; displayName: string; status: "draft" | "submitted" }
  >();
  for (const inst of instances) {
    if (!latestByTemplate.has(inst.template_id)) {
      latestByTemplate.set(inst.template_id, {
        instanceId: inst.instance_id,
        displayName: inst.display_name,
        status: inst.status === "submitted" ? "submitted" : "draft",
      });
    }
  }

  let draft = 0;
  let submitted = 0;
  const items: PackageCompletenessItem[] = forms.map((f) => {
    const hit = latestByTemplate.get(f.id);
    if (hit?.status === "submitted") submitted++;
    else if (hit) draft++;
    return {
      formId: f.id,
      title: f.title,
      category: f.category,
      filled: !!hit,
      instanceId: hit?.instanceId,
      displayName: hit?.displayName,
      status: hit?.status,
    };
  });

  const filled = items.filter((i) => i.filled).length;
  const workflow = await loadPackageWorkflow(db, zid, eid);
  return { zid, eid, total: items.length, filled, draft, submitted, items, workflow };
}

export async function getPackagesDashboard(db: OkoDb): Promise<PackageDashboardRow[]> {
  // One aggregated workspace pass + status from periods (no N+1 completeness).
  const workspace = await getPackageWorkspace(db);
  const statusRows = (await db
    .prepare(`SELECT zid, eid, package_status, package_comment FROM periods`)
    .all()) as Array<{
    zid: number;
    eid: number;
    package_status: string | null;
    package_comment: string | null;
  }>;
  const statusByKey = new Map(
    statusRows.map((r) => [`${r.zid}:${r.eid}`, r] as const)
  );
  return workspace.map((r) => {
    const st = statusByKey.get(`${r.zid}:${r.eid}`);
    return {
      zid: r.zid,
      eid: r.eid,
      organizationName: r.organizationName,
      organizationCode: r.organizationCode,
      periodName: r.periodName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      total: r.total,
      filled: r.filled,
      draft: r.draft,
      submitted: r.submitted,
      percent: r.percent,
      packageStatus: normalizePackageWorkflowStatus(st?.package_status),
      packageComment: st?.package_comment ?? null,
    };
  });
}

function packageKey(zid: number, eid: number, kind: string): string {
  return `${zid}:${eid}:${kind}`;
}

export type PackageWorkspaceOpts = {
  zid?: number;
  /** Filter to one campaign (period name + kind). */
  periodName?: string;
  packageKind?: "OKO" | "BALANCE";
  periodStart?: string | null;
  periodEnd?: string | null;
  quarter?: number;
  year?: number;
  /** Org name/code search within the result set. */
  q?: string;
  limit?: number;
  offset?: number;
};

/**
 * Workspace list: periods × orgs with form counts + BP status (SQL-aggregated counts).
 */
export async function getPackageWorkspace(
  db: OkoDb,
  opts?: PackageWorkspaceOpts
): Promise<PackageWorkspaceRow[]> {
  return withTiming(
    "packages.workspace",
    async () => {
      const { normalizeBpStatus, normalizePackageKind, bpIdFor } = await import(
        "./businessProcessTypes.js"
      );
      const { getApprovalBlockersBatch } = await import("./checkJournal.js");

      const catalog = await exportCatalog(db);
      const defaultTotal = catalog.forms.length;

      const periodConds: string[] = [];
      const periodParams: unknown[] = [];
      if (opts?.zid != null) {
        periodConds.push("p.zid = ?");
        periodParams.push(opts.zid);
      }
      if (opts?.periodName?.trim()) {
        periodConds.push("p.name = ?");
        periodParams.push(opts.periodName.trim());
      }
      if (opts?.packageKind) {
        periodConds.push("COALESCE(p.package_kind, 'OKO') = ?");
        periodParams.push(opts.packageKind);
      }
      if (opts?.quarter != null && opts?.year != null) {
        periodConds.push("p.quarter = ? AND p.year = ?");
        periodParams.push(opts.quarter, opts.year);
      }
      if (opts?.periodStart) {
        periodConds.push("p.period_start = ?");
        periodParams.push(opts.periodStart);
      }
      if (opts?.periodEnd) {
        periodConds.push("p.period_end = ?");
        periodParams.push(opts.periodEnd);
      }
      const orgQ = opts?.q?.trim();
      if (orgQ) {
        const like = `%${orgQ.replace(/[%_]/g, "\\$&")}%`;
        periodConds.push("(o.name ILIKE ? OR COALESCE(o.code, '') ILIKE ?)");
        periodParams.push(like, like);
      }
      const periodWhere = periodConds.length
        ? `WHERE ${periodConds.join(" AND ")}`
        : "";

      // Counts only for eids in the filtered period set.
      const formSetCountRows = (await db
        .prepare(
          `SELECT pfs.eid, COUNT(*)::int AS c
           FROM period_form_set pfs
           WHERE pfs.eid IN (
             SELECT p.eid FROM periods p
             JOIN organizations o ON o.zid = p.zid
             ${periodWhere}
           )
           GROUP BY pfs.eid`
        )
        .all(...periodParams)) as Array<{
        eid: number;
        c: number;
      }>;
      const formSetCountByEid = new Map(
        formSetCountRows.map((r) => [Number(r.eid), Number(r.c)] as const)
      );

      let periodSql = `SELECT p.eid, p.zid, p.package_id, p.name, p.period_start, p.period_end,
            p.period_status, p.package_kind, p.methodology_release_id,
            o.name AS org_name, o.code AS org_code
     FROM periods p
     JOIN organizations o ON o.zid = p.zid
     ${periodWhere}`;
      periodSql += ` ORDER BY o.name, p.period_start DESC, p.eid DESC`;
      const limit =
        opts?.limit != null
          ? Math.min(5000, Math.max(1, Math.trunc(opts.limit)))
          : null;
      const offset =
        opts?.offset != null && opts.offset > 0 ? Math.trunc(opts.offset) : 0;
      if (limit != null) {
        periodSql += ` LIMIT ?`;
        periodParams.push(limit);
        if (offset > 0) {
          periodSql += ` OFFSET ?`;
          periodParams.push(offset);
        }
      }

      const periods = (await db.prepare(periodSql).all(...periodParams)) as Array<{
        eid: number;
        zid: number;
        package_id: string | null;
        name: string;
        period_start: string | null;
        period_end: string | null;
        period_status: string | null;
        package_kind: string | null;
        methodology_release_id: string | null;
        org_name: string;
        org_code: string | null;
      }>;

      // Backfill missing GUIDs only when needed (not on every list GET).
      const missingGuid = periods.filter((p) => !p.package_id?.trim());
      if (missingGuid.length > 0) {
        try {
          await db.exec(
            `UPDATE periods
             SET package_id = gen_random_uuid()::text
             WHERE package_id IS NULL OR btrim(package_id) = ''`
          );
          const refreshed = (await db
            .prepare(
              `SELECT zid, eid, package_id FROM periods
               WHERE ${missingGuid.map(() => "(zid = ? AND eid = ?)").join(" OR ")}`
            )
            .all(...missingGuid.flatMap((p) => [p.zid, p.eid]))) as Array<{
            zid: number;
            eid: number;
            package_id: string | null;
          }>;
          const byKey = new Map(
            refreshed.map((r) => [`${r.zid}:${r.eid}`, r.package_id] as const)
          );
          for (const p of periods) {
            if (!p.package_id?.trim()) {
              p.package_id = byKey.get(`${p.zid}:${p.eid}`) ?? p.package_id;
            }
          }
        } catch {
          for (const p of missingGuid) {
            const guid = newPackageGuid();
            await db
              .prepare(`UPDATE periods SET package_id = ? WHERE zid = ? AND eid = ?`)
              .run(guid, p.zid, p.eid);
            p.package_id = guid;
          }
        }
      }

      if (periods.length === 0) return [];

      // Scope instance/BP queries to returned packages (not the whole DB).
      const countsByPackage = new Map<
        string,
        { filled: number; submitted: number }
      >();
      const bpRows: Array<{
        id: string;
        zid: number;
        eid: number;
        package_kind: string;
        status: string;
        curator_user_id: number | null;
        last_changed_at: string | null;
        iteration: number;
        curator_name: string | null;
      }> = [];
      {
        const PAIR_CHUNK = 80;
        for (let offset = 0; offset < periods.length; offset += PAIR_CHUNK) {
          const chunk = periods.slice(offset, offset + PAIR_CHUNK);
          const { where, params } = pairsWhereSql(
            chunk.map((p) => ({ zid: Number(p.zid), eid: Number(p.eid) }))
          );
          const instAgg = (await db
            .prepare(
              `SELECT zid, eid,
                      COUNT(*)::int AS filled,
                      COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted
               FROM form_instances
               WHERE ${where}
               GROUP BY zid, eid`
            )
            .all(...params)) as Array<{
            zid: number;
            eid: number;
            filled: number;
            submitted: number;
          }>;
          for (const r of instAgg) {
            countsByPackage.set(`${r.zid}:${r.eid}`, {
              filled: Number(r.filled ?? 0),
              submitted: Number(r.submitted ?? 0),
            });
          }
          const bpWhere = pairsWhereSql(
            chunk.map((p) => ({ zid: Number(p.zid), eid: Number(p.eid) })),
            "bp"
          );
          const bpPart = (await db
            .prepare(
              `SELECT bp.id, bp.zid, bp.eid, bp.package_kind, bp.status,
                      bp.curator_user_id, bp.last_changed_at, bp.iteration,
                      u.display_name AS curator_name
               FROM business_processes bp
               LEFT JOIN users u ON u.id = bp.curator_user_id
               WHERE ${bpWhere.where}`
            )
            .all(...bpWhere.params)) as typeof bpRows;
          bpRows.push(...bpPart);
        }
      }
      const bpByKey = new Map(
        bpRows.map((b) => [
          packageKey(Number(b.zid), Number(b.eid), normalizePackageKind(b.package_kind)),
          b,
        ])
      );

      let exchangeByKey = new Map<
        string,
        {
          lastExportedAt: string | null;
          lastImportedAt: string | null;
          importVersion: number;
        }
      >();
      try {
        const { listPackageExchange } = await import("./packageExchange.js");
        exchangeByKey = await listPackageExchange(db, { zid: opts?.zid });
      } catch {
        /* marks are optional — do not break the package list */
      }

      const pendingBlockerTargets = bpRows
        .filter((b) => normalizeBpStatus(b.status) === "pending_curator_approval")
        .map((b) => ({
          zid: Number(b.zid),
          eid: Number(b.eid),
          packageKind: normalizePackageKind(b.package_kind),
        }));
      let blockersByKey = new Map<
        string,
        { blocked: boolean; missingExplanations: unknown[] }
      >();
      try {
        blockersByKey = await getApprovalBlockersBatch(db, pendingBlockerTargets);
      } catch {
        blockersByKey = new Map();
      }

      const rows: PackageWorkspaceRow[] = [];
      for (const p of periods) {
        const zid = Number(p.zid);
        const eid = Number(p.eid);
        const packageKind = normalizePackageKind(p.package_kind);
        const setCount = formSetCountByEid.get(eid) ?? 0;
        const total = setCount > 0 ? setCount : defaultTotal;
        const counts = countsByPackage.get(`${zid}:${eid}`) ?? {
          filled: 0,
          submitted: 0,
        };
        const filled = Math.min(counts.filled, total);
        const submitted = Math.min(counts.submitted, filled);
        const draft = Math.max(0, filled - submitted);
        const bp = bpByKey.get(packageKey(zid, eid, packageKind));
        const bpStatus = bp ? normalizeBpStatus(bp.status) : null;

        let hasBlockers = false;
        if (bpStatus === "pending_curator_approval") {
          hasBlockers =
            blockersByKey.get(`${zid}:${eid}:${packageKind}`)?.blocked ?? false;
        }

        const exchange = exchangeByKey.get(
          p.package_id ?? packageIdFor(zid, eid, packageKind)
        );
        const packageId =
          p.package_id?.trim() || packageIdFor(zid, eid, packageKind);

        rows.push({
          zid,
          eid,
          packageId,
          organizationName: p.org_name,
          organizationCode: p.org_code,
          periodName: p.name,
          periodStart: dateOrNull(p.period_start),
          periodEnd: dateOrNull(p.period_end),
          periodStatus: normalizePeriodStatus(p.period_status),
          packageKind,
          total,
          filled,
          draft,
          submitted,
          percent: total > 0 ? Math.round((filled / total) * 100) : 0,
          bpId: bp?.id ?? bpIdFor(zid, eid, packageKind),
          bpStatus,
          curatorUserId:
            bp?.curator_user_id == null ? null : Number(bp.curator_user_id),
          curatorName: bp?.curator_name ?? null,
          bpLastChangedAt: bp?.last_changed_at ?? null,
          bpIteration: bp ? Number(bp.iteration ?? 0) : null,
          hasBlockers,
          methodologyReleaseId: p.methodology_release_id ?? null,
          lastExportedAt: exchange?.lastExportedAt ?? null,
          lastImportedAt: exchange?.lastImportedAt ?? null,
          importVersion: exchange?.importVersion ?? 0,
        });
      }
      return rows;
    },
    () => ({ zid: opts?.zid ?? null })
  );
}

export async function getPackageWorkspaceDetail(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind?: "OKO" | "BALANCE"
): Promise<PackageWorkspaceDetail | null> {
  const { ensureBusinessProcess } = await import("./businessProcess.js");
  const { getApprovalBlockers } = await import("./checkJournal.js");
  const { normalizePackageKind } = await import("./businessProcessTypes.js");

  const kind = normalizePackageKind(packageKind);
  // Scope workspace to this org only (not all 1000 packages).
  const list = await getPackageWorkspace(db, { zid });
  const row =
    list.find((r) => r.eid === eid && r.packageKind === kind) ??
    list.find((r) => r.eid === eid);
  if (!row) return null;

  const completeness = await getPackageCompleteness(db, zid, eid);
  let bp = null;
  try {
    bp = await ensureBusinessProcess(db, zid, eid, row.packageKind);
  } catch {
    bp = null;
  }

  let blockers = null;
  if (bp) {
    try {
      blockers = await getApprovalBlockers(db, zid, eid, row.packageKind);
    } catch {
      blockers = null;
    }
  }

  const children = await listChildOrganizations(db, zid);

  const enrichedRow: PackageWorkspaceRow = {
    ...row,
    bpId: bp?.id ?? row.bpId,
    bpStatus: bp?.status ?? row.bpStatus,
    curatorUserId: bp?.curatorUserId ?? row.curatorUserId,
    curatorName: bp?.curatorName ?? row.curatorName,
    bpLastChangedAt: bp?.lastChangedAt ?? row.bpLastChangedAt,
    bpIteration: bp?.iteration ?? row.bpIteration,
    hasBlockers: blockers?.blocked ?? row.hasBlockers,
    total: completeness.total,
    filled: completeness.filled,
    draft: completeness.draft,
    submitted: completeness.submitted,
    percent:
      completeness.total > 0
        ? Math.round((completeness.filled / completeness.total) * 100)
        : 0,
  };

  return {
    row: enrichedRow,
    completeness,
    bp,
    blockers,
    childOrgCount: children.length,
  };
}

export interface DeletePackageResult {
  deletedInstances: number;
  periodRemoved: boolean;
}

async function listPackageInstanceIds(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<string[]> {
  const normalized = (await db
    .prepare("SELECT instance_id FROM form_instances WHERE zid = ? AND eid = ?")
    .all(zid, eid)) as Array<{ instance_id: string }>;
  return normalized.map((row) => row.instance_id);
}

function pairsWhereSql(
  pairs: Array<{ zid: number; eid: number }>,
  alias?: string
): {
  where: string;
  params: unknown[];
} {
  const z = alias ? `${alias}.zid` : "zid";
  const e = alias ? `${alias}.eid` : "eid";
  const where = pairs.map(() => `(${z} = ? AND ${e} = ?)`).join(" OR ");
  const params = pairs.flatMap((p) => [p.zid, p.eid]);
  return { where, params };
}

async function purgePackageRelationsMany(
  db: OkoDb,
  pairs: Array<{ zid: number; eid: number }>,
  opts?: { removeFormSet?: boolean }
): Promise<void> {
  if (!pairs.length) return;
  const PAIR_CHUNK = 80;
  for (let offset = 0; offset < pairs.length; offset += PAIR_CHUNK) {
    const chunk = pairs.slice(offset, offset + PAIR_CHUNK);
    const { where, params } = pairsWhereSql(chunk);
    const eids = [...new Set(chunk.map((p) => p.eid))];
    const eidPlaceholders = eids.map(() => "?").join(",");

    await tryDelete(db, `DELETE FROM business_processes WHERE ${where}`, ...params);
    if (opts?.removeFormSet) {
      await tryDelete(
        db,
        `DELETE FROM period_form_set WHERE eid IN (${eidPlaceholders})`,
        ...eids
      );
    }
    await tryDelete(db, `DELETE FROM check_explanations WHERE ${where}`, ...params);
    await tryDelete(db, `DELETE FROM check_run_journal WHERE ${where}`, ...params);
    await tryDelete(
      db,
      `DELETE FROM agg_run_locks WHERE ${chunk.map(() => "(parent_zid = ? AND eid = ?)").join(" OR ")}`,
      ...params
    );
    await tryDelete(
      db,
      `DELETE FROM agg_corr_sets WHERE source_eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM svod_results WHERE eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM svod_definitions WHERE eid IN (${eidPlaceholders})`,
      ...eids
    );
    await tryDelete(
      db,
      `DELETE FROM package_inbox WHERE ${chunk
        .map(() => "(pkg_zid = ? AND pkg_eid = ?) OR (target_zid = ? AND target_eid = ?)")
        .join(" OR ")}`,
      ...chunk.flatMap((p) => [p.zid, p.eid, p.zid, p.eid])
    );
    await tryDelete(db, `DELETE FROM do_transport_inbox WHERE ${where}`, ...params);
    await tryDelete(
      db,
      `DELETE FROM transfer_batches WHERE ${chunk
        .map(
          () =>
            "(source_zid = ? AND source_eid = ?) OR (target_zid = ? AND target_eid = ?)"
        )
        .join(" OR ")}`,
      ...chunk.flatMap((p) => [p.zid, p.eid, p.zid, p.eid])
    );
    await tryDelete(db, `DELETE FROM package_exchange WHERE ${where}`, ...params);

    try {
      const packageIds = (await db
        .prepare(
          `SELECT package_id FROM periods WHERE ${where} AND package_id IS NOT NULL AND btrim(package_id) <> ''`
        )
        .all(...params)) as Array<{ package_id: string }>;
      for (const row of packageIds) {
        if (!row.package_id) continue;
        await tryDelete(
          db,
          `DELETE FROM package_exchange WHERE package_id = ?`,
          row.package_id
        );
      }
    } catch {
      /* best-effort */
    }
  }
}

/** Best-effort DELETE: skip if table/columns are missing (older DBs / optional PSD tables). */
async function tryDelete(
  db: OkoDb,
  sql: string,
  ...params: unknown[]
): Promise<void> {
  try {
    await db.prepare(sql).run(...params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /does not exist|no such table|undefined.?column|column .+ does not exist/i.test(
        msg
      )
    ) {
      return;
    }
    throw e;
  }
}

/**
 * Remove package-scoped relations for zid × eid.
 * Keeps the periods row and (by default) period_form_set so the period stays open.
 */
async function purgePackageRelations(
  db: OkoDb,
  zid: number,
  eid: number,
  opts?: { removeFormSet?: boolean }
): Promise<void> {
  await purgePackageRelationsMany(db, [{ zid, eid }], opts);
}

/**
 * Delete a report package completely: forms, BP, exchange, and the periods row.
 * No empty stub left in the period list — re-open the period to get a new shell.
 */
export async function deleteReportPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<DeletePackageResult> {
  const period = (await db
    .prepare("SELECT 1 FROM periods WHERE eid = ? AND zid = ?")
    .get(eid, zid)) as { 1: number } | undefined;
  if (!period) throw new Error("Period not found");

  let deletedInstances = 0;
  await db.transaction(async (tx) => {
    deletedInstances = await deleteInstancesForPackages(tx, [{ zid, eid }]);
    try {
      await purgePackageRelations(tx, zid, eid, { removeFormSet: true });
    } catch (e) {
      console.warn(
        "[deleteReportPackage] purgePackageRelations:",
        e instanceof Error ? e.message : e
      );
    }
    await tx
      .prepare("DELETE FROM periods WHERE eid = ? AND zid = ?")
      .run(eid, zid);
  });

  return { deletedInstances, periodRemoved: true };
}

export interface BulkDeletePackageItem {
  zid: number;
  eid: number;
}

export interface BulkDeletePackageItemResult {
  zid: number;
  eid: number;
  ok: boolean;
  deletedInstances?: number;
  error?: string;
}

export interface BulkDeletePackageResult {
  deleted: number;
  failed: number;
  deletedInstances: number;
  results: BulkDeletePackageItemResult[];
}

/** Soft cap per HTTP request; portal clients chunk larger selections. */
const BULK_DELETE_MAX = 500;

export async function deleteReportPackagesBulk(
  db: OkoDb,
  items: BulkDeletePackageItem[]
): Promise<BulkDeletePackageResult> {
  return withTiming(
    "packages.bulkDelete",
    async () => {
      if (!Array.isArray(items) || items.length === 0) {
        const err = new Error("Укажите хотя бы один комплект");
        (err as Error & { status: number }).status = 400;
        throw err;
      }
      if (items.length > BULK_DELETE_MAX) {
        const err = new Error(
          `За один раз можно удалить не более ${BULK_DELETE_MAX} комплектов`
        );
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      const seen = new Set<string>();
      const unique: BulkDeletePackageItem[] = [];
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
      if (unique.length === 0) {
        const err = new Error("Нет корректных пар zid/eid");
        (err as Error & { status: number }).status = 400;
        throw err;
      }

      const existing = new Set<string>();
      {
        const PAIR_CHUNK = 80;
        for (let offset = 0; offset < unique.length; offset += PAIR_CHUNK) {
          const chunk = unique.slice(offset, offset + PAIR_CHUNK);
          const { where, params } = pairsWhereSql(chunk);
          const rows = (await db
            .prepare(`SELECT zid, eid FROM periods WHERE ${where}`)
            .all(...params)) as Array<{ zid: number; eid: number }>;
          for (const r of rows) existing.add(`${r.zid}:${r.eid}`);
        }
      }

      const toDelete = unique.filter((p) => existing.has(`${p.zid}:${p.eid}`));
      const results: BulkDeletePackageItemResult[] = [];
      let deletedInstances = 0;

      if (toDelete.length > 0) {
        await db.transaction(async (tx) => {
          deletedInstances = await deleteInstancesForPackages(tx, toDelete);
          try {
            await purgePackageRelationsMany(tx, toDelete, { removeFormSet: true });
          } catch (e) {
            console.warn(
              "[deleteReportPackagesBulk] purgePackageRelationsMany:",
              e instanceof Error ? e.message : e
            );
          }
          const PAIR_CHUNK = 80;
          for (let offset = 0; offset < toDelete.length; offset += PAIR_CHUNK) {
            const chunk = toDelete.slice(offset, offset + PAIR_CHUNK);
            const { where, params } = pairsWhereSql(chunk);
            await tx.prepare(`DELETE FROM periods WHERE ${where}`).run(...params);
          }
        });
      }

      for (const item of unique) {
        if (existing.has(`${item.zid}:${item.eid}`)) {
          results.push({ zid: item.zid, eid: item.eid, ok: true });
        } else {
          results.push({
            zid: item.zid,
            eid: item.eid,
            ok: false,
            error: "Period not found",
          });
        }
      }

      return {
        deleted: toDelete.length,
        failed: unique.length - toDelete.length,
        deletedInstances,
        results,
      };
    },
    () => ({ items: items?.length ?? 0 })
  );
}

export interface BulkExportPackageItem {
  zid: number;
  eid: number;
}

export interface BulkExportManifestEntry {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  packageKind: "OKO" | "BALANCE";
  formCount: number;
  filled: number;
  submitted: number;
  filename: string;
  ok: boolean;
  error?: string;
}

export interface BulkExportPackagesResult {
  zip: Uint8Array;
  filename: string;
  exported: number;
  failed: number;
  manifest: {
    exportedAt: string;
    packages: BulkExportManifestEntry[];
  };
}

const BULK_EXPORT_MAX = 200;

function sanitizePackageFilePart(value: string, max = 40): string {
  const cleaned = value
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (cleaned || "oko").slice(0, max);
}

async function buildExportPackageForKey(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<{
  json: string;
  filename: string;
  entry: BulkExportManifestEntry;
}> {
  const { listInstanceSummaries, loadInstance } = await import("./instances.js");
  const { normalizePackageKind } = await import("./businessProcessTypes.js");

  const period = (await db
    .prepare(
      `SELECT p.name, p.period_start, p.period_end, p.package_kind, p.package_id,
              o.name AS org_name, o.code AS org_code
       FROM periods p
       JOIN organizations o ON o.zid = p.zid
       WHERE p.eid = ? AND p.zid = ?`
    )
    .get(eid, zid)) as
    | {
        name: string;
        period_start: string | null;
        period_end: string | null;
        package_kind: string | null;
        package_id: string | null;
        org_name: string;
        org_code: string | null;
      }
    | undefined;
  if (!period) throw new Error("Период не найден");

  let packageId = period.package_id?.trim() || "";
  if (!packageId) {
    packageId = newPackageGuid();
    await db
      .prepare(`UPDATE periods SET package_id = ? WHERE zid = ? AND eid = ?`)
      .run(packageId, zid, eid);
  }

  const summaries = await listInstanceSummaries(db, { zid, eid });
  const instances: OkoFormInstance[] = [];
  let submitted = 0;
  for (const s of summaries) {
    const inst = await loadInstance(db, s.instanceId);
    if (!inst) continue;
    instances.push({ ...inst, zid, eid });
    if (s.status === "submitted") submitted++;
  }

  const packageKind = normalizePackageKind(period.package_kind);
  const orgPart = sanitizePackageFilePart(
    period.org_code || period.org_name || `zid${zid}`
  );
  const periodPart = sanitizePackageFilePart(period.name || `eid${eid}`, 30);
  const filename = `oko_package_${orgPart}_${periodPart}_z${zid}_e${eid}.json`;

  const pkg = {
    version: "1.3",
    exportedAt: new Date().toISOString(),
    organization: period.org_name,
    periodStart: dateToString(period.period_start),
    periodEnd: dateToString(period.period_end),
    zid,
    eid,
    packageId,
    packageKind,
    instanceCount: instances.length,
    instances,
  };

  return {
    json: JSON.stringify(pkg, null, 2),
    filename,
    entry: {
      zid,
      eid,
      organizationName: period.org_name,
      organizationCode: period.org_code,
      periodName: period.name,
      packageKind,
      formCount: instances.length,
      filled: instances.length,
      submitted,
      filename,
      ok: true,
    },
  };
}

export async function exportReportPackagesBulk(
  db: OkoDb,
  items: BulkExportPackageItem[]
): Promise<BulkExportPackagesResult> {
  const { zipStoreFiles } = await import("./zipStore.js");

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Укажите хотя бы один комплект");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (items.length > BULK_EXPORT_MAX) {
    const err = new Error(`За один раз можно выгрузить не более ${BULK_EXPORT_MAX} комплектов`);
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const seen = new Set<string>();
  const unique: BulkExportPackageItem[] = [];
  for (const raw of items) {
    const zid = Number(raw?.zid);
    const eid = Number(raw?.eid);
    if (!Number.isFinite(zid) || !Number.isFinite(eid) || zid <= 0 || eid <= 0) continue;
    const key = `${zid}:${eid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ zid, eid });
  }
  if (unique.length === 0) {
    const err = new Error("Нет корректных пар zid/eid");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const exportedAt = new Date().toISOString();
  const files: Array<{ name: string; data: string }> = [];
  const manifestPackages: BulkExportManifestEntry[] = [];
  let exported = 0;
  let failed = 0;
  const usedNames = new Set<string>();

  for (const item of unique) {
    try {
      const built = await buildExportPackageForKey(db, item.zid, item.eid);
      let name = built.filename;
      if (usedNames.has(name)) {
        name = name.replace(/\.json$/i, `_${exported + failed + 1}.json`);
      }
      usedNames.add(name);
      files.push({ name, data: built.json });
      manifestPackages.push({ ...built.entry, filename: name });
      exported += 1;
      try {
        const { touchPackageExported } = await import("./packageExchange.js");
        const ctx = await resolvePackageContext(db, {
          zid: item.zid,
          eid: item.eid,
        });
        if (ctx?.packageId) {
          await touchPackageExported(
            db,
            ctx.packageId,
            item.zid,
            item.eid,
            exportedAt
          );
        }
      } catch {
        /* exchange mark is best-effort */
      }
    } catch (e) {
      failed += 1;
      manifestPackages.push({
        zid: item.zid,
        eid: item.eid,
        organizationName: "",
        organizationCode: null,
        periodName: "",
        packageKind: "OKO",
        formCount: 0,
        filled: 0,
        submitted: 0,
        filename: "",
        ok: false,
        error: e instanceof Error ? e.message : "Ошибка выгрузки",
      });
    }
  }

  if (exported === 0) {
    const err = new Error(
      failed > 0
        ? `Не удалось выгрузить ни одного комплекта (${failed} ошибок)`
        : "Нет комплектов для выгрузки"
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const manifest = {
    exportedAt,
    packages: manifestPackages,
  };
  files.unshift({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });

  const zip = zipStoreFiles(files);
  const day = exportedAt.slice(0, 10);
  const filename = `oko_packages_${day}_${exported}orgs.zip`;
  return { zip, filename, exported, failed, manifest };
}

export async function createReportPackage(
  db: OkoDb,
  zid: number,
  eid: number,
  opts?: {
    onProgress?: (progress: number, message?: string) => void | Promise<void>;
    /** If set — create only these templates (subset). */
    formIds?: string[];
    /** Preloaded schemas (skip loadFormSchemas). */
    schemas?: Map<string, FormSchemaDto>;
  }
): Promise<CreatePackageResult> {
  let created = 0;
  let skipped = 0;
  let total = 0;
  let instances = 0;

  return withTiming(
    "packages.create",
    async () => {
      await assertPeriodWritable(db, eid, zid);
      await opts?.onProgress?.(5, "Проверка периода");

      const org = (await db
        .prepare("SELECT name FROM organizations WHERE zid = ?")
        .get(zid)) as { name: string } | undefined;
      if (!org) throw new Error("Organization not found");

      const period = (await db
        .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
        .get(eid, zid)) as
        | { name: string; period_start: string | null; period_end: string | null }
        | undefined;
      if (!period) throw new Error("Period not found");

      let formSet = await ensurePeriodFormSet(db, eid);
      if (opts?.formIds?.length) {
        const allow = new Set(
          opts.formIds.map((id) => String(id).trim()).filter(Boolean)
        );
        formSet = formSet.filter((entry) => allow.has(entry.formId));
      }
      const existing = await existingTemplatesForPackage(db, zid, eid);
      const now = new Date().toISOString();
      const instanceIds: string[] = [];
      created = 0;
      skipped = 0;
      total = formSet.length;

      const enterpriseCode = await (async () => {
        const row = (await db
          .prepare("SELECT value FROM app_settings WHERE key = 'globalMeta'")
          .get()) as { value: string } | undefined;
        if (!row) return "1@1";
        try {
          const meta = JSON.parse(row.value) as { enterpriseCode?: string };
          return meta.enterpriseCode ?? "1@1";
        } catch {
          return "1@1";
        }
      })();

      const toCreate = formSet.filter((entry) => !existing.has(entry.formId));
      skipped += formSet.length - toCreate.length;

      await opts?.onProgress?.(15, `Загрузка схем (${toCreate.length})`);
      const missingSchemaIds = toCreate
        .map((e) => e.formId)
        .filter((id) => !opts?.schemas?.has(id));
      const loaded =
        missingSchemaIds.length > 0
          ? await loadFormSchemas(db, missingSchemaIds)
          : new Map<string, FormSchemaDto>();
      const schemas = new Map<string, FormSchemaDto>(opts?.schemas ?? []);
      for (const [id, schema] of loaded) schemas.set(id, schema);

      const lazy = isLazyCellsEnabled();
      const built: OkoFormInstance[] = [];
      for (const entry of toCreate) {
        const schema = schemas.get(entry.formId);
        if (!schema) {
          skipped++;
          continue;
        }

        const signatures: Record<string, string> = {};
        for (const name of schema.signatures) signatures[name] = "";

        const schemaVersion = entry.schemaVersion || schema.schemaVersion || 1;
        built.push({
          instanceId: randomUUID(),
          templateId: schema.id,
          templateTitle: schema.title,
          displayName: defaultDisplayName(schema.id, schema.title, org.name),
          zid,
          eid,
          templateSchemaVersion: schemaVersion,
          meta: {
            organization: org.name,
            enterpriseCode,
            periodStart: dateToString(period.period_start),
            periodEnd: dateToString(period.period_end),
            unit: schema.meta.unit || "тыс.руб.",
          },
          rows: lazy ? [] : buildInitialRows(schema),
          signatures,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.transaction(async (tx) => {
        if (lazy) {
          await saveInstanceHeadersBulk(tx, built);
          for (let i = 0; i < built.length; i++) {
            instanceIds.push(built[i]!.instanceId);
            created++;
            if (built.length > 0 && (i === 0 || i === built.length - 1 || (i + 1) % 25 === 0)) {
              const pct = 15 + Math.round(((i + 1) / built.length) * 80);
              await opts?.onProgress?.(pct, `Формы: ${i + 1}/${built.length}`);
            }
          }
        } else {
          let i = 0;
          for (const inst of built) {
            await saveInstanceCells(tx, inst, { materializeCells: true });
            instanceIds.push(inst.instanceId);
            created++;
            i++;
            if (built.length > 0 && (i === 1 || i === built.length || i % 5 === 0)) {
              const pct = 15 + Math.round((i / built.length) * 80);
              await opts?.onProgress?.(pct, `Формы: ${i}/${built.length}`);
            }
          }
        }
      });

      instances = instanceIds.length;
      await opts?.onProgress?.(100, "Готово");
      return { created, skipped, total, instanceIds };
    },
    () => ({ zid, eid, created, skipped, total, instances })
  );
}

export async function distributePackagesToChildren(
  db: OkoDb,
  parentZid: number,
  sourceEid: number,
  opts?: {
    createEmptyPackages?: boolean;
    /** Explicit target orgs; if omitted — children by parent_zid. */
    childZids?: number[];
    /** If no children: use all other organizations. */
    fallbackAllOthers?: boolean;
  }
): Promise<{
  parentZid: number;
  sourceEid: number;
  createdPeriods: number;
  createdPackages: number;
  children: Array<{
    zid: number;
    name: string;
    eid: number;
    created: number;
    skipped: number;
  }>;
}> {
  const source = (await db
    .prepare(
      `SELECT name, period_start, period_end, quarter, year, methodology_release_id
       FROM periods WHERE zid = ? AND eid = ?`
    )
    .get(parentZid, sourceEid)) as
    | {
        name: string;
        period_start: string | null;
        period_end: string | null;
        quarter: number | null;
        year: number | null;
        methodology_release_id: string | null;
      }
    | undefined;
  if (!source) throw new Error("Source period not found");

  const sourceForms = await ensurePeriodFormSet(db, sourceEid);

  let children: Array<{ zid: number; name: string }> = [];
  if (opts?.childZids?.length) {
    const placeholders = opts.childZids.map(() => "?").join(",");
    children = (await db
      .prepare(
        `SELECT zid, name FROM organizations
         WHERE zid IN (${placeholders}) AND zid <> ?
         ORDER BY name`
      )
      .all(...opts.childZids, parentZid)) as Array<{ zid: number; name: string }>;
  } else {
    children = await listChildOrganizations(db, parentZid);
    if (children.length === 0 && opts?.fallbackAllOthers) {
      children = (await db
        .prepare(
          `SELECT zid, name FROM organizations WHERE zid <> ? ORDER BY name`
        )
        .all(parentZid)) as Array<{ zid: number; name: string }>;
    }
  }

  if (children.length === 0) {
    const err = new Error(
      "Нет организаций для раздачи: укажите parent_zid у дочерних или раздайте всем остальным org"
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const result: Array<{
    zid: number;
    name: string;
    eid: number;
    created: number;
    skipped: number;
  }> = [];
  let createdPackages = 0;

  for (const child of children) {
    const period = await createPeriod(db, {
      zid: child.zid,
      name: source.name,
      periodStart: dateToString(source.period_start) || undefined,
      periodEnd: dateToString(source.period_end) || undefined,
      quarter: source.quarter ?? undefined,
      year: source.year ?? undefined,
      methodologyReleaseId: source.methodology_release_id,
    });
    await db.prepare("DELETE FROM period_form_set WHERE eid = ?").run(period.eid);
    const ins = db.prepare(
      `INSERT INTO period_form_set (eid, form_id, schema_version) VALUES (?, ?, ?)`
    );
    for (const f of sourceForms) {
      await ins.run(period.eid, f.formId, f.schemaVersion);
    }

    let created = 0;
    let skipped = 0;
    if (opts?.createEmptyPackages !== false) {
      const pkg = await createReportPackage(db, child.zid, period.eid);
      created = pkg.created;
      skipped = pkg.skipped;
      createdPackages++;
    }
    result.push({
      zid: child.zid,
      name: child.name,
      eid: period.eid,
      created,
      skipped,
    });
  }

  return {
    parentZid,
    sourceEid,
    createdPeriods: result.length,
    createdPackages,
    children: result,
  };
}

async function resolveConstructFormIds(
  db: OkoDb,
  forms: PackageConstructInput["forms"]
): Promise<string[]> {
  const catalog = await exportCatalog(db);
  const active = catalog.forms
    .filter((f) => !(f as { archived?: boolean }).archived)
    .map((f) => f.id);
  if (forms.mode !== "selected") return active;
  const requested = [...new Set((forms.formIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  if (!requested.length) {
    const err = new Error("Выберите хотя бы одну форму");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const allow = new Set(active);
  const selected = requested.filter((id) => allow.has(id));
  if (!selected.length) {
    const err = new Error("Выбранные формы не найдены в каталоге");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return selected;
}

function constructPeriodLabel(period: PackageConstructInput["period"]): string {
  return String(period.name ?? "").trim() || "Период";
}

function quarterDateRange(
  quarter: number,
  year: number
): { periodStart: string; periodEnd: string } {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  const y = Math.trunc(year);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, endMonth, 0).getDate();
  return {
    periodStart: `${y}-${pad(startMonth)}-01`,
    periodEnd: `${y}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

function quarterPeriodName(quarter: number, year: number): string {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  return `${q} квартал ${Math.trunc(year)}`;
}

function normalizeConstructInput(input: PackageConstructInput): PackageConstructInput {
  const rawQuarter = input.period?.quarter != null ? Number(input.period.quarter) : NaN;
  const rawYear = input.period?.year != null ? Number(input.period.year) : NaN;
  const hasQuarter =
    Number.isFinite(rawQuarter) &&
    rawQuarter >= 1 &&
    rawQuarter <= 4 &&
    Number.isFinite(rawYear) &&
    rawYear >= 2000 &&
    rawYear <= 2100;

  let name = String(input.period?.name ?? "").trim();
  let periodStart = input.period?.periodStart;
  let periodEnd = input.period?.periodEnd;
  let quarter: number | undefined;
  let year: number | undefined;

  if (hasQuarter) {
    quarter = Math.trunc(rawQuarter);
    year = Math.trunc(rawYear);
    name = quarterPeriodName(quarter, year);
    const range = quarterDateRange(quarter, year);
    periodStart = range.periodStart;
    periodEnd = range.periodEnd;
  }

  const rawEid = input.period?.eid != null ? Number(input.period.eid) : NaN;
  const eid =
    Number.isFinite(rawEid) && rawEid > 0 ? Math.trunc(rawEid) : undefined;

  if (!name && eid == null) {
    const err = new Error("Укажите квартал и год отчётного периода");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (!name && eid != null) {
    name = `EID ${eid}`;
  }
  const targets = (input.targets ?? [])
    .map((t) => ({ zid: Number(t.zid) }))
    .filter((t) => Number.isFinite(t.zid) && t.zid > 0);
  if (!targets.length) {
    const err = new Error("Выберите хотя бы одну организацию");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const unique = new Map<number, { zid: number }>();
  for (const t of targets) unique.set(t.zid, t);
  return {
    mode: input.mode === "bulk" ? "bulk" : "single",
    targets: [...unique.values()],
    period: {
      eid,
      name,
      periodStart,
      periodEnd,
      quarter,
      year,
      packageKind: input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO",
      reuseExisting: input.period.reuseExisting !== false,
      methodologyReleaseId: input.period.methodologyReleaseId,
      collectionUnitZid: input.period.collectionUnitZid,
    },
    forms: {
      mode: input.forms?.mode === "selected" ? "selected" : "all",
      formIds: input.forms?.formIds,
    },
    options: {
      createInstances: input.options?.createInstances !== false,
      continueOnError: input.options?.continueOnError !== false,
      allowCreatePeriod: input.options?.allowCreatePeriod === true,
    },
  };
}

async function findExistingPeriodForConstruct(
  db: OkoDb,
  zid: number,
  period: PackageConstructInput["period"],
  packageKind: "OKO" | "BALANCE"
): Promise<{
  eid: number;
  name: string;
  period_status: string | null;
  package_kind: string | null;
} | null> {
  if (period.eid != null) {
    const byEid = (await db
      .prepare(
        `SELECT eid, name, period_status, package_kind
         FROM periods
         WHERE eid = ? AND zid = ?
         LIMIT 1`
      )
      .get(period.eid, zid)) as
      | {
          eid: number;
          name: string;
          period_status: string | null;
          package_kind: string | null;
        }
      | undefined;
    if (byEid) return byEid;
  }

  if (period.quarter != null && period.year != null) {
    const byQy = (await db
      .prepare(
        `SELECT eid, name, period_status, package_kind
         FROM periods
         WHERE zid = ?
           AND quarter = ?
           AND year = ?
           AND COALESCE(package_kind, 'OKO') = ?
         ORDER BY eid DESC
         LIMIT 1`
      )
      .get(zid, period.quarter, period.year, packageKind)) as
      | {
          eid: number;
          name: string;
          period_status: string | null;
          package_kind: string | null;
        }
      | undefined;
    if (byQy) return byQy;
  }

  const name = String(period.name ?? "").trim();
  if (!name) return null;
  const row = (await db
    .prepare(
      `SELECT eid, name, period_status, package_kind
       FROM periods
       WHERE zid = ? AND name = ? AND COALESCE(package_kind, 'OKO') = ?
       ORDER BY eid DESC
       LIMIT 1`
    )
    .get(zid, name, packageKind)) as
    | {
        eid: number;
        name: string;
        period_status: string | null;
        package_kind: string | null;
      }
    | undefined;
  return row ?? null;
}

async function previewOneConstructTarget(
  db: OkoDb,
  zid: number,
  input: PackageConstructInput,
  formIds: string[]
): Promise<PackageConstructRowResult> {
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(zid)) as { name: string } | undefined;
  if (!org) {
    return {
      zid,
      organizationName: `Организация ${zid}`,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated: false,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings: [],
      error: "Организация не найдена",
    };
  }

  const packageKind = input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const existing = await findExistingPeriodForConstruct(
    db,
    zid,
    input.period,
    packageKind
  );
  const warnings: string[] = [];
  let periodCreated = false;
  let eid: number | undefined;
  let formsSkipped = 0;
  let formsCreated = formIds.length;

  if (existing) {
    eid = Number(existing.eid);
    if (!input.period.reuseExisting) {
      return {
        zid,
        organizationName: org.name,
        eid,
        periodName: existing.name,
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Период с таким названием уже существует",
      };
    }
    if (normalizePeriodStatus(existing.period_status) === "closed") {
      return {
        zid,
        organizationName: org.name,
        eid,
        periodName: existing.name,
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Период закрыт — создание/дозаведение недоступно",
      };
    }
    warnings.push("Период уже есть — будут дозаведены недостающие формы");
    const existingTemplates = await existingTemplatesForPackage(db, zid, eid);
    formsSkipped = formIds.filter((id) => existingTemplates.has(id)).length;
    formsCreated = Math.max(0, formIds.length - formsSkipped);
    if (!input.options?.createInstances) {
      formsCreated = 0;
      warnings.push("Создание пустых форм отключено");
    } else if (formsCreated === 0) {
      warnings.push("Все выбранные формы уже заведены");
    }
  } else {
    if (input.options?.allowCreatePeriod !== true) {
      return {
        zid,
        organizationName: org.name,
        periodName: constructPeriodLabel(input.period),
        status: "error",
        periodCreated: false,
        formsTotal: formIds.length,
        formsCreated: 0,
        formsSkipped: 0,
        warnings,
        error: "Сначала создайте период",
      };
    }
    periodCreated = true;
    if (!input.options?.createInstances) {
      formsCreated = 0;
      warnings.push("Будет создан только период без пустых форм");
    }
  }

  return {
    zid,
    organizationName: org.name,
    eid,
    periodName: constructPeriodLabel(input.period),
    status: "ready",
    periodCreated,
    formsTotal: formIds.length,
    formsCreated,
    formsSkipped,
    warnings,
  };
}

export async function previewPackageConstruction(
  db: OkoDb,
  raw: PackageConstructInput
): Promise<PackageConstructResult> {
  const input = normalizeConstructInput(raw);
  const formIds = await resolveConstructFormIds(db, input.forms);
  const rows: PackageConstructRowResult[] = [];
  for (const t of input.targets) {
    rows.push(await previewOneConstructTarget(db, t.zid, input, formIds));
  }
  return {
    summary: {
      targets: rows.length,
      periodsCreated: rows.filter((r) => r.status === "ready" && r.periodCreated).length,
      formsCreated: rows
        .filter((r) => r.status === "ready")
        .reduce((n, r) => n + r.formsCreated, 0),
      skipped: rows.reduce((n, r) => n + r.formsSkipped, 0),
      errors: rows.filter((r) => r.status === "error").length,
    },
    rows,
  };
}

async function constructOnePackage(
  db: OkoDb,
  zid: number,
  input: PackageConstructInput,
  formIds: string[],
  schemas?: Map<string, FormSchemaDto>
): Promise<PackageConstructRowResult> {
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(zid)) as { name: string } | undefined;
  if (!org) {
    return {
      zid,
      organizationName: `Организация ${zid}`,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated: false,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings: [],
      error: "Организация не найдена",
    };
  }

  const packageKind = input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const warnings: string[] = [];
  let eid: number | undefined;
  let periodCreated = false;

  try {
    const existing = await findExistingPeriodForConstruct(
      db,
      zid,
      input.period,
      packageKind
    );

    if (existing) {
      eid = Number(existing.eid);
      if (!input.period.reuseExisting) {
        return {
          zid,
          organizationName: org.name,
          eid,
          periodName: existing.name,
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Период с таким названием уже существует",
        };
      }
      if (normalizePeriodStatus(existing.period_status) === "closed") {
        return {
          zid,
          organizationName: org.name,
          eid,
          periodName: existing.name,
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Период закрыт — создание/дозаведение недоступно",
        };
      }
      warnings.push("Период уже есть — будут дозаведены недостающие формы");
    } else {
      if (input.options?.allowCreatePeriod !== true) {
        return {
          zid,
          organizationName: org.name,
          periodName: constructPeriodLabel(input.period),
          status: "error",
          periodCreated: false,
          formsTotal: formIds.length,
          formsCreated: 0,
          formsSkipped: 0,
          warnings,
          error: "Сначала создайте период",
        };
      }
      const period = await createPeriod(db, {
        zid,
        name: input.period.name!,
        periodStart: input.period.periodStart,
        periodEnd: input.period.periodEnd,
        quarter: input.period.quarter,
        year: input.period.year,
        packageKind,
        methodologyReleaseId: input.period.methodologyReleaseId,
        collectionUnitZid: input.period.collectionUnitZid,
      });
      eid = period.eid;
      periodCreated = true;
    }

    if (input.forms.mode === "selected") {
      const existingTemplates = await existingTemplatesForPackage(db, zid, eid!);
      if (periodCreated || existingTemplates.size === 0) {
        await replacePeriodFormSet(db, eid!, formIds);
      }
    } else if (!periodCreated) {
      await ensurePeriodFormSet(db, eid!);
    }

    let formsCreated = 0;
    let formsSkipped = 0;
    if (input.options?.createInstances !== false) {
      const pkg = await createReportPackage(db, zid, eid!, {
        formIds: input.forms.mode === "selected" ? formIds : undefined,
        schemas,
      });
      formsCreated = pkg.created;
      formsSkipped = pkg.skipped;
    }

    return {
      zid,
      organizationName: org.name,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "created",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated,
      formsSkipped,
      warnings,
    };
  } catch (e) {
    return {
      zid,
      organizationName: org.name,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings,
      error: e instanceof Error ? e.message : "Ошибка создания комплекта",
    };
  }
}

export async function constructPackages(
  db: OkoDb,
  raw: PackageConstructInput,
  opts?: {
    onProgress?: (
      progress: number,
      message?: string,
      meta?: { done: number; total: number }
    ) => void | Promise<void>;
  }
): Promise<PackageConstructResult> {
  return withTiming(
    "packages.construct",
    async () => {
      const input = normalizeConstructInput(raw);
      const formIds = await resolveConstructFormIds(db, input.forms);
      const continueOnError = input.options?.continueOnError !== false;
      const rows: PackageConstructRowResult[] = [];

      let schemas: Map<string, FormSchemaDto> | undefined;
      if (input.options?.createInstances !== false && formIds.length > 0) {
        await opts?.onProgress?.(2, `Загрузка схем (${formIds.length})`);
        schemas = await loadFormSchemas(db, formIds);
      }

      const total = input.targets.length;
      for (let i = 0; i < input.targets.length; i++) {
        const t = input.targets[i]!;
        const row = await constructOnePackage(db, t.zid, input, formIds, schemas);
        rows.push(row);
        const done = i + 1;
        const pct = Math.min(99, Math.round((done / total) * 100));
        await opts?.onProgress?.(
          pct,
          `Организации: ${done}/${total}` +
            (row.organizationName ? ` — ${row.organizationName}` : ""),
          { done, total }
        );
        if (row.status === "error" && !continueOnError) break;
      }

      await opts?.onProgress?.(100, "Готово", { done: rows.length, total });

      return {
        summary: {
          targets: rows.length,
          periodsCreated: rows.filter((r) => r.periodCreated && r.status === "created").length,
          formsCreated: rows
            .filter((r) => r.status === "created")
            .reduce((n, r) => n + r.formsCreated, 0),
          skipped: rows.reduce((n, r) => n + r.formsSkipped, 0),
          errors: rows.filter((r) => r.status === "error").length,
        },
        rows,
      };
    },
    () => ({ targets: Array.isArray(raw?.targets) ? raw.targets.length : 0 })
  );
}

async function findInstanceByTemplate(
  db: OkoDb,
  zid: number,
  eid: number,
  templateId: string
): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT instance_id FROM form_instances
       WHERE zid = ? AND eid = ? AND template_id = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(zid, eid, templateId)) as { instance_id: string } | undefined;
  return row?.instance_id ?? null;
}

export async function importReportPackage(
  db: OkoDb,
  targetZid: number,
  targetEid: number,
  pkg: ReportPackageInput,
  overwrite: boolean,
  templateIds?: string[]
): Promise<ImportPackageResult> {
  await assertPeriodWritable(db, targetEid, targetZid);
  const org = (await db
    .prepare("SELECT name FROM organizations WHERE zid = ?")
    .get(targetZid)) as { name: string } | undefined;
  if (!org) throw new Error("Organization not found");

  const period = (await db
    .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ? AND zid = ?")
    .get(targetEid, targetZid)) as
    | { name: string; period_start: string | null; period_end: string | null }
    | undefined;
  if (!period) throw new Error("Period not found");

  const organization =
    pkg.organization?.trim() || org.name;
  const periodStart = pkg.periodStart || dateToString(period.period_start);
  const periodEnd = pkg.periodEnd || dateToString(period.period_end);
  const allow = templateIds?.length ? new Set(templateIds) : null;

  const result: ImportPackageResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!pkg.instances?.length) {
    throw new Error("Package has no instances");
  }

  await db.transaction(async (tx) => {
    for (const raw of pkg.instances) {
      try {
        if (!raw.templateId) {
          result.errors.push("Форма без templateId пропущена");
          continue;
        }
        if (allow && !allow.has(raw.templateId)) {
          result.skipped++;
          continue;
        }
        const existingId = await findInstanceByTemplate(
          tx,
          targetZid,
          targetEid,
          raw.templateId
        );

        if (existingId && !overwrite) {
          result.skipped++;
          continue;
        }

        const now = new Date().toISOString();
        const inst: OkoFormInstance = {
          ...raw,
          instanceId: existingId ?? raw.instanceId ?? randomUUID(),
          zid: targetZid,
          eid: targetEid,
          templateTitle: raw.templateTitle ?? raw.templateId,
          displayName: raw.displayName ?? raw.templateId,
          status: raw.status === "submitted" ? "submitted" : "draft",
          meta: {
            organization,
            enterpriseCode: raw.meta?.enterpriseCode ?? "1@1",
            periodStart: raw.meta?.periodStart || periodStart,
            periodEnd: raw.meta?.periodEnd || periodEnd,
            unit: raw.meta?.unit ?? "тыс.руб.",
          },
          rows: raw.rows ?? [],
          signatures: raw.signatures ?? {},
          createdAt: existingId ? raw.createdAt ?? now : now,
          updatedAt: now,
        };

        await saveInstanceCells(tx, inst);
        if (raw.rashEntries !== undefined) {
          const formId = inst.templateId;
          const forForm = (raw.rashEntries ?? []).filter(
            (e) => !e.formId || e.formId === formId
          );
          await saveRashEntries(
            tx,
            inst.instanceId,
            formId,
            forForm.map((e) => ({ ...e, formId: e.formId || formId }))
          );
        }
        if (existingId) result.updated++;
        else result.created++;
      } catch (e) {
        result.errors.push(
          `${raw.templateId ?? "?"}: ${e instanceof Error ? e.message : "import failed"}`
        );
      }
    }
  });

  // Mark exchange even when all forms were skipped (already present):
  // bulk re-upload of an existing package must still count as «загружено».
  if (result.created > 0 || result.updated > 0 || result.skipped > 0) {
    try {
      const { touchPackageImported } = await import("./packageExchange.js");
      const ctx = await resolvePackageContext(db, {
        zid: targetZid,
        eid: targetEid,
      });
      if (ctx?.packageId) {
        await touchPackageImported(db, ctx.packageId, targetZid, targetEid);
      }
    } catch {
      /* exchange mark is best-effort */
    }
  }

  return result;
}
