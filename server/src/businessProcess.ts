import type { OkoDb } from "./oko-db.js";
import {
  assertPermission,
  hasPermission,
  resolvePsdRole,
  type PsdRole,
} from "./psdRoles.js";
import {
  bpIdFor,
  canTransitionBp,
  isBpLocked,
  normalizeBpStatus,
  normalizePackageKind,
  type BpEventDto,
  type BpStatus,
  type BusinessProcessDto,
  type PackageKind,
} from "./businessProcessTypes.js";
import {
  formatApprovalBlockersMessage,
  getApprovalBlockers,
} from "./checkJournal.js";

type BpRow = {
  id: string;
  eid: number;
  zid: number;
  package_kind: string;
  status: string;
  curator_user_id: number | null;
  deadline_at: string | null;
  iteration: number;
  note: string | null;
  last_changed_at: string | null;
  last_changed_by: string | null;
  created_at: string;
  org_name?: string | null;
  period_name?: string | null;
  curator_name?: string | null;
};

function rowToDto(row: BpRow): BusinessProcessDto {
  return {
    id: row.id,
    eid: Number(row.eid),
    zid: Number(row.zid),
    packageKind: normalizePackageKind(row.package_kind),
    status: normalizeBpStatus(row.status),
    curatorUserId: row.curator_user_id == null ? null : Number(row.curator_user_id),
    deadlineAt: row.deadline_at,
    iteration: Number(row.iteration ?? 0),
    note: row.note,
    lastChangedAt: row.last_changed_at,
    lastChangedBy: row.last_changed_by,
    createdAt: row.created_at,
    organizationName: row.org_name ?? null,
    periodName: row.period_name ?? null,
    curatorName: row.curator_name ?? null,
  };
}

