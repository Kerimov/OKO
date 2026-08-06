import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { dateOrNull, dateToString, intOrNull } from "./dbValues.js";
import { exportCatalog, loadFormSchemas, type FormSchemaDto } from "./forms.js";
import { deleteInstanceFromDb, saveInstanceCells } from "./instances.js";
import {
  assertPeriodWritable,
  ensurePeriodFormSet,
  listChildOrganizations,
  migratePeriodLifecycle,
  normalizePeriodStatus,
  replacePeriodFormSet,
  resolveActiveMethodologyId,
  snapshotPeriodFormSet,
  type PeriodLifecycleStatus,
} from "./periodLifecycle.js";
import { saveRashEntries } from "./rash-data.js";
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

export async function listOrganizations(db: OkoDb): Promise<OrganizationDto[]> {
  const rows = (await db
    .prepare(
      `SELECT zid, name, code, parent_zid, unit_kind, head_zid, branch_code, unit_code, composite_code, guid
       FROM organizations ORDER BY name`
    )
    .all()) as Array<{
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
  }
): Promise<PeriodDto> {
  const org = await db.prepare("SELECT 1 FROM organizations WHERE zid = ?").get(input.zid);
  if (!org) throw new Error("Organization not found");

  const max = (await db.prepare("SELECT COALESCE(MAX(eid), 0) AS m FROM periods").get()) as {
    m: number;
  };
  const eid = max.m + 1;
  const methodologyId =
    input.methodologyReleaseId !== undefined
      ? input.methodologyReleaseId
      : await resolveActiveMethodologyId(db);
  const packageKind = input.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  const collectionUnitZid = input.collectionUnitZid ?? input.zid;
  const collectionUnit = await db
    .prepare("SELECT 1 FROM organizations WHERE zid = ?")
    .get(collectionUnitZid);
  if (!collectionUnit) throw new Error("Collection unit not found");
  const packageId = packageIdFor(input.zid, eid, packageKind);

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

  const formSetCount = await snapshotPeriodFormSet(db, eid);

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
  if (schema.rows.length > 0) {
    return schema.rows.map((t) => {
      const row: Record<string, string | number> = {};
      for (const col of schema.columns) row[col.key] = "";
      if (t.num) row.num = t.num;
      if (t.code) row.code = t.code;
      if (t.name) row.name = t.name;
      const accountCode = t.code ?? t.num;
      if (schema.columns.some((c) => c.key === "account") && accountCode) {
        row.account = `${accountCode} ${t.name ?? ""}`.trim();
      }
      return row;
    });
  }
  const row: Record<string, string | number> = {};
  for (const col of schema.columns) row[col.key] = "";
  return [row];
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
  const catalog = await exportCatalog(db);
  const totalForms = catalog.forms.length;

  const periods = (await db
    .prepare(
      `SELECT p.eid, p.zid, p.name, p.period_start, p.period_end,
              p.package_status, p.package_comment,
              o.name AS org_name, o.code AS org_code
       FROM periods p
       JOIN organizations o ON o.zid = p.zid
       ORDER BY o.name, p.period_start DESC, p.eid DESC`
    )
    .all()) as unknown as Array<{
    eid: number;
    zid: number;
    name: string;
    period_start: string | null;
    period_end: string | null;
    package_status: string | null;
    package_comment: string | null;
    org_name: string;
    org_code: string | null;
  }>;

  const rows: PackageDashboardRow[] = [];
  for (const p of periods) {
    const completeness = await getPackageCompleteness(db, p.zid, p.eid);
    rows.push({
      zid: p.zid,
      eid: p.eid,
      organizationName: p.org_name,
      organizationCode: p.org_code,
      periodName: p.name,
      periodStart: dateOrNull(p.period_start),
      periodEnd: dateOrNull(p.period_end),
      total: totalForms,
      filled: completeness.filled,
      draft: completeness.draft,
      submitted: completeness.submitted,
      percent: totalForms > 0 ? Math.round((completeness.filled / totalForms) * 100) : 0,
      packageStatus: normalizePackageWorkflowStatus(p.package_status),
      packageComment: p.package_comment ?? null,
    });
  }
  return rows;
}

function packageKey(zid: number, eid: number, kind: string): string {
  return `${zid}:${eid}:${kind}`;
}

/**
 * Workspace list: periods × orgs with form counts + BP status (no N+1 completeness items).
 */
