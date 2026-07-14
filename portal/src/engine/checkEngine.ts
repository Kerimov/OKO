import { loadChecks, loadReorgChecks, type ReorgCheckVariant } from "../api";
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
import { runFormChecksWithData } from "./checkRunCore";

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
  /** Access CheckItReorg variant when running reorg catalogue. */
  reorgVariant?: ReorgCheckVariant;
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
  rules: Array<CheckRule & { reorgVariant?: ReorgCheckVariant }>,
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
        reorgVariant: rule.reorgVariant,
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
        reorgVariant: rule.reorgVariant,
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
  const inst =
    instances ?? latestInstancePerTemplate(await loadInstancesForCheck());
  return runFormChecksWithData(data.checks, formId, inst, mode);
}

export async function runAllChecks(
  scope?: {
    start?: string;
    end?: string;
    zid?: number | null;
    eid?: number | null;
  },
  mode: CheckMode = "period"
): Promise<CheckRunResult> {
  const data = await loadChecks();
  const rules = pickRules(data.checks, {
    mode,
    excludeAggr: true,
  });
  const ctx = await loadEvalContextForChecks(scope);
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

/** Rules marked forAggrOnly — run after package aggregation (Access Aggr*). */
export async function runAggregationChecks(
  formId?: string,
  instances?: OkoFormInstance[],
  mode: CheckMode = "all"
): Promise<CheckRunResult> {
  const data = await loadChecks();
  const rules = pickRules(data.checks, { formId, mode, excludeAggr: false }).filter(
    (c) => c.forAggrOnly
  );
  const inst =
    instances ?? latestInstancePerTemplate(await loadInstancesForCheck());
  return runRules(rules, evalContextFromInstances(inst));
}

export interface RunReorgChecksOptions {
  /** Access CheckItReorg / CheckItReorg2 / CheckItReorg3 (/ Reorg4 snapshot). Default 2+3. */
  variants?: ReorgCheckVariant[];
  formId?: string;
  instances?: OkoFormInstance[];
  /** Optional org name filter for variant 1/4 snapshots (`Reorg` column). */
  reorgOrg?: string | null;
}

/**
 * Access CheckItReorg* — separate catalogues with CELL_sv (not forAggrOnly).
 * Call after AggrSetReorg* / colorMode свод.
 */
export async function runReorgChecks(
  options: RunReorgChecksOptions = {}
): Promise<CheckRunResult> {
  const data = await loadReorgChecks();
  const variants = new Set(options.variants ?? ([2, 3] as ReorgCheckVariant[]));
  const orgFilter = options.reorgOrg?.trim().toLowerCase() || null;

  const rules = data.checks
    .filter((c) => variants.has(c.variant as ReorgCheckVariant))
    .filter((c) => {
      if (!orgFilter) return true;
      if (c.variant !== 1 && c.variant !== 4) return true;
      const name = (c.reorg ?? "").trim().toLowerCase();
      return !name || name.includes(orgFilter) || orgFilter.includes(name);
    })
    .filter((c) => {
      if (!options.formId) return true;
      const full = combineCheckExpression(c.expression, c.expressionAlt);
      return expressionUsesForm(full, options.formId);
    })
    .map((c) => ({
      number: Number(c.number),
      expression: c.expression,
      expressionAlt: c.expressionAlt,
      message: c.message,
      reorgVariant: c.variant as ReorgCheckVariant,
    }));

  const inst =
    options.instances ??
    latestInstancePerTemplate(await loadInstancesForCheck());
  return runRules(rules, evalContextFromInstances(inst));
}

/** Map Tools colorMode/reorg flags → CheckItReorg* variants to run. */
export function reorgVariantsForRun(opts: {
  colorMode: string;
  reorg: boolean;
}): ReorgCheckVariant[] | null {
  if (opts.colorMode === "full" && !opts.reorg) return null;
  if (opts.reorg) return [1, 2, 3, 4];
  return [2, 3];
}
