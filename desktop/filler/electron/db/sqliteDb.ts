import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import initSqlJs, { type Database, type Statement } from "sql.js";

let sqlModule: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSql() {
  if (!sqlModule) {
    const wasmDir = app.isPackaged
      ? path.join(process.resourcesPath, "..", "dist-electron")
      : path.dirname(fileURLToPath(import.meta.url));

    sqlModule = await initSqlJs({
      locateFile: (file) => {
        const candidates = [
          path.join(process.resourcesPath, "..", "dist-electron", file),
          path.join(wasmDir, file),
          path.join(process.cwd(), "node_modules/sql.js/dist", file),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) return p;
        }
        return path.join(wasmDir, file);
      },
    });
  }
  return sqlModule;
}

export class PreparedStatement {
  constructor(
    private readonly stmt: Statement,
    private readonly onMutate: () => void,
    private readonly mutating: boolean
  ) {}

  run(...params: unknown[]): void {
    this.stmt.bind(params as never);
    this.stmt.step();
    this.stmt.reset();
    if (this.mutating) this.onMutate();
  }

  get<T>(...params: unknown[]): T | undefined {
    this.stmt.bind(params as never);
    const hasRow = this.stmt.step();
    const row = hasRow ? (this.stmt.getAsObject() as T) : undefined;
    this.stmt.reset();
    return row;
  }

  all<T>(...params: unknown[]): T[] {
    this.stmt.bind(params as never);
    const rows: T[] = [];
    while (this.stmt.step()) {
      rows.push(this.stmt.getAsObject() as T);
    }
    this.stmt.reset();
    return rows;
  }
}

function isMutating(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|PRAGMA\s+journal)/i.test(
    sql.trim()
  );
}

export class PackageDatabase {
  private readonly db: Database;
  private inTransaction = false;

  private constructor(
    db: Database,
    private readonly dbPath: string
  ) {
    this.db = db;
  }

  static async open(dbPath: string): Promise<PackageDatabase> {
    const SQL = await getSql();
    let db: Database;
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
    return new PackageDatabase(db, dbPath);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    if (isMutating(sql.split(";")[0] ?? sql)) this.persist();
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    const mutating = isMutating(sql);
    return new PreparedStatement(stmt, () => {
      if (!this.inTransaction) this.persist();
    }, mutating);
  }

  transaction<T>(fn: (db: PackageDatabase) => T): T {
    this.inTransaction = true;
    try {
      this.db.exec("BEGIN");
      const result = fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      this.inTransaction = false;
      this.persist();
    }
  }

  persist(): void {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}
