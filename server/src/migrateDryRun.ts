import "./env.js";
import { bootstrapDatabase } from "./db.js";
import { listAppliedMigrations } from "./migrations/runner.js";
import { isPostgresMode } from "./oko-db.js";

/**
 * One-shot schema/migrate dry-run for CI / release gates.
 * Requires DATABASE_URL. Exits 0 when bootstrap + numbered migrations succeed.
 */
async function main(): Promise<void> {
  if (!isPostgresMode()) {
    console.error("DATABASE_URL required for migrate dry-run");
    process.exit(1);
  }
  const db = await bootstrapDatabase();
  const applied = await listAppliedMigrations(db);
  console.log(
    JSON.stringify(
      {
        ok: true,
        dialect: "postgresql",
        migrationsApplied: applied,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("migrate dry-run failed:", err);
  process.exit(1);
});
