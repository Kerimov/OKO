import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";
import { evalCheckDsl, parseCheckDsl } from "./checkDsl.js";
import { loadInstance, findInstanceIdByPackageTemplate } from "./instances.js";
import { appendCheckRunJournal } from "./checkJournal.js";

export interface CheckDslRuleDto {
  id: number;
  code: string;
  expression: string;
  packageKind: PackageKind;
  requiresExplanation: boolean;
  active: boolean;
  note: string | null;
  sortOrder: number;
}

export async function listCheckDslRules(
  db: OkoDb,
  packageKind?: PackageKind
): Promise<CheckDslRuleDto[]> {
  const rows = (await db
    .prepare(
      packageKind
        ? `SELECT * FROM check_dsl_rules WHERE package_kind = ? ORDER BY sort_order, id`
        : `SELECT * FROM check_dsl_rules ORDER BY package_kind, sort_order, id`
    )
    .all(...(packageKind ? [packageKind] : []))) as Array<{
    id: number;
    code: string;
    expression: string;
    package_kind: string;
    requires_explanation: number;
    active: number;
    note: string | null;
    sort_order: number;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    code: r.code,
    expression: r.expression,
    packageKind: normalizePackageKind(r.package_kind),
    requiresExplanation: !!r.requires_explanation,
    active: !!r.active,
    note: r.note,
    sortOrder: Number(r.sort_order),
  }));
}

export async function upsertCheckDslRule(
  db: OkoDb,
  input: {
    code: string;
    expression: string;
    packageKind?: PackageKind;
    requiresExplanation?: boolean;
    active?: boolean;
    note?: string | null;
    sortOrder?: number;
  }
): Promise<CheckDslRuleDto> {
  const parsed = parseCheckDsl(input.expression);
  if (!parsed.ok) {
    const err = new Error(`Invalid DSL: ${parsed.error}`);
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const kind = normalizePackageKind(input.packageKind);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO check_dsl_rules (
         code, expression, package_kind, requires_explanation, active, note, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (code, package_kind) DO UPDATE SET
         expression = EXCLUDED.expression,
         requires_explanation = EXCLUDED.requires_explanation,
         active = EXCLUDED.active,
         note = EXCLUDED.note,
         sort_order = EXCLUDED.sort_order`
    )
    .run(
      input.code.trim(),
      input.expression.trim(),
      kind,
      input.requiresExplanation === false ? 0 : 1,
      input.active === false ? 0 : 1,
      input.note ?? null,
      input.sortOrder ?? 0,
      now
    );
  const list = await listCheckDslRules(db, kind);
  return list.find((r) => r.code === input.code.trim())!;
}

/**
 * Run active DSL rules against package forms. Cell refs: FORMID.COL[rowKey].
 * Persists results to check_run_journal.
 */
export async function runPackageDslChecks(
  db: OkoDb,
  input: {
    zid: number;
    eid: number;
    packageKind?: PackageKind;
    actor?: string | null;
  }
): Promise<{
  runId: string;
  passed: number;
  failed: number;
  results: Array<{
    code: string;
    passed: boolean;
    left?: number;
    right?: number;
    message: string;
    requiresExplanation: boolean;
  }>;
}> {
  const kind = normalizePackageKind(input.packageKind);
  const rules = (await listCheckDslRules(db, kind)).filter((r) => r.active);
  const instanceCache = new Map<string, Awaited<ReturnType<typeof loadInstance>>>();

  const resolve = async (formId: string, column: string, row: string): Promise<number> => {
    let inst = instanceCache.get(formId);
    if (inst === undefined) {
      const id = await findInstanceIdByPackageTemplate(db, input.zid, input.eid, formId);
      inst = id ? await loadInstance(db, id) : null;
      instanceCache.set(formId, inst);
    }
    if (!inst?.rows?.length) return 0;
    const key = String(row).trim();
    for (const r of inst.rows) {
      const candidates = [r.num, r.code, r.account, r.name].map((v) => String(v ?? "").trim());
      if (!candidates.includes(key) && !candidates.some((c) => c === key)) continue;
      // also allow exact num match
      if (
        candidates.some((c) => c === key) ||
        String(r.num ?? "") === key
      ) {
        const raw = r[column];
        if (raw === undefined || raw === null || raw === "") return 0;
        const n =
          typeof raw === "number"
            ? raw
            : parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      }
    }
    // try row index / num
    for (const r of inst.rows) {
      if (String(r.num ?? "") === key) {
        const raw = r[column];
        const n =
          typeof raw === "number"
            ? raw
            : parseFloat(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      }
    }
    return 0;
  };

  const results: Array<{
    code: string;
    passed: boolean;
    left?: number;
    right?: number;
    message: string;
    requiresExplanation: boolean;
  }> = [];

  for (const rule of rules) {
    const parsed = parseCheckDsl(rule.expression);
    if (!parsed.ok || !parsed.ast) {
      results.push({
        code: rule.code,
        passed: false,
        message: `parse error: ${parsed.error}`,
        requiresExplanation: rule.requiresExplanation,
      });
      continue;
    }
    const syncResolve = (formId: string, column: string, row: string): number => {
      // evalCheckDsl is sync — use cached instances only; warm cache first
      void resolve; // keep for type
      const inst = instanceCache.get(formId);
      if (!inst?.rows) return 0;
      const key = String(row).trim();
      for (const r of inst.rows) {
        if (
          String(r.num ?? "") === key ||
          String(r.code ?? "") === key ||
          String(r.account ?? "") === key
        ) {
          const raw = r[column];
          const n =
            typeof raw === "number"
              ? raw
              : parseFloat(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
          return Number.isFinite(n) ? n : 0;
        }
      }
      return 0;
    };

    // Warm all form refs mentioned — crude: load forms from expression tokens
    const formIds = [...rule.expression.matchAll(/([A-Za-zА-Яа-я0-9_]+)\.[A-Za-z]/g)].map(
      (m) => m[1]!
    );
    for (const fid of new Set(formIds)) {
      if (!instanceCache.has(fid)) {
        const id = await findInstanceIdByPackageTemplate(db, input.zid, input.eid, fid);
        instanceCache.set(fid, id ? await loadInstance(db, id) : null);
      }
    }

    const ev = evalCheckDsl(parsed.ast, syncResolve);
    results.push({
      code: rule.code,
      passed: !!ev.passed,
      left: ev.left,
      right: ev.right,
      message: ev.passed
        ? `OK ${rule.code}`
        : `FAIL ${rule.code}: ${ev.left ?? "?"} vs ${ev.right ?? "?"}`,
      requiresExplanation: rule.requiresExplanation,
    });
  }

  const journal = await appendCheckRunJournal(db, {
    zid: input.zid,
    eid: input.eid,
    packageKind: kind,
    actor: input.actor ?? null,
    results: results.map((r, i) => ({
      ruleNumber: i + 1,
      checkType: "dsl",
      passed: r.passed,
      leftValue: r.left ?? null,
      rightValue: r.right ?? null,
      message: `${r.code}: ${r.message}`,
      formId: null,
      requiresExplanation: !r.passed && r.requiresExplanation,
    })),
  });

  return {
    runId: journal.runId,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}
