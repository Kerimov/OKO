/**
 * Minimal in-process background job queue (no Redis).
 * Persist jobs in `background_jobs`; worker claims queued rows with concurrency limit.
 */
import { randomUUID } from "crypto";
import type { OkoDb } from "./oko-db.js";

export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed";

export type BackgroundJobType = "create_report_package";

export interface BackgroundJobDto {
  id: string;
  type: BackgroundJobType | string;
  status: BackgroundJobStatus;
  progress: number;
  message: string | null;
  payload: Record<string, unknown>;
  result: unknown | null;
  errorMessage: string | null;
  errorStack: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type JobRow = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string | null;
  payload_json: string;
  result_json: string | null;
  error_message: string | null;
  error_stack: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const DEFAULT_CONCURRENCY = 1;
const POLL_MS = 400;

let workerStarted = false;
let activeCount = 0;
let concurrency = DEFAULT_CONCURRENCY;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapJob(row: JobRow): BackgroundJobDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status as BackgroundJobStatus,
    progress: Number(row.progress ?? 0),
    message: row.message,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    result: parseJson<unknown>(row.result_json, null),
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function enqueueBackgroundJob(
  db: OkoDb,
  input: {
    type: BackgroundJobType;
    payload: Record<string, unknown>;
    createdBy?: string | null;
    message?: string;
  }
): Promise<BackgroundJobDto> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO background_jobs (
        id, type, status, progress, message, payload_json, created_by, created_at
      ) VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.type,
      input.message ?? "В очереди",
      JSON.stringify(input.payload ?? {}),
      input.createdBy ?? null,
      now
    );
  const job = await getBackgroundJob(db, id);
  if (!job) throw new Error("Failed to enqueue job");
  return job;
}

export async function getBackgroundJob(db: OkoDb, id: string): Promise<BackgroundJobDto | null> {
  const row = (await db
    .prepare(`SELECT * FROM background_jobs WHERE id = ?`)
    .get(id)) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export async function updateBackgroundJobProgress(
  db: OkoDb,
  id: string,
  progress: number,
  message?: string
): Promise<void> {
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  if (message != null) {
    await db
      .prepare(`UPDATE background_jobs SET progress = ?, message = ? WHERE id = ?`)
      .run(p, message, id);
  } else {
    await db.prepare(`UPDATE background_jobs SET progress = ? WHERE id = ?`).run(p, id);
  }
}

async function claimNextJob(db: OkoDb): Promise<BackgroundJobDto | null> {
  const queued = (await db
    .prepare(
      `SELECT id FROM background_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
    )
    .get()) as { id: string } | undefined;
  if (!queued?.id) return null;

  const now = new Date().toISOString();
  const updated = await db
    .prepare(
      `UPDATE background_jobs
       SET status = 'running', started_at = ?, progress = 1, message = ?
       WHERE id = ? AND status = 'queued'`
    )
    .run(now, "Выполняется", queued.id);
  if (!updated.changes) return null;

  const row = (await db
    .prepare(`SELECT * FROM background_jobs WHERE id = ?`)
    .get(queued.id)) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

async function finishJobSuccess(db: OkoDb, id: string, result: unknown): Promise<void> {
  await db
    .prepare(
      `UPDATE background_jobs
       SET status = 'succeeded', progress = 100, message = ?, result_json = ?,
           error_message = NULL, error_stack = NULL, finished_at = ?
       WHERE id = ?`
    )
    .run("Готово", JSON.stringify(result ?? null), new Date().toISOString(), id);
}

async function finishJobFailure(db: OkoDb, id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;
  await db
    .prepare(
      `UPDATE background_jobs
       SET status = 'failed', message = ?, error_message = ?, error_stack = ?, finished_at = ?
       WHERE id = ?`
    )
    .run(message, message, stack, new Date().toISOString(), id);
}

async function executeJob(db: OkoDb, job: BackgroundJobDto): Promise<void> {
  if (job.type === "create_report_package") {
    const zid = Number(job.payload.zid);
    const eid = Number(job.payload.eid);
    if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
      throw new Error("create_report_package: zid and eid required");
    }
    const { createReportPackage } = await import("./packages.js");
    const result = await createReportPackage(db, zid, eid, {
      onProgress: async (progress, message) => {
        await updateBackgroundJobProgress(db, job.id, progress, message);
      },
    });
    await finishJobSuccess(db, job.id, result);
    return;
  }
  throw new Error(`Unknown job type: ${job.type}`);
}

async function workerTick(getDb: () => Promise<OkoDb>): Promise<void> {
  if (activeCount >= concurrency) return;
  let db: OkoDb;
  try {
    db = await getDb();
  } catch {
    return;
  }
  const job = await claimNextJob(db);
  if (!job) return;

  activeCount++;
  try {
    await executeJob(db, job);
  } catch (err) {
    try {
      await finishJobFailure(db, job.id, err);
    } catch (persistErr) {
      console.error("[jobs] failed to persist job error", persistErr);
    }
    console.error(`[jobs] ${job.type} ${job.id} failed:`, err);
  } finally {
    activeCount--;
  }
}

/** Start in-process polling worker (idempotent). */
export function startBackgroundJobWorker(
  getDb: () => Promise<OkoDb>,
  opts?: { concurrency?: number }
): void {
  if (workerStarted) return;
  workerStarted = true;
  concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  setInterval(() => {
    void workerTick(getDb);
  }, POLL_MS);
  console.log(`[jobs] background worker started (concurrency=${concurrency})`);
}
