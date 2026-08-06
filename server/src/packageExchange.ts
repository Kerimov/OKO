import type { OkoDb } from "./oko-db.js";

export interface PackageExchangeRow {
  packageId: string;
  zid: number;
  eid: number;
  lastExportedAt: string | null;
  lastImportedAt: string | null;
  /** Number of successful imports for this package (1 = first load). */
  importVersion: number;
}

async function pgTableExists(db: OkoDb, name: string): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?
       LIMIT 1`
    )
    .get(name.toLowerCase())) as { ok?: number } | undefined;
  return Boolean(row);
}

/**
 * Exchange marks are keyed by package GUID (periods.package_id), not zid/eid.
 * Recreating a period after delete must not inherit previous export/import history.
 */
export async function migratePackageExchange(db: OkoDb): Promise<void> {
  const legacyName = "package_exchange__legacy_zid_eid";

  if (await pgTableExists(db, legacyName)) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS package_exchange (
        package_id TEXT PRIMARY KEY,
        zid INTEGER NOT NULL,
        eid INTEGER NOT NULL,
        last_exported_at TEXT,
        last_imported_at TEXT,
        import_version INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_package_exchange_zid_eid ON package_exchange(zid, eid)`
    );
    return;
  }

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
  await db.exec(`
    UPDATE package_exchange
       SET import_version = 1
     WHERE last_imported_at IS NOT NULL
       AND (import_version IS NULL OR import_version = 0)
  `);

  if (!(await db.columnExists("package_exchange", "package_id"))) {
    await db.exec(`ALTER TABLE package_exchange ADD COLUMN package_id TEXT`);
  }

  // If package_exchange already has package_id as PK (fresh install after schema change), skip swap.
  const pkCol = (await db
    .prepare(
      `SELECT a.attname AS col
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'package_exchange'::regclass AND i.indisprimary
       LIMIT 1`
    )
    .get()) as { col?: string } | undefined;
  if (pkCol?.col === "package_id") {
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_package_exchange_zid_eid ON package_exchange(zid, eid)`
    );
    return;
  }

  const legacyRows = (await db
    .prepare(
      `SELECT zid, eid, last_exported_at, last_imported_at, import_version, package_id
       FROM package_exchange`
    )
    .all()) as Array<{
    zid: number;
    eid: number;
    last_exported_at: string | null;
    last_imported_at: string | null;
    import_version: number | null;
    package_id: string | null;
  }>;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS package_exchange_by_guid (
      package_id TEXT PRIMARY KEY,
      zid INTEGER NOT NULL,
      eid INTEGER NOT NULL,
      last_exported_at TEXT,
      last_imported_at TEXT,
      import_version INTEGER NOT NULL DEFAULT 0
    );
  `);

  for (const r of legacyRows) {
    let packageId = r.package_id?.trim() || "";
    if (!packageId) {
      const period = (await db
        .prepare(`SELECT package_id FROM periods WHERE zid = ? AND eid = ?`)
        .get(r.zid, r.eid)) as { package_id: string | null } | undefined;
      packageId = period?.package_id?.trim() || "";
    }
    if (!packageId) continue;
    await db
      .prepare(
        `INSERT INTO package_exchange_by_guid (
           package_id, zid, eid, last_exported_at, last_imported_at, import_version
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(package_id) DO UPDATE SET
           last_exported_at = COALESCE(EXCLUDED.last_exported_at, package_exchange_by_guid.last_exported_at),
           last_imported_at = COALESCE(EXCLUDED.last_imported_at, package_exchange_by_guid.last_imported_at),
           import_version = GREATEST(
             package_exchange_by_guid.import_version,
             EXCLUDED.import_version
           )`
      )
      .run(
        packageId,
        r.zid,
        r.eid,
        r.last_exported_at,
        r.last_imported_at,
        Number(r.import_version ?? 0)
      );
  }

  await db.exec(`ALTER TABLE package_exchange RENAME TO ${legacyName}`);
  await db.exec(`ALTER TABLE package_exchange_by_guid RENAME TO package_exchange`);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_package_exchange_zid_eid ON package_exchange(zid, eid)`
  );
}

export async function touchPackageExported(
  db: OkoDb,
  packageId: string,
  zid: number,
  eid: number,
  at: string = new Date().toISOString()
): Promise<void> {
  await migratePackageExchange(db);
  if (!packageId.trim()) throw new Error("packageId required for exchange mark");
  await db
    .prepare(
      `INSERT INTO package_exchange (package_id, zid, eid, last_exported_at, last_imported_at, import_version)
       VALUES (?, ?, ?, ?, NULL, 0)
       ON CONFLICT(package_id) DO UPDATE SET
         last_exported_at = EXCLUDED.last_exported_at,
         zid = EXCLUDED.zid,
         eid = EXCLUDED.eid`
    )
    .run(packageId, zid, eid, at);
}

export async function touchPackageImported(
  db: OkoDb,
  packageId: string,
  zid: number,
  eid: number,
  at: string = new Date().toISOString()
): Promise<void> {
  await migratePackageExchange(db);
  if (!packageId.trim()) throw new Error("packageId required for exchange mark");
  await db
    .prepare(
      `INSERT INTO package_exchange (package_id, zid, eid, last_exported_at, last_imported_at, import_version)
       VALUES (?, ?, ?, NULL, ?, 1)
       ON CONFLICT(package_id) DO UPDATE SET
         last_imported_at = EXCLUDED.last_imported_at,
         import_version = COALESCE(package_exchange.import_version, 0) + 1,
         zid = EXCLUDED.zid,
         eid = EXCLUDED.eid`
    )
    .run(packageId, zid, eid, at);
}

export async function deletePackageExchange(
  db: OkoDb,
  opts: { packageId?: string; zid?: number; eid?: number }
): Promise<void> {
  await migratePackageExchange(db);
  if (opts.packageId) {
    await db
      .prepare(`DELETE FROM package_exchange WHERE package_id = ?`)
      .run(opts.packageId);
    return;
  }
  if (opts.zid != null && opts.eid != null) {
    await db
      .prepare(`DELETE FROM package_exchange WHERE zid = ? AND eid = ?`)
      .run(opts.zid, opts.eid);
  }
}

export async function listPackageExchange(
  db: OkoDb,
  opts?: { zid?: number }
): Promise<Map<string, PackageExchangeRow>> {
  await migratePackageExchange(db);
  let sql = `SELECT package_id, zid, eid, last_exported_at, last_imported_at, import_version
             FROM package_exchange`;
  const params: unknown[] = [];
  if (opts?.zid != null) {
    sql += ` WHERE zid = ?`;
    params.push(opts.zid);
  }
  const rows = (await db.prepare(sql).all(...params)) as Array<{
    package_id: string;
    zid: number;
    eid: number;
    last_exported_at: string | null;
    last_imported_at: string | null;
    import_version: number | null;
  }>;
  const map = new Map<string, PackageExchangeRow>();
  for (const r of rows) {
    if (!r.package_id) continue;
    const imported = r.last_imported_at != null;
    let importVersion = Number(r.import_version ?? 0);
    if (imported && importVersion <= 0) importVersion = 1;
    map.set(r.package_id, {
      packageId: r.package_id,
      zid: Number(r.zid),
      eid: Number(r.eid),
      lastExportedAt: r.last_exported_at,
      lastImportedAt: r.last_imported_at,
      importVersion,
    });
  }
  return map;
}
