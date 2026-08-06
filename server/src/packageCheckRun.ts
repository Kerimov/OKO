import type { OkoDb } from "./oko-db.js";
import { normalizePackageKind, type PackageKind } from "./businessProcessTypes.js";
import { evaluateCheckNotation12, parseCheckNotation12 } from "./checkNotation12.js";
import { listActivePackageRules } from "./checkRulesRegistry.js";
import { appendCheckRunJournal } from "./checkJournal.js";
import { findInstanceIdByPackageTemplate, loadInstance } from "./instances.js";

export interface PackageCheckRunResult {
  runId: string;
  packageKind: PackageKind;
  passed: number;
  failed: number;
  results: Array<{ code: string; passed: boolean; left?: number | null; right?: number | null; message: string; requiresExplanation: boolean }>;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

export async function runPackageChecks(
  db: OkoDb,
  input: { zid: number; eid: number; packageKind?: PackageKind; actor?: string | null }
): Promise<PackageCheckRunResult> {
  const packageKind = normalizePackageKind(input.packageKind);
  const context = await db.prepare(
    `SELECT p.year, o.guid FROM periods p
     LEFT JOIN organizations o ON o.zid = p.zid
     WHERE p.zid = ? AND p.eid = ? LIMIT 1`
  ).get(input.zid, input.eid) as { year: number | null; guid: string | null } | undefined;
  const rules = await listActivePackageRules(db, {
    packageKind, year: context?.year == null ? null : Number(context.year), organizationGuid: context?.guid ?? null,
  });
  const instances = new Map<string, Awaited<ReturnType<typeof loadInstance>>>();
  const loadForm = async (formId: string) => {
    if (!instances.has(formId)) {
      const instanceId = await findInstanceIdByPackageTemplate(db, input.zid, input.eid, formId);
      instances.set(formId, instanceId ? await loadInstance(db, instanceId) : null);
    }
  };
  for (const rule of rules) {
    for (const match of rule.expressionRaw.matchAll(/\{([^;{}]+);[^;{}]+;[^{}]+\}/g)) await loadForm(match[1].trim());
  }
  const resolve = (formId: string, column: string, row: string): number | null => {
    const rows = instances.get(formId)?.rows;
    const rowData = rows?.find((candidate) =>
      [candidate.num, candidate.code, candidate.account, candidate.name].some((value) => String(value ?? "").trim() === row)
    );
    return rowData ? numeric(rowData[column]) : null;
  };
  const results: PackageCheckRunResult["results"] = rules.map((rule) => {
    const parsed = parseCheckNotation12(rule.expressionRaw);
    if (!parsed.ok || !parsed.ast) {
      return { code: rule.code, passed: false, message: `parse error: ${parsed.error}`, requiresExplanation: rule.type === "explain" };
    }
    const evaluated = evaluateCheckNotation12(parsed.ast, resolve);
    return {
      code: rule.code, passed: evaluated.passed, left: evaluated.left, right: evaluated.right,
      message: evaluated.passed ? `OK ${rule.code}` : `FAIL ${rule.code}: ${evaluated.left ?? "missing"} vs ${evaluated.right ?? "missing"}`,
      requiresExplanation: rule.type === "explain",
    };
  });
  const journal = await appendCheckRunJournal(db, {
    zid: input.zid, eid: input.eid, packageKind, actor: input.actor ?? null,
    results: [
      {
        checkType: "package_run",
        passed: results.every((result) => result.passed),
        message: `Appendix 12 package run: ${results.length} rules`,
      },
      ...results.map((result, index) => ({
      ruleNumber: rules[index]?.number ?? null, ruleCode: result.code, checkType: "appendix12",
      passed: result.passed, leftValue: result.left ?? null, rightValue: result.right ?? null,
      message: result.message, requiresExplanation: !result.passed && result.requiresExplanation,
      })),
    ],
  });
  return {
    runId: journal.runId, packageKind,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };
}
