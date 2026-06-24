import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic, type Statement } from "sql.js";

let sqlModule: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
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

function pauseSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait for short FS retries */
  }
}

function readFileRetry(filePath: string, attempts = 4): Buffer {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fs.readFileSync(filePath);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) pauseSync(40 * (i + 1));
    }
  }
  throw lastErr;
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
  private db: Database;
  private readonly sql: SqlJsStatic;
  private inTransaction = false;
  private lastLoadedMtime = 0;
  private lastPersistMtime = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistPending = false;

  private constructor(db: Database, private readonly dbPath: string, sql: SqlJsStatic) {
    this.db = db;
    this.sql = sql;
    if (fs.existsSync(dbPath)) {
      const mtime = fs.statSync(dbPath).mtimeMs;
      this.lastLoadedMtime = mtime;
      this.lastPersistMtime = mtime;
    }
  }

  get path(): string {
    return this.dbPath;
  }

  static async open(dbPath: string): Promise<PackageDatabase> {
    const SQL = await getSql();
    let db: Database;
    if (fs.existsSync(dbPath)) {
      const buffer = readFileRetry(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
    return new PackageDatabase(db, dbPath, SQL);
  }

  /** Подтянуть изменения другого процесса (второй клиент на том же комплекте). */
  reloadFromDiskIfExternalChange(): void {
    if (this.inTransaction || !fs.existsSync(this.dbPath)) return;
    const mtime = fs.statSync(this.dbPath).mtimeMs;
    if (mtime <= this.lastLoadedMtime) return;
    if (mtime <= this.lastPersistMtime) {
      this.lastLoadedMtime = mtime;
      return;
    }
    try {
      const buffer = readFileRetry(this.dbPath);
      this.db.close();
      this.db = new this.sql.Database(buffer);
      this.lastLoadedMtime = mtime;
    } catch {
      /* оставляем текущую копию в памяти */
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
    if (isMutating(sql.split(";")[0] ?? sql)) this.schedulePersist();
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    const mutating = isMutating(sql);
    return new PreparedStatement(stmt, () => {
      if (!this.inTransaction) this.schedulePersist();
    }, mutating);
  }

  transaction<T>(fn: (db: PackageDatabase) => T): T {
    this.flushPersist();
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
      this.flushPersist();
    }
  }

  private schedulePersist(): void {
    this.persistPending = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, 120);
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.persistPending) return;
    this.persistPending = false;
    this.persist();
  }

  persist(): void {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const data = Buffer.from(this.db.export());
    const tmpPath = `${this.dbPath}.tmp`;
    let lastErr: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        fs.writeFileSync(tmpPath, data);
        fs.renameSync(tmpPath, this.dbPath);
        const mtime = fs.statSync(this.dbPath).mtimeMs;
        this.lastPersistMtime = mtime;
        this.lastLoadedMtime = mtime;
        return;
      } catch (e) {
        lastErr = e;
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        if (i < 3) pauseSync(50 * (i + 1));
      }
    }
    throw lastErr;
  }

  close(): void {
    this.flushPersist();
    this.db.close();
  }
}
