import { createHash, randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { importReportPackage, type ImportPackageResult, type ReportPackageInput } from "./packages.js";
import { assertPackageSubmittedChecks } from "./instance-submit.js";
import { listInstanceSummaries, loadInstance } from "./instances.js";
import { buildPackageDiff, type PackageDiffRow } from "./packageDiff.js";
import type { OkoFormInstance } from "./types.js";

export type InboxStatus =
  | "received"
  | "validated"
  | "rejected"
  | "accepted"
  | "expired";

export interface PackageInboxRow {
  id: string;
  receivedAt: string;
  actor: string | null;
  filename: string | null;
  sha256: string;
  status: InboxStatus;
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

export interface PackageInboxDetail extends PackageInboxRow {
  packageJson: ReportPackageInput & {
    version?: string;
    exportedAt?: string;
    zid?: number | null;
    eid?: number | null;
    rules?: unknown;
  };
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function migratePackageInbox(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS package_inbox (
      id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL,
      actor TEXT,
      filename TEXT,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      pkg_zid INTEGER,
      pkg_eid INTEGER,
      organization TEXT,
      period_start TEXT,
      period_end TEXT,
      target_zid INTEGER,
      target_eid INTEGER,
      validation_errors TEXT NOT NULL DEFAULT '[]',
      warnings TEXT NOT NULL DEFAULT '[]',
      instance_count INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT,
      rejected_reason TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_package_inbox_status ON package_inbox(status, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_package_inbox_sha ON package_inbox(sha256);
  `);
}

function rowToDto(row: {
  id: string;
  received_at: string;
  actor: string | null;
  filename: string | null;
  sha256: string;
  status: string;
  pkg_zid: number | null;
  pkg_eid: number | null;
  organization: string | null;
  period_start: string | null;
  period_end: string | null;
  target_zid: number | null;
  target_eid: number | null;
  validation_errors: string;
  warnings: string;
  instance_count: number;
  accepted_at: string | null;
  rejected_reason: string | null;
}): PackageInboxRow {
  let validationErrors: string[] = [];
  let warnings: string[] = [];
  try {
    validationErrors = JSON.parse(row.validation_errors || "[]") as string[];
  } catch {
    /* ignore */
  }
  try {
    warnings = JSON.parse(row.warnings || "[]") as string[];
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    receivedAt: row.received_at,
    actor: row.actor,
    filename: row.filename,
    sha256: row.sha256,
    status: row.status as InboxStatus,
    pkgZid: row.pkg_zid,
    pkgEid: row.pkg_eid,
    organization: row.organization,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetZid: row.target_zid,
    targetEid: row.target_eid,
    validationErrors,
    warnings,
    instanceCount: row.instance_count,
    acceptedAt: row.accepted_at,
    rejectedReason: row.rejected_reason,
  };
}

function parsePayload(text: string): ReportPackageInput & {
  version?: string;
  exportedAt?: string;
  zid?: number | null;
  eid?: number | null;
  rules?: unknown;
} {
  const pkg = JSON.parse(text) as ReportPackageInput & {
    version?: string;
    exportedAt?: string;
    zid?: number | null;
    eid?: number | null;
    rules?: unknown;
    instances?: OkoFormInstance[];
  };
  if (!Array.isArray(pkg.instances) || pkg.instances.length === 0) {
    throw new Error("package.instances required");
  }
  for (const inst of pkg.instances) {
    if (!inst?.templateId || !inst.meta || !Array.isArray(inst.rows)) {
      throw new Error("each instance needs templateId, meta, rows");
    }
  }
  return pkg;
}

export async function validateAgainstTarget(
  db: OkoDb,
  pkg: {
    zid?: number | null;
    eid?: number | null;
    organization?: string;
    periodStart?: string;
    periodEnd?: string;
  },
  targetZid: number | null,
  targetEid: number | null
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (targetZid != null) {
    const org = (await db
      .prepare("SELECT name FROM organizations WHERE zid = ?")
      .get(targetZid)) as { name: string } | undefined;
    if (!org) errors.push(`Целевая организация ${targetZid} не найдена`);
    if (pkg.zid != null && pkg.zid !== targetZid) {
      warnings.push(
        `ZID в файле (${pkg.zid}) ≠ целевого комплекта (${targetZid}) — будет переназначен`
      );
    }
  }
  if (targetEid != null) {
    const period = (await db
      .prepare("SELECT name, period_start, period_end FROM periods WHERE eid = ?")
      .get(targetEid)) as
      | { name: string; period_start: string | null; period_end: string | null }
      | undefined;
    if (!period) errors.push(`Целевой период ${targetEid} не найден`);
    else {
      if (pkg.eid != null && pkg.eid !== targetEid) {
        warnings.push(
          `EID в файле (${pkg.eid}) ≠ целевого периода (${targetEid}) — будет переназначен`
        );
      }
      if (
        pkg.periodStart &&
        period.period_start &&
        pkg.periodStart !== String(period.period_start).slice(0, 10)
      ) {
        warnings.push(
          `Дата начала в файле (${pkg.periodStart}) ≠ периода БД (${period.period_start})`
        );
      }
      if (
        pkg.periodEnd &&
        period.period_end &&
        pkg.periodEnd !== String(period.period_end).slice(0, 10)
      ) {
        warnings.push(
          `Дата окончания в файле (${pkg.periodEnd}) ≠ периода БД (${period.period_end})`
        );
      }
    }
  }
  return { errors, warnings };
}

export async function receivePackageInbox(
  db: OkoDb,
  input: {
    rawJson: string;
    filename?: string | null;
    actor?: string | null;
    targetZid?: number | null;
    targetEid?: number | null;
  }
): Promise<PackageInboxRow> {
  const sha256 = digest(input.rawJson);
  const dup = (await db
    .prepare(
      `SELECT id FROM package_inbox
       WHERE sha256 = ? AND status IN ('received','validated','accepted')
       ORDER BY received_at DESC LIMIT 1`
    )
    .get(sha256)) as { id: string } | undefined;

  const pkg = parsePayload(input.rawJson);
  const targetZid = input.targetZid ?? null;
  const targetEid = input.targetEid ?? null;
  const { errors, warnings } = await validateAgainstTarget(db, pkg, targetZid, targetEid);
  if (dup) {
    warnings.unshift(`Возможный дубликат: уже есть inbox ${dup.id} с тем же SHA-256`);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const status: InboxStatus = errors.length ? "received" : "validated";

  await db
    .prepare(
      `INSERT INTO package_inbox (
        id, received_at, actor, filename, sha256, status,
        pkg_zid, pkg_eid, organization, period_start, period_end,
        target_zid, target_eid, validation_errors, warnings, instance_count, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      now,
      input.actor ?? null,
      input.filename ?? null,
      sha256,
      status,
      pkg.zid ?? null,
      pkg.eid ?? null,
      pkg.organization ?? null,
      pkg.periodStart ?? null,
      pkg.periodEnd ?? null,
      targetZid,
      targetEid,
      JSON.stringify(errors),
      JSON.stringify(warnings),
      pkg.instances.length,
      input.rawJson
    );

  return (await getPackageInbox(db, id))!;
}

export async function listPackageInbox(
  db: OkoDb,
  status?: InboxStatus
): Promise<PackageInboxRow[]> {
  const rows = status
    ? ((await db
        .prepare(
          `SELECT id, received_at, actor, filename, sha256, status,
                  pkg_zid, pkg_eid, organization, period_start, period_end,
                  target_zid, target_eid, validation_errors, warnings,
                  instance_count, accepted_at, rejected_reason
           FROM package_inbox WHERE status = ? ORDER BY received_at DESC LIMIT 200`
        )
        .all(status)) as Array<Parameters<typeof rowToDto>[0]>)
    : ((await db
        .prepare(
          `SELECT id, received_at, actor, filename, sha256, status,
                  pkg_zid, pkg_eid, organization, period_start, period_end,
                  target_zid, target_eid, validation_errors, warnings,
                  instance_count, accepted_at, rejected_reason
           FROM package_inbox ORDER BY received_at DESC LIMIT 200`
        )
        .all()) as Array<Parameters<typeof rowToDto>[0]>);
  return rows.map(rowToDto);
}

export async function getPackageInbox(
  db: OkoDb,
  id: string
): Promise<PackageInboxRow | null> {
  const row = (await db
    .prepare(
      `SELECT id, received_at, actor, filename, sha256, status,
              pkg_zid, pkg_eid, organization, period_start, period_end,
              target_zid, target_eid, validation_errors, warnings,
              instance_count, accepted_at, rejected_reason
       FROM package_inbox WHERE id = ?`
    )
    .get(id)) as Parameters<typeof rowToDto>[0] | undefined;
  return row ? rowToDto(row) : null;
}

export async function getPackageInboxDetail(
  db: OkoDb,
  id: string
): Promise<PackageInboxDetail | null> {
  const row = (await db
    .prepare(
      `SELECT id, received_at, actor, filename, sha256, status,
              pkg_zid, pkg_eid, organization, period_start, period_end,
              target_zid, target_eid, validation_errors, warnings,
              instance_count, accepted_at, rejected_reason, payload
       FROM package_inbox WHERE id = ?`
    )
    .get(id)) as
    | (Parameters<typeof rowToDto>[0] & { payload: string })
    | undefined;
  if (!row) return null;
  return {
    ...rowToDto(row),
    packageJson: parsePayload(row.payload),
  };
}

export async function rejectPackageInbox(
  db: OkoDb,
  id: string,
  reason?: string | null
): Promise<PackageInboxRow | null> {
  const r = await db
    .prepare(
      `UPDATE package_inbox SET status = 'rejected', rejected_reason = ?
       WHERE id = ? AND status IN ('received','validated')`
    )
    .run(reason ?? null, id);
  if (!r.changes) return null;
  return getPackageInbox(db, id);
}

export async function previewPackageInbox(
  db: OkoDb,
  id: string,
  options: { zid: number; eid: number }
): Promise<{
  inbox: PackageInboxRow;
  organization: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  diff: PackageDiffRow[];
  summary: {
    new: number;
    same: number;
    changed: number;
    onlyLocal: number;
    selectedDefault: number;
  };
} | null> {
  const detail = await getPackageInboxDetail(db, id);
  if (!detail) return null;

  const summaries = await listInstanceSummaries(db, {
    zid: options.zid,
    eid: options.eid,
  });
  const local: OkoFormInstance[] = [];
  for (const s of summaries) {
    const inst = await loadInstance(db, s.instanceId);
    if (inst) local.push(inst);
  }

  const diff = buildPackageDiff(detail.packageJson.instances as OkoFormInstance[], local, {
    zid: options.zid,
    eid: options.eid,
  });
  const summary = {
    new: 0,
    same: 0,
    changed: 0,
    onlyLocal: 0,
    selectedDefault: 0,
  };
  for (const row of diff) {
    if (row.verdict === "new") summary.new++;
    else if (row.verdict === "same") summary.same++;
    else if (row.verdict === "changed") summary.changed++;
    else summary.onlyLocal++;
    if (row.selectedDefault) summary.selectedDefault++;
  }

  return {
    inbox: {
      id: detail.id,
      receivedAt: detail.receivedAt,
      actor: detail.actor,
      filename: detail.filename,
      sha256: detail.sha256,
      status: detail.status,
      pkgZid: detail.pkgZid,
      pkgEid: detail.pkgEid,
      organization: detail.organization,
      periodStart: detail.periodStart,
      periodEnd: detail.periodEnd,
      targetZid: detail.targetZid,
      targetEid: detail.targetEid,
      validationErrors: detail.validationErrors,
      warnings: detail.warnings,
      instanceCount: detail.instanceCount,
      acceptedAt: detail.acceptedAt,
      rejectedReason: detail.rejectedReason,
    },
    organization: detail.packageJson.organization ?? detail.organization,
    periodStart: detail.packageJson.periodStart ?? detail.periodStart,
    periodEnd: detail.packageJson.periodEnd ?? detail.periodEnd,
    diff,
    summary,
  };
}

export async function acceptPackageInbox(
  db: OkoDb,
  id: string,
  options: {
    zid: number;
    eid: number;
    overwrite?: boolean;
    templateIds?: string[];
    isAdmin?: boolean;
  }
): Promise<{ inbox: PackageInboxRow; result: ImportPackageResult }> {
  const detail = await getPackageInboxDetail(db, id);
  if (!detail) throw new Error("Inbox item not found");
  if (detail.status === "accepted") throw new Error("Уже принят");
  if (detail.status === "rejected") throw new Error("Отклонён");
  if (detail.validationErrors.length) {
    throw new Error(`Нельзя принять: ${detail.validationErrors.join("; ")}`);
  }

  let instances = detail.packageJson.instances as OkoFormInstance[];
  if (options.templateIds?.length) {
    const allow = new Set(options.templateIds);
    instances = instances.filter((i) => i.templateId && allow.has(i.templateId));
  }
  if (!instances.length) throw new Error("Нет форм для приёма");

  await assertPackageSubmittedChecks(db, instances);
  const result = await importReportPackage(
    db,
    options.zid,
    options.eid,
    {
      organization: detail.packageJson.organization,
      periodStart: detail.packageJson.periodStart,
      periodEnd: detail.packageJson.periodEnd,
      instances,
    },
    options.overwrite === true,
    options.templateIds
  );

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE package_inbox
       SET status = 'accepted', accepted_at = ?, target_zid = ?, target_eid = ?
       WHERE id = ?`
    )
    .run(now, options.zid, options.eid, id);

  const inbox = (await getPackageInbox(db, id))!;
  return { inbox, result };
}