export async function getPackageWorkspace(
  db: OkoDb,
  opts?: { zid?: number }
): Promise<PackageWorkspaceRow[]> {
  const { normalizeBpStatus, normalizePackageKind, bpIdFor } = await import(
    "./businessProcessTypes.js"
  );
  const { getApprovalBlockersBatch } = await import("./checkJournal.js");

  const catalog = await exportCatalog(db);
  const catalogIds = catalog.forms.map((f) => f.id);
  const defaultTotal = catalogIds.length;

  const formSetRows = (await db
    .prepare(`SELECT eid, form_id FROM period_form_set`)
    .all()) as Array<{ eid: number; form_id: string }>;
  const formSetByEid = new Map<number, string[]>();
  for (const r of formSetRows) {
    const list = formSetByEid.get(Number(r.eid)) ?? [];
    list.push(r.form_id);
    formSetByEid.set(Number(r.eid), list);
  }

  let periodSql = `SELECT p.eid, p.zid, p.name, p.period_start, p.period_end,
            p.period_status, p.package_kind, p.methodology_release_id,
            o.name AS org_name, o.code AS org_code
     FROM periods p
     JOIN organizations o ON o.zid = p.zid`;
  const periodParams: unknown[] = [];
  if (opts?.zid != null) {
    periodSql += ` WHERE p.zid = ?`;
    periodParams.push(opts.zid);
  }
  periodSql += ` ORDER BY o.name, p.period_start DESC, p.eid DESC`;

  const periods = (await db.prepare(periodSql).all(...periodParams)) as Array<{
    eid: number;
    zid: number;
    name: string;
    period_start: string | null;
    period_end: string | null;
    period_status: string | null;
    package_kind: string | null;
    methodology_release_id: string | null;
    org_name: string;
    org_code: string | null;
  }>;

  let instSql = `SELECT instance_id, zid, eid, template_id, status, updated_at
     FROM form_instances`;
  const instParams: unknown[] = [];
  if (opts?.zid != null) {
    instSql += ` WHERE zid = ?`;
    instParams.push(opts.zid);
  }
  instSql += ` ORDER BY updated_at DESC`;

  const instances = (await db.prepare(instSql).all(...instParams)) as Array<{
    instance_id: string;
    zid: number;
    eid: number;
    template_id: string;
    status: string | null;
    updated_at: string;
  }>;

  const latestByPackage = new Map<
    string,
    Map<string, { status: "draft" | "submitted" }>
  >();
  for (const inst of instances) {
    const pk = `${inst.zid}:${inst.eid}`;
    let map = latestByPackage.get(pk);
    if (!map) {
      map = new Map();
      latestByPackage.set(pk, map);
    }
    if (!map.has(inst.template_id)) {
      map.set(inst.template_id, {
        status: inst.status === "submitted" ? "submitted" : "draft",
      });
    }
  }

  let bpSql = `SELECT bp.id, bp.zid, bp.eid, bp.package_kind, bp.status,
            bp.curator_user_id, bp.last_changed_at, bp.iteration,
            u.display_name AS curator_name
     FROM business_processes bp
     LEFT JOIN users u ON u.id = bp.curator_user_id`;
  const bpParams: unknown[] = [];
  if (opts?.zid != null) {
    bpSql += ` WHERE bp.zid = ?`;
    bpParams.push(opts.zid);
  }
  const bpRows = (await db.prepare(bpSql).all(...bpParams)) as Array<{
    id: string;
    zid: number;
    eid: number;
    package_kind: string;
    status: string;
    curator_user_id: number | null;
    last_changed_at: string | null;
    iteration: number;
    curator_name: string | null;
  }>;
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
    const { listPackageExchange, migratePackageExchange } = await import(
      "./packageExchange.js"
    );
    await migratePackageExchange(db);
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
    const formIds = formSetByEid.get(eid);
    const expected = formIds && formIds.length > 0 ? formIds : catalogIds;
    const expectedSet = new Set(expected);
    const latest = latestByPackage.get(`${zid}:${eid}`) ?? new Map();

    let filled = 0;
    let draft = 0;
    let submitted = 0;
    for (const formId of expectedSet) {
      const hit = latest.get(formId);
      if (!hit) continue;
      filled++;
      if (hit.status === "submitted") submitted++;
      else draft++;
    }
    const total = expectedSet.size || defaultTotal;
    const bp = bpByKey.get(packageKey(zid, eid, packageKind));
    const bpStatus = bp ? normalizeBpStatus(bp.status) : null;

    let hasBlockers = false;
    if (bpStatus === "pending_curator_approval") {
      hasBlockers =
        blockersByKey.get(`${zid}:${eid}:${packageKind}`)?.blocked ?? false;
    }

    const exchange = exchangeByKey.get(`${zid}:${eid}`);

    rows.push({
      zid,
      eid,
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
      curatorUserId: bp?.curator_user_id == null ? null : Number(bp.curator_user_id),
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
  const list = await getPackageWorkspace(db, { zid });
  const row = list.find((r) => r.eid === eid && r.packageKind === kind) ?? list.find((r) => r.eid === eid);
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
  const ids = new Set<string>();

  const normalized = (await db
    .prepare("SELECT instance_id FROM form_instances WHERE zid = ? AND eid = ?")
    .all(zid, eid)) as Array<{ instance_id: string }>;
  for (const row of normalized) ids.add(row.instance_id);

  const portalOnly = (await db
    .prepare(
      `SELECT p.instance_id, p.payload FROM portal_instances p
       WHERE NOT EXISTS (
         SELECT 1 FROM form_instances f WHERE f.instance_id = p.instance_id
       )`
    )
    .all()) as Array<{ instance_id: string; payload: string }>;

  for (const row of portalOnly) {
    try {
      const inst = JSON.parse(row.payload) as OkoFormInstance;
      if (intOrNull(inst.zid) === zid && intOrNull(inst.eid) === eid) {
        ids.add(row.instance_id);
      }
    } catch {
      /* skip invalid payload */
    }
  }

  return [...ids];
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
 * Remove all package-scoped relations for zid × eid before deleting the periods row.
 * Includes BP, form-set, checks, svod, inbox, transfers, aggregation locks/corr sets.
 */
async function purgePackageRelations(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<void> {
  // Events cascade via business_process_events.bp_id ON DELETE CASCADE.
  await tryDelete(
    db,
    "DELETE FROM business_processes WHERE zid = ? AND eid = ?",
    zid,
    eid
  );
  await tryDelete(db, "DELETE FROM period_form_set WHERE eid = ?", eid);
  await tryDelete(
    db,
    "DELETE FROM check_explanations WHERE zid = ? AND eid = ?",
    zid,
    eid
  );
  await tryDelete(
    db,
    "DELETE FROM check_run_journal WHERE zid = ? AND eid = ?",
    zid,
    eid
  );
  await tryDelete(
    db,
    "DELETE FROM agg_run_locks WHERE parent_zid = ? AND eid = ?",
    zid,
    eid
  );
  await tryDelete(
    db,
    "DELETE FROM agg_corr_sets WHERE source_eid = ?",
    eid
  );
  await tryDelete(db, "DELETE FROM svod_results WHERE eid = ?", eid);
  // Members cascade via svod_members.svod_id ON DELETE CASCADE.
  await tryDelete(db, "DELETE FROM svod_definitions WHERE eid = ?", eid);
  await tryDelete(
    db,
    `DELETE FROM package_inbox
     WHERE (pkg_zid = ? AND pkg_eid = ?)
        OR (target_zid = ? AND target_eid = ?)`,
    zid,
    eid,
    zid,
    eid
  );
  await tryDelete(
    db,
    "DELETE FROM do_transport_inbox WHERE zid = ? AND eid = ?",
    zid,
    eid
  );
  // Patches cascade via transfer_batch_patches.batch_id ON DELETE CASCADE.
  await tryDelete(
    db,
    `DELETE FROM transfer_batches
     WHERE (source_zid = ? AND source_eid = ?)
        OR (target_zid = ? AND target_eid = ?)`,
    zid,
    eid,
    zid,
    eid
  );
}

export async function deleteReportPackage(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<DeletePackageResult> {
  // Closed / completed packages are deletable; purge removes all related rows.
  const period = (await db
    .prepare("SELECT 1 FROM periods WHERE eid = ? AND zid = ?")
    .get(eid, zid)) as { 1: number } | undefined;
  if (!period) throw new Error("Period not found");

  const instanceIds = await listPackageInstanceIds(db, zid, eid);

  await db.transaction(async (tx) => {
    for (const instanceId of instanceIds) {
      await deleteInstanceFromDb(tx, instanceId);
    }
    await purgePackageRelations(tx, zid, eid);
    await tx.prepare("DELETE FROM periods WHERE eid = ? AND zid = ?").run(eid, zid);
  });

  const ctx = await getWorkContext(db);
  if (ctx.zid === zid && ctx.eid === eid) {
    const remaining = (await db
      .prepare(
        `SELECT eid FROM periods WHERE zid = ? ORDER BY period_start DESC, eid DESC LIMIT 1`
      )
      .get(zid)) as { eid: number } | undefined;
    await setWorkContext(db, { zid, eid: remaining?.eid ?? null });
  }

  return { deletedInstances: instanceIds.length, periodRemoved: true };
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

const BULK_DELETE_MAX = 200;

export async function deleteReportPackagesBulk(
  db: OkoDb,
  items: BulkDeletePackageItem[]
): Promise<BulkDeletePackageResult> {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Укажите хотя бы один комплект");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (items.length > BULK_DELETE_MAX) {
    const err = new Error(`За один раз можно удалить не более ${BULK_DELETE_MAX} комплектов`);
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

  const results: BulkDeletePackageItemResult[] = [];
  let deleted = 0;
  let failed = 0;
  let deletedInstances = 0;

  for (const item of unique) {
    try {
      const result = await deleteReportPackage(db, item.zid, item.eid);
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
      `SELECT p.name, p.period_start, p.period_end, p.package_kind,
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
        org_name: string;
        org_code: string | null;
      }
    | undefined;
  if (!period) throw new Error("Период не найден");

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
    version: "1.2",
    exportedAt: new Date().toISOString(),
    organization: period.org_name,
    periodStart: dateToString(period.period_start),
    periodEnd: dateToString(period.period_end),
    zid,
    eid,
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
        await touchPackageExported(db, item.zid, item.eid, exportedAt);
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
  eid: number
): Promise<CreatePackageResult> {
  await assertPeriodWritable(db, eid, zid);

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

  const formSet = await ensurePeriodFormSet(db, eid);
  const existing = await existingTemplatesForPackage(db, zid, eid);
  const now = new Date().toISOString();
  const instanceIds: string[] = [];
  let created = 0;
  let skipped = 0;

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

  const schemas = await loadFormSchemas(
    db,
    toCreate.map((e) => e.formId)
  );

  await db.transaction(async (tx) => {
    for (const entry of toCreate) {
      const schema = schemas.get(entry.formId);
      if (!schema) {
        skipped++;
        continue;
      }

      const signatures: Record<string, string> = {};
      for (const name of schema.signatures) signatures[name] = "";

      const schemaVersion = entry.schemaVersion || schema.schemaVersion || 1;
      const inst: OkoFormInstance = {
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
        rows: buildInitialRows(schema),
        signatures,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };

      await saveInstanceCells(tx, inst);
      instanceIds.push(inst.instanceId);
      created++;
    }
  });

  return { created, skipped, total: formSet.length, instanceIds };
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

  if (!name) {
    const err = new Error("Укажите квартал и год отчётного периода");
    (err as Error & { status: number }).status = 400;
    throw err;
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
  formIds: string[]
): Promise<PackageConstructRowResult> {
  const preview = await previewOneConstructTarget(db, zid, input, formIds);
  if (preview.status === "error") return preview;

  const packageKind = input.period.packageKind === "BALANCE" ? "BALANCE" : "OKO";
  let eid = preview.eid;
  let periodCreated = false;

  try {
    if (eid == null) {
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
      await replacePeriodFormSet(db, eid, formIds);
    } else if (periodCreated) {
      // createPeriod already snapshots full catalog
    } else {
      // reuse existing: ensure set covers selected forms (full catalog mode keeps existing set)
      await ensurePeriodFormSet(db, eid);
    }

    let formsCreated = 0;
    let formsSkipped = 0;
    if (input.options?.createInstances !== false) {
      const pkg = await createReportPackage(db, zid, eid);
      formsCreated = pkg.created;
      formsSkipped = pkg.skipped;
    }

    return {
      zid,
      organizationName: preview.organizationName,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "created",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated,
      formsSkipped,
      warnings: preview.warnings,
    };
  } catch (e) {
    return {
      zid,
      organizationName: preview.organizationName,
      eid,
      periodName: constructPeriodLabel(input.period),
      status: "error",
      periodCreated,
      formsTotal: formIds.length,
      formsCreated: 0,
      formsSkipped: 0,
      warnings: preview.warnings,
      error: e instanceof Error ? e.message : "Ошибка создания комплекта",
    };
  }
}

export async function constructPackages(
  db: OkoDb,
  raw: PackageConstructInput
): Promise<PackageConstructResult> {
  const input = normalizeConstructInput(raw);
  const formIds = await resolveConstructFormIds(db, input.forms);
  const continueOnError = input.options?.continueOnError !== false;
  const rows: PackageConstructRowResult[] = [];

  for (const t of input.targets) {
    const row = await constructOnePackage(db, t.zid, input, formIds);
    rows.push(row);
    if (row.status === "error" && !continueOnError) break;
  }

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
      await touchPackageImported(db, targetZid, targetEid);
    } catch {
      /* exchange mark is best-effort */
    }
  }

  return result;
}
