import { randomUUID } from "node:crypto";
import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";

export interface CheckExplanationDto {
  id: number;
  zid: number;
  eid: number;
  packageKind: PackageKind;
  ruleNumber: number;
  formId: string | null;
  explanation: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckJournalEntryDto {
  id: number;
  runId: string;
  zid: number;
  eid: number;
  packageKind: PackageKind;
  ruleNumber: number | null;
  ruleCode: string | null;
  checkType: string | null;
  passed: boolean;
  leftValue: number | null;
  rightValue: number | null;
  message: string | null;
  formId: string | null;
  requiresExplanation: boolean;
  explanationId: number | null;
  actor: string | null;
  createdAt: string;
}

export async function upsertCheckExplanation(
  db: OkoDb,
  input: {
    zid: number;
    eid: number;
    packageKind?: PackageKind;
    ruleNumber: number;
    formId?: string | null;
    explanation: string;
    author?: string | null;
  }
): Promise<CheckExplanationDto> {
  const kind = normalizePackageKind(input.packageKind);
  const formId = input.formId ?? "";
  const now = new Date().toISOString();
  const text = input.explanation.trim();
  if (!text) {
    const err = new Error("explanation required");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  await db
    .prepare(
      `INSERT INTO check_explanations (
         zid, eid, package_kind, rule_number, form_id, explanation, author, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (zid, eid, package_kind, rule_number, form_id)
       DO UPDATE SET explanation = EXCLUDED.explanation, author = EXCLUDED.author, updated_at = EXCLUDED.updated_at`
    )
    .run(
      input.zid,
      input.eid,
      kind,
      input.ruleNumber,
      formId,
      text,
      input.author ?? null,
      now,
      now
    );

  const row = (await db
    .prepare(
      `SELECT * FROM check_explanations
       WHERE zid = ? AND eid = ? AND package_kind = ? AND rule_number = ? AND form_id = ?`
    )
    .get(input.zid, input.eid, kind, input.ruleNumber, formId)) as {
    id: number;
    zid: number;
    eid: number;
    package_kind: string;
    rule_number: number;
    form_id: string | null;
    explanation: string;
    author: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    id: Number(row.id),
    zid: Number(row.zid),
    eid: Number(row.eid),
    packageKind: normalizePackageKind(row.package_kind),
    ruleNumber: Number(row.rule_number),
    formId: row.form_id || null,
    explanation: row.explanation,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCheckExplanations(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind: PackageKind = "OKO"
): Promise<CheckExplanationDto[]> {
  const rows = (await db
    .prepare(
      `SELECT * FROM check_explanations
       WHERE zid = ? AND eid = ? AND package_kind = ?
       ORDER BY rule_number`
    )
    .all(zid, eid, packageKind)) as Array<{
    id: number;
    zid: number;
    eid: number;
    package_kind: string;
    rule_number: number;
    form_id: string | null;
    explanation: string;
    author: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: Number(row.id),
    zid: Number(row.zid),
    eid: Number(row.eid),
    packageKind: normalizePackageKind(row.package_kind),
    ruleNumber: Number(row.rule_number),
    formId: row.form_id || null,
    explanation: row.explanation,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function appendCheckRunJournal(
  db: OkoDb,
  input: {
    runId?: string;
    zid: number;
    eid: number;
    packageKind?: PackageKind;
    actor?: string | null;
    results: Array<{
      ruleNumber?: number | null;
      ruleCode?: string | null;
      checkType?: string | null;
      passed: boolean;
      leftValue?: number | null;
      rightValue?: number | null;
      message?: string | null;
      formId?: string | null;
      requiresExplanation?: boolean;
    }>;
  }
): Promise<{ runId: string; count: number }> {
  const runId = input.runId ?? randomUUID();
  const kind = normalizePackageKind(input.packageKind);
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO check_run_journal (
       run_id, zid, eid, package_kind, rule_number, rule_code, check_type, passed,
       left_value, right_value, message, form_id, requires_explanation, actor, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of input.results) {
    await ins.run(
      runId,
      input.zid,
      input.eid,
      kind,
      r.ruleNumber ?? null,
      r.ruleCode ?? null,
      r.checkType ?? null,
      r.passed ? 1 : 0,
      r.leftValue ?? null,
      r.rightValue ?? null,
      r.message ?? null,
      r.formId ?? null,
      r.requiresExplanation ? 1 : 0,
      input.actor ?? null,
      now
    );
  }
  return { runId, count: input.results.length };
}

export async function listCheckJournal(
  db: OkoDb,
  filter: { zid: number; eid: number; packageKind?: PackageKind; runId?: string }
): Promise<CheckJournalEntryDto[]> {
  const kind = normalizePackageKind(filter.packageKind);
  const where = ["zid = ?", "eid = ?", "package_kind = ?"];
  const params: unknown[] = [filter.zid, filter.eid, kind];
  if (filter.runId) {
    where.push("run_id = ?");
    params.push(filter.runId);
  }
  const rows = (await db
    .prepare(
      `SELECT * FROM check_run_journal
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT 500`
    )
    .all(...params)) as Array<{
    id: number;
    run_id: string;
    zid: number;
    eid: number;
    package_kind: string;
    rule_number: number | null;
    rule_code: string | null;
    check_type: string | null;
    passed: number;
    left_value: number | null;
    right_value: number | null;
    message: string | null;
    form_id: string | null;
    requires_explanation: number;
    explanation_id: number | null;
    actor: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    runId: r.run_id,
    zid: Number(r.zid),
    eid: Number(r.eid),
    packageKind: normalizePackageKind(r.package_kind),
    ruleNumber: r.rule_number == null ? null : Number(r.rule_number),
    ruleCode: r.rule_code ?? null,
    checkType: r.check_type,
    passed: !!r.passed,
    leftValue: r.left_value,
    rightValue: r.right_value,
    message: r.message,
    formId: r.form_id,
    requiresExplanation: !!r.requires_explanation,
    explanationId: r.explanation_id,
    actor: r.actor,
    createdAt: r.created_at,
  }));
}

export type MissingExplanation = {
  ruleNumber: number;
  formId: string | null;
  message: string | null;
};

/** Pure: compute missing explanations from failed journal rows vs explained keys. */
export function computeMissingExplanations(
  failed: Array<{
    ruleNumber?: number | null;
    rule_number?: number | null;
    formId?: string | null;
    form_id?: string | null;
    message?: string | null;
  }>,
  explainedKeys: Iterable<string>
): MissingExplanation[] {
  const explained = explainedKeys instanceof Set ? explainedKeys : new Set(explainedKeys);
  const missing: MissingExplanation[] = [];
  for (const f of failed) {
    const ruleNumber = f.ruleNumber ?? f.rule_number;
    if (ruleNumber == null) continue;
    const formId = f.formId ?? f.form_id ?? null;
    const key = `${Number(ruleNumber)}::${formId ?? ""}`;
    if (explained.has(key)) continue;
    missing.push({
      ruleNumber: Number(ruleNumber),
      formId,
      message: f.message ?? null,
    });
  }
  return missing;
}

export function formatApprovalBlockersMessage(missing: MissingExplanation[]): string {
  if (missing.length === 0) return "Approval blocked";
  const rules = missing.map((m) => m.ruleNumber).join(", ");
  return `Approval blocked: missing explanations for rules ${rules}`;
}

/**
 * Approval is blocked when failed checks requiring explanation lack one.
 */
export async function getApprovalBlockers(
  db: OkoDb,
  zid: number,
  eid: number,
  packageKind: PackageKind = "OKO"
): Promise<{
  blocked: boolean;
  missingExplanations: MissingExplanation[];
}> {
  const latest = (await db
    .prepare(
      `SELECT run_id FROM check_run_journal
       WHERE zid = ? AND eid = ? AND package_kind = ? AND check_type = 'package_run'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(zid, eid, packageKind)) as { run_id: string } | undefined;

  if (!latest) {
    return { blocked: false, missingExplanations: [] };
  }

  const failed = (await db
    .prepare(
      `SELECT rule_number, form_id, message
       FROM check_run_journal
       WHERE run_id = ? AND passed = 0 AND requires_explanation = 1`
    )
    .all(latest.run_id)) as Array<{
    rule_number: number | null;
    form_id: string | null;
    message: string | null;
  }>;

  const explanations = await listCheckExplanations(db, zid, eid, packageKind);
  const explained = new Set(
    explanations.map((e) => `${e.ruleNumber}::${e.formId ?? ""}`)
  );

  const missing = computeMissingExplanations(failed, explained);
  return { blocked: missing.length > 0, missingExplanations: missing };
}
