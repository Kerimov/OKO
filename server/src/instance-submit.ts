import {
  runFormChecksWithData,
  type CheckMode,
  type CheckRule,
  type CheckRunResult,
} from "@oko/engine";
import { exportChecksPayload } from "./checks.js";
import type { OkoDb } from "./oko-db.js";
import { intOrNull } from "./dbValues.js";
import {
  loadInstance,
  setInstanceStatus,
} from "./instances.js";
import type { OkoFormInstance } from "./types.js";

export class ChecksFailedError extends Error {
  readonly status = 422;
  readonly result: CheckRunResult;

  constructor(result: CheckRunResult) {
    super("checks_failed");
    this.name = "ChecksFailedError";
    this.result = result;
  }

  toJSON() {
    return { error: "checks_failed" as const, result: this.result };
  }
}

export class PackageChecksFailedError extends Error {
  readonly status = 422;
  readonly results: Record<string, CheckRunResult>;

  constructor(results: Record<string, CheckRunResult>) {
    super("package_checks_failed");
    this.name = "PackageChecksFailedError";
    this.results = results;
  }

  toJSON() {
    return { error: "package_checks_failed" as const, results: this.results };
  }
}

async function listPackageInstanceIds(
  db: OkoDb,
  zid: number,
  eid: number
): Promise<string[]> {
  const ids = new Set<string>();

  const normalized = (await db
    .prepare("SELECT instance_id FROM form_instances WHERE zid = ? AND eid = ?")
    .all(zid, eid)) as Array<{ instance_id: string }>;
  for (const row of normalized) ids.add(row.instance_id);

  const portalOnly = (await db
    .prepare(
      `SELECT p.instance_id, p.payload FROM portal_instances p
       WHERE NOT EXISTS (
         SELECT 1 FROM form_instances f WHERE f.instance_id = p.instance_id
       )`
    )
    .all()) as Array<{ instance_id: string; payload: string }>;

  for (const row of portalOnly) {
    try {
      const inst = JSON.parse(row.payload) as OkoFormInstance;
      if (intOrNull(inst.zid) === zid && intOrNull(inst.eid) === eid) {
        ids.add(row.instance_id);
      }
    } catch {
      /* skip invalid payload */
    }
  }

  return [...ids];
}

export async function loadSiblingInstances(
  db: OkoDb,
  existing: OkoFormInstance
): Promise<OkoFormInstance[]> {
  const zid = intOrNull(existing.zid);
  const eid = intOrNull(existing.eid);
  if (zid == null || eid == null) {
    return [existing];
  }

  const ids = await listPackageInstanceIds(db, zid, eid);
  const instances: OkoFormInstance[] = [];
  for (const id of ids) {
    const inst = await loadInstance(db, id);
    if (inst) instances.push(inst);
  }
  if (!instances.some((i) => i.instanceId === existing.instanceId)) {
    instances.push(existing);
  }
  return instances;
}

/** Dry-run period (or other mode) checks for one form — no status change. */
export async function runInstancePeriodChecks(
  db: OkoDb,
  instanceId: string,
  mode: CheckMode = "period"
): Promise<{ instance: OkoFormInstance; result: CheckRunResult } | null> {
  const existing = await loadInstance(db, instanceId);
  if (!existing) return null;

  const payload = await exportChecksPayload(db);
  const rules = payload.checks as CheckRule[];
  const instances = await loadSiblingInstances(db, existing);
  const result = runFormChecksWithData(
    rules,
    existing.templateId,
    instances,
    mode
  );
  return { instance: existing, result };
}

/** Submit form: run period checks against package siblings, then set status. */
export async function submitInstanceWithChecks(
  db: OkoDb,
  instanceId: string
): Promise<OkoFormInstance | null> {
  const ran = await runInstancePeriodChecks(db, instanceId, "period");
  if (!ran) return null;
  if (ran.result.failed > 0 || ran.result.skipped > 0) {
    throw new ChecksFailedError(ran.result);
  }
  return setInstanceStatus(db, instanceId, "submitted");
}

/** Validate package instances marked submitted (in-memory siblings). */
export async function assertPackageSubmittedChecks(
  db: OkoDb,
  instances: OkoFormInstance[]
): Promise<void> {
  const submitted = instances.filter((i) => i.status === "submitted");
  if (submitted.length === 0) return;

  const payload = await exportChecksPayload(db);
  const rules = payload.checks as CheckRule[];
  const results: Record<string, CheckRunResult> = {};

  for (const inst of submitted) {
    if (!inst.templateId) continue;
    const result = runFormChecksWithData(rules, inst.templateId, instances, "period");
    if (result.failed > 0 || result.skipped > 0) {
      results[inst.templateId] = result;
    }
  }

  if (Object.keys(results).length > 0) {
    throw new PackageChecksFailedError(results);
  }
}
