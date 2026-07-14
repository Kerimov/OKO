import type { Request, Response } from "express";
import type { OkoDb } from "./oko-db.js";
import { getDb } from "./oko-db.js";

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

export async function migrateAuditTable(db: OkoDb): Promise<void> {
  if (!(await db.columnExists("report_log", "entity_type"))) {
    await db.exec("ALTER TABLE report_log ADD COLUMN entity_type TEXT");
  }
  if (!(await db.columnExists("report_log", "entity_id"))) {
    await db.exec("ALTER TABLE report_log ADD COLUMN entity_id TEXT");
  }
  if (!(await db.columnExists("report_log", "actor"))) {
    await db.exec("ALTER TABLE report_log ADD COLUMN actor TEXT");
  }
}

function actorFromRequest(req: Request): string | null {
  return req.apiUser?.username ?? req.apiRole ?? null;
}

export async function logDomainAudit(
  db: OkoDb,
  input: {
    actor?: string | null;
    action: string;
    instanceId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    details?: unknown;
  }
): Promise<void> {
  const details =
    input.details === undefined
      ? null
      : typeof input.details === "string"
        ? input.details.slice(0, 4000)
        : JSON.stringify(input.details).slice(0, 4000);

  await db
    .prepare(
      `INSERT INTO report_log (action, instance_id, entity_type, entity_id, actor, details)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.action,
      input.instanceId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.actor ?? null,
      details
    );
}

export async function logAudit(
  db: OkoDb,
  req: Request,
  action: string,
  options?: {
    instanceId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    details?: unknown;
  }
): Promise<void> {
  await logDomainAudit(db, {
    actor: actorFromRequest(req),
    action,
    instanceId: options?.instanceId,
    entityType: options?.entityType,
    entityId: options?.entityId,
    details: options?.details,
  });
}

export async function listAuditLog(
  db: OkoDb,
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
    (await db.prepare(`SELECT COUNT(*) AS c FROM report_log ${where}`).get(...params)) as {
      c: number;
    }
  ).c;

  const rows = (await db
    .prepare(
      `SELECT id, action, instance_id, entity_type, entity_id, actor, details, created_at
       FROM report_log ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as AuditEntry[];

  return { total, limit, offset, items: rows };
}

const DOMAIN_AUDIT_PREFIXES = [
  "/api/packages",
  "/api/aggregation",
  "/api/methodology",
  "/api/users",
  "/api/kontr",
  "/api/work-context",
  "/api/checks",
  "/api/forms",
  "/api/saldo",
  "/api/correspondence",
  "/api/excel",
  "/api/rash",
];

export function auditMiddleware(req: Request, res: Response, next: () => void): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (!req.apiRole) {
    next();
    return;
  }

  const started = Date.now();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const path = req.path;
    if (!path.startsWith("/api/")) return;
    // High-frequency cell writes stay out of the HTTP audit stream.
    if (path.startsWith("/api/instances") && !path.includes("/normalize")) return;

    const metaRoutes =
      DOMAIN_AUDIT_PREFIXES.some((p) => path === p || path.startsWith(p + "/")) ||
      path === "/api/instances/normalize";

    if (!metaRoutes) return;

    void getDb().then((db) =>
      logAudit(db, req, `${req.method} ${path}`, {
        entityType: path.split("/")[2] ?? "api",
        entityId:
          (req.params as { number?: string; id?: string; formId?: string }).number ??
          (req.params as { id?: string }).id ??
          (req.params as { formId?: string }).formId ??
          null,
        details: {
          durationMs: Date.now() - started,
          bodyKeys: Object.keys((req.body as object) ?? {}),
          statusCode: res.statusCode,
        },
      })
    );
  });
  next();
}
