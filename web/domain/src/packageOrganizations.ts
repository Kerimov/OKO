import type { OkoDb } from "./oko-db.js";
import { dateOrNull } from "./dbValues.js";
import {
  assertPeriodWritable,
  ensurePeriodFormSet,
  listActiveFormTemplates,
  normalizePeriodStatus,
  resolveActiveMethodologyId,
  snapshotPeriodFormSet,
  snapshotPeriodFormSetWithForms,
} from "./periodLifecycle.js";
import { withTiming } from "./perf.js";
import {
  canTransitionPackageStatus,
  newPackageGuid,
  normalizePackageWorkflowStatus,
  packageIdFor,
  type ListOrganizationsOpts,
  type OrganizationDto,
  type PackageCampaignSummary,
  type PackageContext,
  type PackageWorkflowDto,
  type PackageWorkflowStatus,
  type PeriodDto,
  type WorkContextDto,
} from "./packageTypes.js";


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

export async function loadPackageWorkflow(
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
  _db: OkoDb,
  _zid: number,
  _eid: number,
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
}

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

export function quarterDateRange(
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

export function quarterPeriodName(quarter: number, year: number): string {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  return `${q} квартал ${Math.trunc(year)}`;
}
