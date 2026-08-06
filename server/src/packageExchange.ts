import type { OkoDb } from "./oko-db.js";

export interface PackageExchangeRow {
  zid: number;
  eid: number;
  lastExportedAt: string | null;
  lastImportedAt: string | null;
  /** Number of successful imports for this org/period (1 = first load). */
  importVersion: number;
}

export async function migratePackageExchange(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS package_exchange (
      zid INTEGER NOT NULL,
      eid INTEGER NOT NULL,
      last_exported_at TEXT,
      last_imported_at TEXT,
      import_version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (zid, eid)
    );
  `);
  if (!(await db.columnExists("package_exchange", "import_version"))) {
    await db.exec(
      `ALTER TABLE package_exchange ADD COLUMN import_version INTEGER NOT NULL DEFAULT 0`
    );
  }
  // Rows that already had an import before versioning → count as v1
  await db.exec(`
    UPDATE package_exchange
       SET import_version = 1
     WHERE last_imported_at IS NOT NULL
       AND (import_version IS NULL OR import_version = 0)
  `);
}

export async function touchPackageExported(
  db: OkoDb,
  zid: number,
  eid: number,
  at: string = new Date().toISOString()
): Promise<void> {
  await migratePackageExchange(db);
  await db
    .prepare(
      `INSERT INTO package_exchange (zid, eid, last_exported_at, last_imported_at, import_version)
       VALUES (?, ?, ?, NULL, 0)
       ON CONFLICT(zid, eid) DO UPDATE SET last_exported_at = excluded.last_exported_at`
    )
    .run(zid, eid, at);
}

export async function touchPackageImported(
  db: OkoDb,
  zid: number,
  eid: number,
  at: string = new Date().toISOString()
): Promise<void> {
  await migratePackageExchange(db);
  await db
    .prepare(
      `INSERT INTO package_exchange (zid, eid, last_exported_at, last_imported_at, import_version)
       VALUES (?, ?, NULL, ?, 1)
       ON CONFLICT(zid, eid) DO UPDATE SET
         last_imported_at = excluded.last_imported_at,
         import_version = COALESCE(package_exchange.import_version, 0) + 1`
    )
    .run(zid, eid, at);
}

export async function listPackageExchange(
  db: OkoDb,
  opts?: { zid?: number }
): Promise<Map<string, PackageExchangeRow>> {
  await migratePackageExchange(db);
  let sql = `SELECT zid, eid, last_exported_at, last_imported_at, import_version FROM package_exchange`;
  const params: unknown[] = [];
  if (opts?.zid != null) {
    sql += ` WHERE zid = ?`;
    params.push(opts.zid);
  }
  const rows = (await db.prepare(sql).all(...params)) as Array<{
    zid: number;
    eid: number;
    last_exported_at: string | null;
    last_imported_at: string | null;
    import_version: number | null;
  }>;
  const map = new Map<string, PackageExchangeRow>();
  for (const r of rows) {
    const imported = r.last_imported_at != null;
    let importVersion = Number(r.import_version ?? 0);
    if (imported && importVersion <= 0) importVersion = 1;
    map.set(`${Number(r.zid)}:${Number(r.eid)}`, {
      zid: Number(r.zid),
      eid: Number(r.eid),
      lastExportedAt: r.last_exported_at,
      lastImportedAt: r.last_imported_at,
      importVersion,
    });
  }
  return map;
}
