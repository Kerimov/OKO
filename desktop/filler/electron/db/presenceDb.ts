import type { PackageDatabase } from "./sqliteDb.js";

export interface CellPresence {
  instanceId: string;
  rowNo: number;
  columnKey: string;
  userName: string;
  machineName: string | null;
  clientId: string;
  heartbeatAt: string;
}

export interface ClaimCellResult {
  ok: boolean;
  occupiedBy?: string;
}

function staleCutoff(staleSec: number): string {
  return new Date(Date.now() - staleSec * 1000).toISOString();
}

/** Remove presence rows older than staleSec (housekeeping). */
export function pruneStalePresence(db: PackageDatabase, staleSec: number): void {
  const cutoff = staleCutoff(staleSec);
  db.prepare("DELETE FROM cell_presence WHERE heartbeat_at < ?").run(cutoff);
}

export function releaseClientPresence(db: PackageDatabase, clientId: string): void {
  db.prepare("DELETE FROM cell_presence WHERE client_id = ?").run(clientId);
}

export function claimCellPresence(
  db: PackageDatabase,
  params: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
    userName: string;
    machineName: string;
    clientId: string;
    staleSec: number;
  }
): ClaimCellResult {
  const now = new Date().toISOString();
  const cutoff = staleCutoff(params.staleSec);

  return db.transaction(() => {
    db.prepare("DELETE FROM cell_presence WHERE client_id = ?").run(params.clientId);

    const occupied = db
      .prepare(
        `SELECT user_name FROM cell_presence
         WHERE instance_id = ? AND row_no = ? AND column_key = ?
           AND client_id != ? AND heartbeat_at >= ?`
      )
      .get(
        params.instanceId,
        params.rowNo,
        params.columnKey,
        params.clientId,
        cutoff
      ) as { user_name: string } | undefined;

    if (occupied) {
      return { ok: false, occupiedBy: occupied.user_name };
    }

    db.prepare(
      `INSERT OR REPLACE INTO cell_presence (
        instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.instanceId,
      params.rowNo,
      params.columnKey,
      params.userName,
      params.machineName,
      params.clientId,
      now
    );

    return { ok: true };
  });
}

export function heartbeatPresence(
  db: PackageDatabase,
  params: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
    clientId: string;
  }
): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE cell_presence SET heartbeat_at = ?
       WHERE client_id = ? AND instance_id = ? AND row_no = ? AND column_key = ?`
    )
    .run(now, params.clientId, params.instanceId, params.rowNo, params.columnKey);
  return result.changes > 0;
}

export function listInstancePresence(
  db: PackageDatabase,
  instanceId: string,
  excludeClientId: string,
  staleSec: number
): CellPresence[] {
  const cutoff = staleCutoff(staleSec);
  const rows = db
    .prepare(
      `SELECT instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at
       FROM cell_presence
       WHERE instance_id = ? AND client_id != ? AND heartbeat_at >= ?`
    )
    .all(instanceId, excludeClientId, cutoff) as Array<{
    instance_id: string;
    row_no: number;
    column_key: string;
    user_name: string;
    machine_name: string | null;
    client_id: string;
    heartbeat_at: string;
  }>;

  return rows.map((r) => ({
    instanceId: r.instance_id,
    rowNo: r.row_no,
    columnKey: r.column_key,
    userName: r.user_name,
    machineName: r.machine_name,
    clientId: r.client_id,
    heartbeatAt: r.heartbeat_at,
  }));
}

/** Active editors per instance (for package sidebar). */
export function listPackageEditors(
  db: PackageDatabase,
  staleSec: number
): Map<string, string[]> {
  const cutoff = staleCutoff(staleSec);
  const rows = db
    .prepare(
      `SELECT DISTINCT instance_id, user_name FROM cell_presence
       WHERE heartbeat_at >= ?`
    )
    .all(cutoff) as Array<{ instance_id: string; user_name: string }>;

  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.instance_id) ?? [];
    if (!list.includes(r.user_name)) list.push(r.user_name);
    map.set(r.instance_id, list);
  }
  return map;
}

export function forceUnlockCell(
  db: PackageDatabase,
  params: {
    instanceId: string;
    rowNo?: number;
    columnKey?: string;
    actor: string;
  }
): number {
  let sql = "DELETE FROM cell_presence WHERE instance_id = ?";
  const args: (string | number)[] = [params.instanceId];
  if (params.rowNo != null && params.columnKey != null) {
    sql += " AND row_no = ? AND column_key = ?";
    args.push(params.rowNo, params.columnKey);
  }
  const result = db.prepare(sql).run(...args);
  if (result.changes > 0) {
    db.prepare(
      `INSERT INTO local_audit (action, instance_id, row_no, column_key, actor, details, created_at)
       VALUES ('presence_force_unlock', ?, ?, ?, ?, ?, ?)`
    ).run(
      params.instanceId,
      params.rowNo ?? null,
      params.columnKey ?? null,
      params.actor,
      null,
      new Date().toISOString()
    );
  }
  return result.changes;
}
