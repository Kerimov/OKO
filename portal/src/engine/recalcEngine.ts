import { loadRecalcRules, loadRowFormulas } from "../api";
import type { FormSchema, RowData } from "../types";

export interface RowFormula {
  rowNo: number;
  formula: string;
  sign?: string | null;
}

export type RecalcRule =
  | { kind: "rows"; rowNo: number; formula: string; sign?: string | null }
  | { kind: "copyRow"; rowNo: number; sourceRow: number }
  | { kind: "columnSum"; rowNo: number; columns: string }
  | { kind: "horizontalSum"; column: string; sourceColumns: string[] };

function parseNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatNum(n: number): string | number {
  if (n === 0) return "";
  return Math.round(n * 1000) / 1000;
}

function parseColumns(spec: string): string[] {
  const out: string[] = [];
  for (const ch of spec.replace(/\s/g, "")) {
    if (/[A-ZА-Я]/i.test(ch)) out.push(ch.toUpperCase());
  }
  return out;
}

function rowIndexByNum(rows: RowData[], rowNo: number): number {
  const key = String(rowNo);
  return rows.findIndex((r) => String(r.num ?? "").trim() === key);
}

function cloneRows(rows: RowData[]): RowData[] {
  return rows.map((r) => ({ ...r }));
}

/** Sum/subtract row refs like `1111+1119` or `1210+1215-1220`. */
function evalRowFormula(
  formula: string,
  col: string,
  rowByNum: Map<string, RowData>
): number {
  let total = 0;
  let op: "+" | "-" = "+";
  for (const part of formula.split(/(?=[+-])/)) {
    let p = part.trim();
    if (!p) continue;
    if (p[0] === "+") {
      op = "+";
      p = p.slice(1).trim();
    } else if (p[0] === "-") {
      op = "-";
      p = p.slice(1).trim();
    }
    const val = parseNum(rowByNum.get(p)?.[col]);
    total = op === "+" ? total + val : total - val;
  }
  return total;
}

function applyCopyRowRules(rows: RowData[], rules: RecalcRule[]): RowData[] {
  const next = cloneRows(rows);
  const numericKeys = new Set<string>();
  for (const r of next) {
    for (const [k, v] of Object.entries(r)) {
      if (k === "num" || k === "name" || k === "code") continue;
      if (parseNum(v) !== 0 || (v !== "" && v !== undefined)) numericKeys.add(k);
    }
  }

  for (const rule of rules) {
    if (rule.kind !== "copyRow") continue;
    const ti = rowIndexByNum(next, rule.rowNo);
    const si = rowIndexByNum(next, rule.sourceRow);
    if (ti < 0 || si < 0) continue;
    for (const key of numericKeys) {
      next[ti][key] = next[si][key] ?? "";
    }
  }
  return next;
}

function applyRowFormulaRules(
  schema: FormSchema,
  rows: RowData[],
  rules: RecalcRule[]
): RowData[] {
  const rowRules = rules.filter((r): r is Extract<RecalcRule, { kind: "rows" }> => r.kind === "rows");
  if (rowRules.length === 0) return rows;

  const numericCols = schema.columns
    .filter((c) => c.type === "number")
    .map((c) => c.key);

  const rowByNum = new Map<string, RowData>();
  for (const r of rows) {
    const k = String(r.num ?? "").trim();
    if (k) rowByNum.set(k, { ...r });
  }

  for (const rule of rowRules) {
    const targetKey = String(rule.rowNo);
    const target = rowByNum.get(targetKey);
    if (!target) continue;
    for (const col of numericCols) {
      target[col] = formatNum(evalRowFormula(rule.formula, col, rowByNum));
    }
    rowByNum.set(targetKey, target);
  }

  return rows.map((r) => {
    const k = String(r.num ?? "").trim();
    return k && rowByNum.has(k) ? rowByNum.get(k)! : r;
  });
}

function isTotalRowNum(rowNo: number, rules: RecalcRule[]): boolean {
  return rules.some(
    (r) =>
      (r.kind === "columnSum" || r.kind === "copyRow" || r.kind === "rows") && r.rowNo === rowNo
  );
}

