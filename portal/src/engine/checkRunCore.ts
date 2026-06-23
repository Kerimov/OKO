import type { OkoFormInstance, RowData } from "../types";
import {
  combineCheckExpression,
  evaluateCheckExpression,
  expressionUsesForm,
  extractCellKRefs,
  extractCellRefs,
  formatCheckErrorMessage,
  type EvalContext,
} from "./cellExpression";

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

export interface CheckRunResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  items: CheckResultItem[];
}

export type CheckMode = "period" | "active" | "all";

type FormDataIndex = Map<string, Map<string, RowData>>;

function parseCellValue(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseConditionValue(raw: string): number | string {
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : raw;
}

function rowMatchesCondition(row: RowData, condition: string): boolean {
  const m = /^([=<>]+)(.+)$/.exec(condition.trim());
  if (!m) return false;
  const op = m[1];
  const target = parseConditionValue(m[2].trim());
  const candidates = [row.num, row.code, row.account].filter(
    (v) => v !== undefined && v !== null && String(v).trim() !== ""
  );

  for (const candidate of candidates) {
    const num = parseFloat(String(candidate).replace(",", "."));
    const tNum = typeof target === "number" ? target : parseFloat(String(target));
    if (op === "=" && String(candidate) === String(target)) return true;
    if (op === "=" && Number.isFinite(num) && Number.isFinite(tNum) && num === tNum) return true;
    if (Number.isFinite(num) && Number.isFinite(tNum)) {
      if (op === "<" && num < tNum) return true;
      if (op === ">" && num > tNum) return true;
      if (op === "<=" && num <= tNum) return true;
      if (op === ">=" && num >= tNum) return true;
      if (op === "<>" && num !== tNum) return true;
    }
  }
  return false;
}

function rowMatchesKey(row: RowData, rowKey: string): boolean {
  const key = rowKey.trim();
  if (!key) return true;
  const fields = [row.code, row.account, row.name, row.num].map((v) => String(v ?? "").trim());
  return fields.some((f) => f === key || (f.length > 0 && f.includes(key)));
}

function getCellKValue(
  rows: RowData[],
  column: string,
  condition: string,
  rowKey: string
): number {
  let sum = 0;
  let found = false;
  for (const row of rows) {
    if (!rowMatchesCondition(row, condition)) continue;
    if (!rowMatchesKey(row, rowKey)) continue;
    sum += parseCellValue(row[column]);
    found = true;
  }
  return found ? sum : 0;
}

function buildFormIndex(instances: OkoFormInstance[]): FormDataIndex {
  const index: FormDataIndex = new Map();
  for (const inst of instances) {
    const rowMap = new Map<string, RowData>();
    for (const row of inst.rows) {
      const key = String(row.num ?? "").trim();
      if (key) rowMap.set(key, row);
    }
    index.set(inst.templateId, rowMap);
  }
  return index;
}

function cellGetterFromIndex(index: FormDataIndex) {
  return (form: string, column: string, row: number): number => {
    const rowData = index.get(form)?.get(String(row));
    if (!rowData) return 0;
    return parseCellValue(rowData[column]);
  };
}

export function evalContextFromInstances(instances: OkoFormInstance[]): EvalContext {
  const index = buildFormIndex(instances);
  const rowsByForm = new Map<string, RowData[]>();
  for (const inst of instances) {
    rowsByForm.set(inst.templateId, inst.rows);
  }
  return {
    getCell: cellGetterFromIndex(index),
    getCellK(form, column, condition, rowKey) {
      const rows = rowsByForm.get(form) ?? [];
      return getCellKValue(rows, column, condition, rowKey);
    },
    getTotal(form, column) {
      const rows = rowsByForm.get(form) ?? [];
      let sum = 0;
      for (const row of rows) {
        sum += parseCellValue(row[column]);
      }
      return sum;
    },
  };
}

export function latestInstancePerTemplate(instances: OkoFormInstance[]): OkoFormInstance[] {
  const map = new Map<string, OkoFormInstance>();
  for (const inst of instances) {
    const prev = map.get(inst.templateId);
    if (!prev || inst.updatedAt > prev.updatedAt) {
      map.set(inst.templateId, inst);
    }
  }
  return Array.from(map.values());
}

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

const TOTAL_FORM_RE = /TOTAL\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/gi;

/** Form template ids referenced by period checks for one form (for lazy instance load). */
export function formsUsedByFormChecks(
  checks: CheckRule[],
  formId: string,
  mode: CheckMode = "period"
): Set<string> {
  const forms = new Set<string>([formId]);
  const rules = pickRules(checks, { formId, mode, excludeAggr: true });
  for (const rule of rules) {
    const full = combineCheckExpression(rule.expression, rule.expressionAlt);
    for (const ref of extractCellRefs(full)) forms.add(ref.form);
    for (const ref of extractCellKRefs(full)) forms.add(ref.form);
    TOTAL_FORM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOTAL_FORM_RE.exec(full)) !== null) {
      forms.add(m[1]);
    }
  }
  return forms;
}

function runRules(rules: CheckRule[], ctx: EvalContext): CheckRunResult {
  const items: CheckResultItem[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const rule of rules) {
    const fullExpression = combineCheckExpression(rule.expression, rule.expressionAlt);
    try {
      const { ok, left, right, failedClause, failedOp } = evaluateCheckExpression(
        fullExpression,
        ctx
      );
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

  return { total: rules.length, passed, failed, skipped, items };
}

export function runFormChecksWithData(
  checks: CheckRule[],
  formId: string,
  instances: OkoFormInstance[],
  mode: CheckMode = "period"
): CheckRunResult {
  const rules = pickRules(checks, { formId, mode, excludeAggr: true });
  const inst = latestInstancePerTemplate(instances);
  return runRules(rules, evalContextFromInstances(inst));
}
