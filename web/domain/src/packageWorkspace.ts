import type { OkoDb } from "./oko-db.js";
import { dateOrNull } from "./dbValues.js";
import { exportCatalog } from "./forms.js";
import {
  ensurePeriodFormSet,
  listChildOrganizations,
  normalizePeriodStatus,
} from "./periodLifecycle.js";
import { withTiming } from "./perf.js";
import { loadPackageWorkflow } from "./packageOrganizations.js";
import {
  newPackageGuid,
  normalizePackageWorkflowStatus,
  packageIdFor,
  type PackageCompletenessDto,
  type PackageCompletenessItem,
  type PackageDashboardRow,
  type PackageWorkspaceDetail,
  type PackageWorkspaceOpts,
  type PackageWorkspaceRow,
} from "./packageTypes.js";

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
