import type { Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.js";

export interface AuditEntry {
  id: number;
  action: string;
  instance_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor: string | null;
  details: string | null;
  created_at: string;
}

export function migrateAuditTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action      TEXT NOT NULL,
      instance_id TEXT,
      entity_type TEXT,
      entity_id   TEXT,
      actor       TEXT,
      details     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_report_log_created ON report_log(created_at);
  `);

  const cols = db.prepare("PRAGMA table_info(report_log)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("entity_type")) {
    db.exec("ALTER TABLE report_log ADD COLUMN entity_type TEXT");
  }
  if (!names.has("entity_id")) {
    db.exec("ALTER TABLE report_log ADD COLUMN entity_id TEXT");
  }
  if (!names.has("actor")) {
    db.exec("ALTER TABLE report_log ADD COLUMN actor TEXT");
  }
}

export function logAudit(
  db: DatabaseSync,
  req: Request,
  action: string,
  options?: {
    instanceId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    details?: unknown;
  }
): void {
  const details =
    options?.details === undefined
      ? null
      : typeof options.details === "string"
        ? options.details.slice(0, 4000)
        : JSON.stringify(options.details).slice(0, 4000);

  db.prepare(
    `INSERT INTO report_log (action, instance_id, entity_type, entity_id, actor, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    action,
    options?.instanceId ?? null,
    options?.entityType ?? null,
    options?.entityId ?? null,
    req.apiRole ?? null,
    details
  );
}

export function listAuditLog(
  db: DatabaseSync,
  options: { limit?: number; offset?: number; q?: string }
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const q = options.q?.trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q) {
    conditions.push("(action LIKE ? OR details LIKE ? OR entity_id LIKE ? OR actor LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM report_log ${where}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT id, action, instance_id, entity_type, entity_id, actor, details, created_at
       FROM report_log ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AuditEntry[];

  return { total, limit, offset, items: rows };
}

export function auditMiddleware(req: Request, res: Response, next: () => void): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.apiRole !== "admin") {
    next();
    return;
  }

  const started = Date.now();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const path = req.path;
    if (!path.startsWith("/api/")) return;
    if (path.startsWith("/api/instances") && !path.includes("/normalize")) return;

    const metaRoutes =
      path.startsWith("/api/checks") ||
      path.startsWith("/api/forms") ||
      path.startsWith("/api/saldo") ||
      path.startsWith("/api/correspondence") ||
      path.startsWith("/api/excel") ||
      path === "/api/instances/normalize";

    if (!metaRoutes) return;

    logAudit(getDb(), req, `${req.method} ${path}`, {
      entityType: path.split("/")[2] ?? "api",
      entityId:
        (req.params as { number?: string; id?: string; formId?: string }).number ??
        (req.params as { id?: string }).id ??
        (req.params as { formId?: string }).formId ??
        null,
      details: {
        durationMs: Date.now() - started,
        bodyKeys: Object.keys((req.body as object) ?? {}),
      },
    });
  });
  next();
}
