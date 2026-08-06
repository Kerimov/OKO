import type { OkoDb } from "../oko-db.js";
import type { Migration } from "./types.js";

export const backgroundJobsMigration: Migration = {
  id: "011_background_jobs",
  description: "In-process background job queue for long package operations",
  async up(db: OkoDb) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        error_message TEXT,
        error_stack TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_background_jobs_status
        ON background_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_background_jobs_type
        ON background_jobs(type, created_at DESC);
    `);
  },
};
