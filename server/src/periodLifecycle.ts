import type { OkoDb } from "./oko-db.js";
import { getMethodologyRelease } from "./methodology.js";

export type PeriodLifecycleStatus = "open" | "closed";

export async function migratePeriodLifecycle(db: OkoDb): Promise<void> {
  const cols: Array<[string, string]> = [
    ["period_status", "TEXT DEFAULT 'open'"],
    ["closed_at", "TEXT"],
    ["closed_by", "TEXT"],
    ["methodology_release_id", "TEXT"],
  ];
  for (const [name, ddl] of cols) {
    if (!(await db.columnExists("periods", name))) {
      await db.exec(`ALTER TABLE periods ADD COLUMN ${name} ${ddl}`);
    }
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS period_form_set (
      eid INTEGER NOT NULL,
      form_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (eid, form_id)
    );
    CREATE INDEX IF NOT EXISTS idx_period_form_set_eid ON period_form_set(eid);
  `);
}

export function normalizePeriodStatus(
  raw: string | null | undefined
): PeriodLifecycleStatus {
  return raw === "closed" ? "closed" : "open";
}

export async function getPeriodRow(
  db: OkoDb,
  eid: number,
  zid?: number
): Promise<{
  eid: number;
  zid: number;
  period_status: string | null;
  methodology_release_id: string | null;
  package_status: string | null;
} | null> {
  if (zid != null) {
    const row = (await db
      .prepare(
        `SELECT eid, zid, period_status, methodology_release_id, package_status
         FROM periods WHERE eid = ? AND zid = ?`
      )
      .get(eid, zid)) as
      | {
          eid: number;
          zid: number;
          period_status: string | null;
          methodology_release_id: string | null;
          package_status: string | null;
        }
      | undefined;
    return row ?? null;
  }
  const row = (await db
    .prepare(
      `SELECT eid, zid, period_status, methodology_release_id, package_status
       FROM periods WHERE eid = ?`
    )
    .get(eid)) as
    | {
        eid: number;
        zid: number;
        period_status: string | null;
        methodology_release_id: string | null;
        package_status: string | null;
      }
    | undefined;
  return row ?? null;
}

/** Throws 403-style Error if period is closed. */
export async function assertPeriodWritable(
  db: OkoDb,
  eid: number | null | undefined,
  zid?: number | null,
  opts?: { force?: boolean }
): Promise<void> {
  if (eid == null) return;
  if (opts?.force) return;
  const row = await getPeriodRow(db, eid, zid ?? undefined);
  if (!row) return;
  if (normalizePeriodStatus(row.period_status) === "closed") {
    const err = new Error("Period is closed and cannot be edited");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export async function assertPeriodWritableForInstance(
  db: OkoDb,
  zid: number | null | undefined,
  eid: number | null | undefined,
  opts?: { force?: boolean }
): Promise<void> {
  if (eid == null) return;
  await assertPeriodWritable(db, eid, zid, opts);
}

export async function snapshotPeriodFormSet(
  db: OkoDb,
  eid: number
): Promise<number> {
  await migratePeriodLifecycle(db);
  const forms = (await db
    .prepare(
      `SELECT form_id, COALESCE(schema_version, 1) AS schema_version
       FROM form_templates
       WHERE COALESCE(archived, 0) = 0
       ORDER BY sort_order, form_id`
    )
    .all()) as Array<{ form_id: string; schema_version: number }>;

  await db.prepare("DELETE FROM period_form_set WHERE eid = ?").run(eid);
  const ins = db.prepare(
    `INSERT INTO period_form_set (eid, form_id, schema_version) VALUES (?, ?, ?)`
  );
  for (const f of forms) {
    await ins.run(eid, f.form_id, f.schema_version);
  }
  return forms.length;
}

export async function listPeriodFormSet(
  db: OkoDb,
  eid: number
): Promise<Array<{ formId: string; schemaVersion: number }>> {
  await migratePeriodLifecycle(db);
  const rows = (await db
    .prepare(
      `SELECT form_id, schema_version FROM period_form_set WHERE eid = ? ORDER BY form_id`
    )
    .all(eid)) as Array<{ form_id: string; schema_version: number }>;
  return rows.map((r) => ({
    formId: r.form_id,
    schemaVersion: Number(r.schema_version ?? 1),
  }));
}

/** Ensure form set exists (lazy backfill for old periods). */
export async function ensurePeriodFormSet(
  db: OkoDb,
  eid: number
): Promise<Array<{ formId: string; schemaVersion: number }>> {
  const existing = await listPeriodFormSet(db, eid);
  if (existing.length > 0) return existing;
  await snapshotPeriodFormSet(db, eid);
  return listPeriodFormSet(db, eid);
}

export async function resolveActiveMethodologyId(db: OkoDb): Promise<string | null> {
  const release = await getMethodologyRelease(db);
  return release?.id ?? null;
}

export async function closePeriod(
  db: OkoDb,
  zid: number,
  eid: number,
  actor?: string | null,
  opts?: { requireAccepted?: boolean }
): Promise<{
  eid: number;
  zid: number;
  periodStatus: PeriodLifecycleStatus;
  closedAt: string;
  closedBy: string | null;
}> {
  const row = await getPeriodRow(db, eid, zid);
  if (!row) throw new Error("Period not found");
  if (normalizePeriodStatus(row.period_status) === "closed") {
    throw new Error("Period is already closed");
  }
  if (opts?.requireAccepted !== false && row.package_status !== "accepted") {
    throw new Error("Period can only be closed when package status is accepted");
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE periods
       SET period_status = 'closed', closed_at = ?, closed_by = ?
       WHERE zid = ? AND eid = ?`
    )
    .run(now, actor ?? null, zid, eid);
  return {
    eid,
    zid,
    periodStatus: "closed",
    closedAt: now,
    closedBy: actor ?? null,
  };
}

export async function reopenPeriod(
  db: OkoDb,
  zid: number,
  eid: number,
  actor?: string | null
): Promise<{
  eid: number;
  zid: number;
  periodStatus: PeriodLifecycleStatus;
  reopenedBy: string | null;
}> {
  const row = await getPeriodRow(db, eid, zid);
  if (!row) throw new Error("Period not found");
  if (normalizePeriodStatus(row.period_status) !== "closed") {
    throw new Error("Period is not closed");
  }
  await db
    .prepare(
      `UPDATE periods
       SET period_status = 'open', closed_at = NULL, closed_by = NULL
       WHERE zid = ? AND eid = ?`
    )
    .run(zid, eid);
  void actor;
  return {
    eid,
    zid,
    periodStatus: "open",
    reopenedBy: actor ?? null,
  };
}

export async function listChildOrganizations(
  db: OkoDb,
  parentZid: number
): Promise<Array<{ zid: number; name: string }>> {
  const rows = (await db
    .prepare(
      `SELECT zid, name FROM organizations WHERE parent_zid = ? ORDER BY name`
    )
    .all(parentZid)) as Array<{ zid: number; name: string }>;
  return rows;
}
