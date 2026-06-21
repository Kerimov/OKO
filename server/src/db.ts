import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = process.env.OKO_DB_PATH ?? path.join(DATA_DIR, "oko.db");
const SCHEMA_PATH = path.join(ROOT, "data", "schema.sql");
const KONTR_PATH = path.join(ROOT, "portal", "public", "data", "kontr.json");

let db: DatabaseSync | null = null;

const INSTANCE_DDL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_instances (
  instance_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_title TEXT NOT NULL,
  display_name TEXT NOT NULL,
  organization TEXT DEFAULT '',
  period_start TEXT DEFAULT '',
  period_end TEXT DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_instances_template ON portal_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_portal_instances_period ON portal_instances(period_start, period_end);

CREATE TABLE IF NOT EXISTS kontragents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  org_form TEXT,
  inn TEXT,
  kpp TEXT
);
`;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    seedKontr(db);
  }
  return db;
}

function initSchema(database: DatabaseSync): void {
  if (fs.existsSync(SCHEMA_PATH)) {
    const sql = fs.readFileSync(SCHEMA_PATH, "utf-8");
    database.exec(sql);
  }
  database.exec(INSTANCE_DDL);
}

function seedKontr(database: DatabaseSync): void {
  const count = database.prepare("SELECT COUNT(*) AS c FROM kontragents").get() as {
    c: number;
  };
  if (count.c > 0 || !fs.existsSync(KONTR_PATH)) return;

  const data = JSON.parse(fs.readFileSync(KONTR_PATH, "utf-8")) as {
    items: Array<{
      id: number;
      name: string;
      orgForm?: string | null;
      inn?: string | null;
      kpp?: string | null;
    }>;
  };

  const insert = database.prepare(
    "INSERT OR REPLACE INTO kontragents (id, name, org_form, inn, kpp) VALUES (?, ?, ?, ?, ?)"
  );
  database.exec("BEGIN");
  try {
    for (const k of data.items) {
      insert.run(k.id, k.name, k.orgForm ?? null, k.inn ?? null, k.kpp ?? null);
    }
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}

export { DB_PATH, ROOT };
