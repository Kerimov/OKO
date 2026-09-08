/**
 * Import TZ Excel appendices into PSD registries (transfers / minfin / svods).
 *
 * Usage (DATABASE_URL required):
 *   npm run import:tz --prefix server
 */
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { ROOT } from "../paths.js";
import { getDb } from "../db.js";
import { importTz, importTzCompanion } from "./tzImport/importers.js";

async function main(): Promise<void> {
  const db = await getDb();
  const apply = process.argv.includes("--apply");
  if (!apply && !process.argv.includes("--preview")) throw new Error("use --preview or --apply");
  const tzDir = path.join(ROOT, "TZ");
  const reports: unknown[] = [];
  const big = path.join(tzDir, "Приложение 1-10,14-16,18.xlsx");
  if (!fs.existsSync(big)) throw new Error(`Missing ${big}`);
  const batchId = randomUUID();
  if (apply) await db.prepare(`INSERT INTO import_batches (id,source,mode,status,created_at) VALUES (?,?,'apply','running',?)`).run(batchId,big,new Date().toISOString());
  const preview = await importTz(db,big,apply);
  reports.push(preview);
  for (const name of ["Приложение 19_Реестр сводов форм.xlsx", "Приложение 17_Детализация показателей.xlsx", "Приложение 3.1_Карточка контрагента.xlsx"]) {
    const file = path.join(tzDir, name);
    if (fs.existsSync(file)) reports.push(await importTzCompanion(db, file, apply));
  }
  if (apply) await db.prepare(`UPDATE import_batches SET status='completed',summary_json=?,reject_json=?,completed_at=? WHERE id=?`)
    .run(JSON.stringify(preview.byKind),JSON.stringify(preview.rejects),new Date().toISOString(),batchId);
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", batchId: apply ? batchId : null, reports }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
