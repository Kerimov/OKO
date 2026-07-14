import type { OkoDb } from "../oko-db.js";
import { uniquePackageTemplateMigration } from "./001_unique_package_template.js";
import type { Migration } from "./types.js";

export const NUMBERED_MIGRATIONS: Migration[] = [uniquePackageTemplateMigration];

export async function migrateSchemaMigrationsTable(db: OkoDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT
    )
  `);
}

export async function listAppliedMigrations(db: OkoDb): Promise<string[]> {
  await migrateSchemaMigrationsTable(db);
  const rows = (await db
    .prepare(`SELECT id FROM schema_migrations ORDER BY id`)
    .all()) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Apply pending numbered migrations once. Safe to call on every boot.
 */
export async function runNumberedMigrations(db: OkoDb): Promise<{
  applied: string[];
  already: string[];
}> {
  await migrateSchemaMigrationsTable(db);
  const done = new Set(await listAppliedMigrations(db));
  const applied: string[] = [];
  const already: string[] = [];

  for (const m of NUMBERED_MIGRATIONS) {
    if (done.has(m.id)) {
      already.push(m.id);
      continue;
    }
    await db.transaction(async (tx) => {
      await m.up(tx);
      await tx
        .prepare(
          `INSERT INTO schema_migrations (id, applied_at, description) VALUES (?, ?, ?)`
        )
        .run(m.id, new Date().toISOString(), m.description);
    });
    applied.push(m.id);
    console.log(`Applied migration ${m.id}: ${m.description}`);
  }

  return { applied, already };
}
