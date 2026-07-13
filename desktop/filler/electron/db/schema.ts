import fs from "node:fs";
import type { PackageDatabase } from "./sqliteDb.js";

export const SCHEMA_VERSION = 1;

export interface PackageMeta {
  formatVersion: number;
  zid: number;
  eid: number;
  organization: string;
  periodStart: string;
  periodEnd: string;
  enterpriseCode: string;
  createdAt: string;
  coordinatorPinHash?: string;
  settings?: {
    heartbeatIntervalSec?: number;
    presenceStaleSec?: number;
    syncPollIntervalSec?: number;
    restrictExecutorsToAssignments?: boolean;
  };
}

export function migrateDb(db: PackageDatabase): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS form_instances (
      instance_id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      zid INTEGER,
      eid INTEGER,
      display_name TEXT NOT NULL,
      organization TEXT,
      period_start TEXT,
      period_end TEXT,
      unit TEXT DEFAULT 'тыс.руб.',
      status TEXT DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      template_title TEXT,
      enterprise_code TEXT,
      signatures_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS form_cell_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      row_no INTEGER NOT NULL,
      row_name TEXT,
      column_key TEXT NOT NULL,
      value_num REAL,
      value_text TEXT,
      updated_at TEXT,
      updated_by TEXT,
      UNIQUE (instance_id, row_no, column_key),
      FOREIGN KEY (instance_id) REFERENCES form_instances(instance_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cells_instance ON form_cell_values(instance_id);
    CREATE INDEX IF NOT EXISTS idx_cells_updated ON form_cell_values(instance_id, updated_at);

    CREATE TABLE IF NOT EXISTS cell_presence (
      instance_id TEXT NOT NULL,
      row_no INTEGER NOT NULL,
      column_key TEXT NOT NULL,
      user_name TEXT NOT NULL,
      machine_name TEXT,
      client_id TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      PRIMARY KEY (instance_id, row_no, column_key)
    );

    CREATE INDEX IF NOT EXISTS idx_presence_instance ON cell_presence(instance_id);

    CREATE TABLE IF NOT EXISTS local_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      instance_id TEXT,
      row_no INTEGER,
      column_key TEXT,
      actor TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const cols = db.prepare("PRAGMA table_info(form_cell_values)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("updated_at")) {
    db.exec("ALTER TABLE form_cell_values ADD COLUMN updated_at TEXT");
  }
  if (!names.has("updated_by")) {
    db.exec("ALTER TABLE form_cell_values ADD COLUMN updated_by TEXT");
  }
  if (!names.has("updated_client_id")) {
    db.exec("ALTER TABLE form_cell_values ADD COLUMN updated_client_id TEXT");
  }

  const instCols = db.prepare("PRAGMA table_info(form_instances)").all() as Array<{ name: string }>;
  const instNames = new Set(instCols.map((c) => c.name));
  if (!instNames.has("rash_entries_json")) {
    db.exec("ALTER TABLE form_instances ADD COLUMN rash_entries_json TEXT DEFAULT '[]'");
  }

  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(SCHEMA_VERSION));
}

export function readPackageMetaFile(metaPath: string): PackageMeta {
  const raw = fs.readFileSync(metaPath, "utf8");
  return JSON.parse(raw) as PackageMeta;
}

export function writePackageMetaFile(metaPath: string, meta: PackageMeta): void {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

export const PACKAGE_META = "package.meta.json";
export const DB_FILE = "oko.db";
