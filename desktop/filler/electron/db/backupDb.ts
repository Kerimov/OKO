import fs from "node:fs";
import path from "node:path";
import type { PackageDatabase } from "./sqliteDb.js";

export function backupPackageDatabase(
  folderPath: string,
  db: PackageDatabase,
  actor: string
): string {
  const backupsDir = path.join(folderPath, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(backupsDir, `oko_${stamp}.db`);

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  fs.copyFileSync(db.path, dest);

  db.prepare(
    `INSERT INTO local_audit (action, instance_id, row_no, column_key, actor, details, created_at)
     VALUES ('backup_db', NULL, NULL, NULL, ?, ?, ?)`
  ).run(actor, dest, new Date().toISOString());

  return dest;
}
