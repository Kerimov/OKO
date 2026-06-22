import { loadChecks } from "../api";
import type { OkoFormInstance } from "../types";
import {
  combineCheckExpression,
  evaluateCheckExpression,
  expressionUsesForm,
  formatCheckErrorMessage,
} from "./cellExpression";
import {
  evalContextFromInstances,
  latestInstancePerTemplate,
  loadEvalContextForChecks,
  loadInstancesForCheck,
} from "./instanceIndex";

export interface CheckRule {
  number: number;
  expression: string;
  expressionAlt?: string | null;
  message?: string | null;
  forAggrOnly?: boolean;
  firstLevel?: boolean;
  active?: boolean;
  periodActive?: boolean;
}

export interface CheckResultItem {
  number: number;
  expression: string;
  message: string | null;
  passed: boolean;
  left: number;
  right: number;
  failedClause?: string;
  failedOp?: string;
  error?: string;
  parseError?: boolean;
}

export interface CheckRuleCounts {
  period: number;
  active: number;
  all: number;
  aggrExcluded: number;
}

export interface CheckRunResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  items: CheckResultItem[];
}

export type CheckMode = "period" | "active" | "all";

function pickRules(
  checks: CheckRule[],
  options: {
    formId?: string;
    mode?: CheckMode;
    excludeAggr?: boolean;
  }
): CheckRule[] {
  return checks.filter((c) => {
    if (!c.expression) return false;
    const mode = options.mode ?? "period";
    if (mode === "period" && !c.periodActive) return false;
    if (mode === "active" && !c.active && !c.periodActive) return false;
    if (options.excludeAggr && c.forAggrOnly) return false;
    if (options.formId) {
      const full = combineCheckExpression(c.expression, c.expressionAlt);
      if (!expressionUsesForm(full, options.formId)) return false;
    }
    return true;
  });
}

export async function getCheckRuleCounts(): Promise<CheckRuleCounts> {
  const data = await loadChecks();
  const aggrExcluded = data.checks.filter((c) => c.forAggrOnly).length;
  return {
    period: pickRules(data.checks, { mode: "period", excludeAggr: true }).length,
    active: pickRules(data.checks, { mode: "active", excludeAggr: true }).length,
    all: pickRules(data.checks, { mode: "all", excludeAggr: true }).length,
    aggrExcluded,
  };
}

function runRules(
  rules: CheckRule[],
  ctx: import("./cellExpression").EvalContext
): CheckRunResult {
  const items: CheckResultItem[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const rule of rules) {
    const fullExpression = combineCheckExpression(
      rule.expression,
      rule.expressionAlt
    );
    try {
      const { ok, left, right, failedClause, failedOp } =
        evaluateCheckExpression(fullExpression, ctx);
      const msg = rule.message ?? null;
      items.push({
        number: rule.number,
        expression: fullExpression,
        message: msg,
        passed: ok,
        left,
        right,
        failedClause,
        failedOp,
      });
      if (ok) passed++;
      else failed++;
    } catch (e) {
      skipped++;
      items.push({
        number: rule.number,
        expression: fullExpression,
        message: rule.message ?? null,
        passed: false,
        left: 0,
        right: 0,
        parseError: true,
        error: formatCheckErrorMessage(rule.number, rule.message, e),
      });
    }
  }

  return {
    total: rules.length,
    passed,
    failed,
    skipped,
    items,
  };
}

export async function runFormChecks(
  formId: string,
  instances?: OkoFormInstance[],
  mode: CheckMode = "period"
): Promise<CheckRunResult> {
  const data = await loadChecks();
  const rules = pickRules(data.checks, {
    formId,
    mode,
    excludeAggr: true,
  });
  const inst =
    instances ?? latestInstancePerTemplate(await loadInstancesForCheck());
  return runRules(rules, evalContextFromInstances(inst));
}

export async function runAllChecks(
  period?: { start: string; end: string },
  mode: CheckMode = "period"
): Promise<CheckRunResult> {
  const data = await loadChecks();
  const rules = pickRules(data.checks, {
    mode,
    excludeAggr: true,
  });
  const ctx = await loadEvalContextForChecks(period);
  return runRules(rules, ctx);
}

export async function runActiveChecks(
  instances: OkoFormInstance[],
  mode: CheckMode = "active"
): Promise<CheckRunResult> {
  const data = await loadChecks();
  const rules = pickRules(data.checks, { mode, excludeAggr: true });
  return runRules(rules, evalContextFromInstances(instances));
}
