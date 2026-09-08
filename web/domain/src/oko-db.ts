import fs from "fs";
import path from "path";
import pg from "pg";
import { ROOT } from "./paths.js";

export type DbDialect = "postgres";

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

const SCHEMA_POSTGRES = path.join(ROOT, "data", "schema.postgresql.sql");

let dbInstance: OkoDb | null = null;

export function isPostgresMode(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function convertPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
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
  await db.exec(sql);
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
  if (!isPostgresMode()) {
    throw new Error(
      "DATABASE_URL is required. PostgreSQL is the only supported API database. " +
        "Offline desktop kits still use local SQLite (oko.db) via Tauri — that is separate from the API."
    );
  }
  dbInstance = await createPostgresDb();
  await applySchemaFile(dbInstance, SCHEMA_POSTGRES);
  return dbInstance;
}

export async function getDb(): Promise<OkoDb> {
  if (!dbInstance) return initDatabase();
  return dbInstance;
}

export { ROOT };
