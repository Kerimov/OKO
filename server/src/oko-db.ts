import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import pg from "pg";
import { DATA_DIR, DB_PATH, ROOT } from "./paths.js";

export type DbDialect = "sqlite" | "postgres";

export interface RunResult {
  changes: number;
}

export interface OkoStatement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface OkoDb {
  readonly dialect: DbDialect;
  exec(sql: string): Promise<void>;
  prepare(sql: string): OkoStatement;
  transaction<T>(fn: (db: OkoDb) => Promise<T>): Promise<T>;
  columnExists(table: string, column: string): Promise<boolean>;
}

const SCHEMA_SQLITE = path.join(ROOT, "data", "schema.sql");
const SCHEMA_POSTGRES = path.join(ROOT, "data", "schema.postgresql.sql");

let dbInstance: OkoDb | null = null;

export function isPostgresMode(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function convertPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class SqliteStatement implements OkoStatement {
  constructor(private readonly stmt: ReturnType<DatabaseSync["prepare"]>) {}

  async get<T>(...params: unknown[]): Promise<T | undefined> {
    return this.stmt.get(...(params as never[])) as T | undefined;
  }

  async all<T>(...params: unknown[]): Promise<T[]> {
    return this.stmt.all(...(params as never[])) as T[];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const info = this.stmt.run(...(params as never[]));
    return { changes: Number(info.changes ?? 0) };
  }
}

class SqliteDb implements OkoDb {
  readonly dialect = "sqlite" as const;

  constructor(private readonly db: DatabaseSync) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  prepare(sql: string): OkoStatement {
    return new SqliteStatement(this.db.prepare(sql));
  }

  async transaction<T>(fn: (db: OkoDb) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async columnExists(table: string, column: string): Promise<boolean> {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  }
}

class PgStatement implements OkoStatement {
  private readonly pgSql: string;

  constructor(
    private readonly pool: pg.Pool,
    sql: string
  ) {
    this.pgSql = convertPlaceholders(sql);
  }

  async get<T>(...params: unknown[]): Promise<T | undefined> {
    const result = await this.pool.query(this.pgSql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(...params: unknown[]): Promise<T[]> {
    const result = await this.pool.query(this.pgSql, params);
    return result.rows as T[];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const result = await this.pool.query(this.pgSql, params);
    return { changes: result.rowCount ?? 0 };
  }
}

class PgDb implements OkoDb {
  readonly dialect = "postgres" as const;

  constructor(private readonly pool: pg.Pool) {}

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  prepare(sql: string): OkoStatement {
    return new PgStatement(this.pool, sql);
  }

  async transaction<T>(fn: (db: OkoDb) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txDb = new PgClientDb(client);
      const result = await fn(txDb);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async columnExists(table: string, column: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       LIMIT 1`,
      [table.toLowerCase(), column.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

class PgClientDb implements OkoDb {
  readonly dialect = "postgres" as const;

  constructor(private readonly client: pg.PoolClient) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  prepare(sql: string): OkoStatement {
    return new PgClientStatement(this.client, sql);
  }

  async transaction<T>(fn: (db: OkoDb) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async columnExists(table: string, column: string): Promise<boolean> {
    const result = await this.client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       LIMIT 1`,
      [table.toLowerCase(), column.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

class PgClientStatement implements OkoStatement {
  private readonly pgSql: string;

  constructor(
    private readonly client: pg.PoolClient,
    sql: string
  ) {
    this.pgSql = convertPlaceholders(sql);
  }

  async get<T>(...params: unknown[]): Promise<T | undefined> {
    const result = await this.client.query(this.pgSql, params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(...params: unknown[]): Promise<T[]> {
    const result = await this.client.query(this.pgSql, params);
    return result.rows as T[];
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const result = await this.client.query(this.pgSql, params);
    return { changes: result.rowCount ?? 0 };
  }
}

async function applySchemaFile(db: OkoDb, schemaPath: string): Promise<void> {
  if (!fs.existsSync(schemaPath)) return;
  const sql = fs.readFileSync(schemaPath, "utf-8");
  if (db.dialect === "postgres") {
    await db.exec(sql);
    return;
  }
  await db.exec(sql);
}

async function createSqliteDb(): Promise<OkoDb> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new DatabaseSync(DB_PATH);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return new SqliteDb(sqlite);
}

async function createPostgresDb(): Promise<OkoDb> {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 10,
  });
  await pool.query("SELECT 1");
  return new PgDb(pool);
}

export async function initDatabase(): Promise<OkoDb> {
  if (dbInstance) return dbInstance;
  if (isPostgresMode()) {
    dbInstance = await createPostgresDb();
  } else {
    const isProd = process.env.NODE_ENV === "production";
    const allowSqlite =
      process.env.OKO_ALLOW_SQLITE === "1" ||
      process.env.OKO_ALLOW_SQLITE === "true" ||
      !isProd;
    if (!allowSqlite) {
      throw new Error(
        "DATABASE_URL is required (PostgreSQL is the API source of truth). " +
          "For SQLite opt-in set OKO_ALLOW_SQLITE=1 and omit DATABASE_URL."
      );
    }
    console.warn(
      "[deprecated] SQLite API mode — prefer DATABASE_URL (PostgreSQL). " +
        "SQLite remains for offline desktop kits. Set OKO_ALLOW_SQLITE=1 to acknowledge."
    );
    dbInstance = await createSqliteDb();
  }
  const schemaPath = dbInstance.dialect === "postgres" ? SCHEMA_POSTGRES : SCHEMA_SQLITE;
  await applySchemaFile(dbInstance, schemaPath);
  return dbInstance;
}

export async function getDb(): Promise<OkoDb> {
  if (!dbInstance) return initDatabase();
  return dbInstance;
}

export { DB_PATH, ROOT };