export async function ensureBusinessProcess(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind: PackageKind = "OKO"
): Promise<BusinessProcessDto> {
  const id = bpIdFor(zid, eid, packageKind);
  const existing = await getBusinessProcess(db, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO business_processes (
         id, eid, zid, package_kind, status, iteration, created_at, last_changed_at
       ) VALUES (?, ?, ?, ?, 'not_started', 0, ?, ?)
       ON CONFLICT (eid, zid, package_kind) DO NOTHING`
    )
    .run(id, eid, zid, packageKind, now, now);
  return (await getBusinessProcess(db, id))!;
}

export async function getBusinessProcess(
  db: OkoDb,
  id: string
): Promise<BusinessProcessDto | null> {
  const row = (await db
    .prepare(
      `SELECT bp.*, o.name AS org_name, p.name AS period_name, u.display_name AS curator_name
       FROM business_processes bp
       LEFT JOIN organizations o ON o.zid = bp.zid
       LEFT JOIN periods p ON p.eid = bp.eid
       LEFT JOIN users u ON u.id = bp.curator_user_id
       WHERE bp.id = ?`
    )
    .get(id)) as BpRow | undefined;
  return row ? rowToDto(row) : null;
}

export async function getBusinessProcessByKey(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind: PackageKind = "OKO"
): Promise<BusinessProcessDto | null> {
  return getBusinessProcess(db, bpIdFor(zid, eid, packageKind));
}

export interface ListBpFilter {
  eid?: number;
  zid?: number;
  status?: BpStatus;
  packageKind?: PackageKind;
  curatorUserId?: number;
}

export async function listBusinessProcesses(
  db: OkoDb,
  filter: ListBpFilter = {}
): Promise<BusinessProcessDto[]> {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filter.eid != null) {
    where.push("bp.eid = ?");
    params.push(filter.eid);
  }
  if (filter.zid != null) {
    where.push("bp.zid = ?");
    params.push(filter.zid);
  }
  if (filter.status) {
    where.push("bp.status = ?");
    params.push(filter.status);
  }
  if (filter.packageKind) {
    where.push("bp.package_kind = ?");
    params.push(filter.packageKind);
  }
  if (filter.curatorUserId != null) {
    where.push("bp.curator_user_id = ?");
    params.push(filter.curatorUserId);
  }
  const rows = (await db
    .prepare(
      `SELECT bp.*, o.name AS org_name, p.name AS period_name, u.display_name AS curator_name
       FROM business_processes bp
       LEFT JOIN organizations o ON o.zid = bp.zid
       LEFT JOIN periods p ON p.eid = bp.eid
       LEFT JOIN users u ON u.id = bp.curator_user_id
       WHERE ${where.join(" AND ")}
       ORDER BY bp.eid DESC, bp.zid, bp.package_kind`
    )
    .all(...params)) as BpRow[];
  return rows.map(rowToDto);
}

async function appendEvent(
  db: OkoDb,
  bpId: string,
  fromStatus: string | null,
  toStatus: string,
  actor: string | null,
  note: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO business_process_events (bp_id, from_status, to_status, actor, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(bpId, fromStatus, toStatus, actor, note, new Date().toISOString());
}

export async function listBpEvents(db: OkoDb, bpId: string): Promise<BpEventDto[]> {
  const rows = (await db
    .prepare(
      `SELECT id, bp_id, from_status, to_status, actor, note, created_at
       FROM business_process_events
       WHERE bp_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(bpId)) as Array<{
    id: number;
    bp_id: string;
    from_status: string | null;
    to_status: string;
    actor: string | null;
    note: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    bpId: r.bp_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actor: r.actor,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export type BpAction =
  | "start"
  | "submit_for_approval"
  | "curator_approve"
  | "curator_return"
  | "complete"
  | "reopen";

const ACTION_TARGET: Record<BpAction, BpStatus> = {
  start: "collecting",
  submit_for_approval: "pending_curator_approval",
  curator_approve: "curator_approved",
  curator_return: "collecting",
  complete: "completed",
  reopen: "collecting",
};

const ACTION_PERMISSION = {
  start: "bp.start",
  submit_for_approval: "bp.submit_for_approval",
  curator_approve: "bp.curator_approve",
  curator_return: "bp.curator_return",
  complete: "bp.complete",
  reopen: "bp.reopen",
} as const;

export async function transitionBusinessProcess(
  db: OkoDb,
  input: {
    id: string;
    action: BpAction;
    actor: string;
    psdRole: PsdRole;
    note?: string | null;
  }
): Promise<BusinessProcessDto> {
  const perm = ACTION_PERMISSION[input.action];
  assertPermission(input.psdRole, perm);

  const current = await getBusinessProcess(db, input.id);
  if (!current) {
    const err = new Error("Business process not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  const to = ACTION_TARGET[input.action];
  if (!canTransitionBp(current.status, to)) {
    const err = new Error(
      `Invalid BP transition ${current.status} → ${to} (action ${input.action})`
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  if (input.action === "submit_for_approval" || input.action === "curator_approve") {
    const blockers = await getApprovalBlockers(
      db,
      current.zid,
      current.eid,
      current.packageKind
    );
    if (blockers.blocked) {
      const err = new Error(formatApprovalBlockersMessage(blockers.missingExplanations));
      (err as Error & {
        status: number;
        missingExplanations: typeof blockers.missingExplanations;
      }).status = 409;
      (
        err as Error & {
          missingExplanations: typeof blockers.missingExplanations;
        }
      ).missingExplanations = blockers.missingExplanations;
      throw err;
    }
  }

  if (input.action === "curator_approve" || input.action === "curator_return") {
    // curator must be assigned for approve path (optional soft check)
  }

  const now = new Date().toISOString();
  const iteration =
    input.action === "submit_for_approval" || input.action === "reopen"
      ? current.iteration + (input.action === "submit_for_approval" ? 1 : 0)
      : current.iteration;

  await db
    .prepare(
      `UPDATE business_processes
       SET status = ?, iteration = ?, note = COALESCE(?, note),
           last_changed_at = ?, last_changed_by = ?
       WHERE id = ?`
    )
    .run(to, iteration, input.note ?? null, now, input.actor, input.id);

  await appendEvent(db, input.id, current.status, to, input.actor, input.note ?? null);
  return (await getBusinessProcess(db, input.id))!;
}

export async function assignBpCurator(
  db: OkoDb,
  input: {
    id: string;
    curatorUserId: number | null;
    actor: string;
    psdRole: PsdRole;
    deadlineAt?: string | null;
  }
): Promise<BusinessProcessDto> {
  assertPermission(input.psdRole, "bp.assign_curator");
  const current = await getBusinessProcess(db, input.id);
  if (!current) {
    const err = new Error("Business process not found");
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  if (isBpLocked(current.status)) {
    const err = new Error("Business process is completed and locked");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE business_processes
       SET curator_user_id = ?, deadline_at = COALESCE(?, deadline_at),
           last_changed_at = ?, last_changed_by = ?
       WHERE id = ?`
    )
    .run(
      input.curatorUserId,
      input.deadlineAt ?? null,
      now,
      input.actor,
      input.id
    );
  await appendEvent(
    db,
    input.id,
    current.status,
    current.status,
    input.actor,
    `curator=${input.curatorUserId ?? "null"}`
  );
  return (await getBusinessProcess(db, input.id))!;
}

export async function assertFormsWritableForBp(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind: PackageKind = "OKO"
): Promise<void> {
  const bp = await ensureBusinessProcess(db, zid, eid, packageKind);
  if (isBpLocked(bp.status)) {
    const err = new Error("Package data is locked: business process completed");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
  if (bp.status === "not_started") {
    const err = new Error("start BP first");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
}

export async function assertNsiWritableForAnyOpenBp(
  db: OkoDb,
  actorRole: PsdRole
): Promise<void> {
  if (hasPermission(actorRole, "tech.configure")) return;
  // Soft policy: completed BPs do not globally freeze NSI; per-period freeze is on forms.
  void db;
}

export function actorPsdRoleFromRequest(user: {
  role?: string | null;
  psdRole?: string | null;
  psd_role?: string | null;
} | null | undefined): PsdRole {
  return resolvePsdRole({
    legacyRole: user?.role,
    psdRole: user?.psdRole ?? user?.psd_role,
  });
}