function applyColumnSumRules(rows: RowData[], rules: RecalcRule[]): RowData[] {
  const sumRules = rules
    .filter((r): r is Extract<RecalcRule, { kind: "columnSum" }> => r.kind === "columnSum")
    .map((r) => ({ ...r, idx: rowIndexByNum(rows, r.rowNo), cols: parseColumns(r.columns) }))
    .filter((r) => r.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (sumRules.length === 0) return rows;

  const next = cloneRows(rows);
  let sectionStart = 0;

  for (const rule of sumRules) {
    for (const col of rule.cols) {
      let sum = 0;
      for (let j = sectionStart; j < rule.idx; j++) {
        const num = String(next[j].num ?? "").trim();
        if (!num) continue;
        if (isTotalRowNum(parseInt(num, 10), rules)) continue;
        sum += parseNum(next[j][col]);
      }
      next[rule.idx][col] = formatNum(sum);
    }
    sectionStart = rule.idx + 1;
  }

  return next;
}

function applyHorizontalSumRules(
  rows: RowData[],
  rules: RecalcRule[]
): RowData[] {
  const hRules = rules.filter(
    (r): r is Extract<RecalcRule, { kind: "horizontalSum" }> => r.kind === "horizontalSum"
  );
  if (hRules.length === 0) return rows;

  const next = cloneRows(rows);
  for (let i = 0; i < next.length; i++) {
    const row = next[i];
    if (!String(row.num ?? "").trim()) continue;
    for (const rule of hRules) {
      let sum = 0;
      for (const src of rule.sourceColumns) {
        sum += parseNum(row[src]);
      }
      row[rule.column] = formatNum(sum);
    }
    next[i] = row;
  }
  return next;
}

function mergeRules(
  modern: RecalcRule[] | undefined,
  legacy: RowFormula[] | undefined
): RecalcRule[] {
  const out: RecalcRule[] = [...(modern ?? [])];
  const haveRow = new Set(
    out.filter((r) => r.kind === "rows").map((r) => (r as { rowNo: number }).rowNo)
  );
  for (const lf of legacy ?? []) {
    if (haveRow.has(lf.rowNo)) continue;
    out.push({ kind: "rows", rowNo: lf.rowNo, formula: lf.formula, sign: lf.sign });
  }
  return out;
}

export function recalcRowsFull(
  schema: FormSchema,
  rows: RowData[],
  rules: RecalcRule[]
): RowData[] {
  if (rules.length === 0) return rows;

  let next = cloneRows(rows);
  next = applyCopyRowRules(next, rules);

  for (let pass = 0; pass < 6; pass++) {
    const prev = JSON.stringify(next);
    next = applyRowFormulaRules(schema, next, rules);
    if (JSON.stringify(next) === prev) break;
  }

  next = applyColumnSumRules(next, rules);
  next = applyHorizontalSumRules(next, rules);
  return next;
}

/** @deprecated use recalcRowsFull */
export function recalcRows(
  schema: FormSchema,
  rows: RowData[],
  formulas: RowFormula[]
): RowData[] {
  const rules: RecalcRule[] = formulas.map((f) => ({
    kind: "rows",
    rowNo: f.rowNo,
    formula: f.formula,
    sign: f.sign,
  }));
  return recalcRowsFull(schema, rows, rules);
}

function rulesForForm(
  modern: Awaited<ReturnType<typeof loadRecalcRules>> | null,
  legacy: Awaited<ReturnType<typeof loadRowFormulas>> | null,
  formId: string
): RecalcRule[] {
  return mergeRules(
    modern?.byForm[formId] as RecalcRule[] | undefined,
    legacy?.byForm[formId]
  );
}

export async function recalcForm(
  schema: FormSchema,
  rows: RowData[]
): Promise<RowData[]> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);

  const rules = rulesForForm(modern, legacy, schema.id);

  return recalcRowsFull(schema, rows, rules);
}

export async function countRecalcRules(formId: string): Promise<number> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);
  return rulesForForm(modern, legacy, formId).length;
}

export async function recalcAllForms(
  instances: Array<{ schema: FormSchema; rows: RowData[] }>
): Promise<RowData[][]> {
  const [modern, legacy] = await Promise.all([
    loadRecalcRules().catch(() => null),
    loadRowFormulas().catch(() => null),
  ]);

  return instances.map(({ schema, rows }) => {
    const rules = rulesForForm(modern, legacy, schema.id);
    return recalcRowsFull(schema, rows, rules);
  });
}
