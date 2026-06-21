import { loadRowFormulas } from "../api";
import type { FormSchema, RowData } from "../types";

export interface RowFormula {
  rowNo: number;
  formula: string;
  sign?: string | null;
}

function parseNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatNum(n: number): string | number {
  if (n === 0) return "";
  return Math.round(n * 1000) / 1000;
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

export function recalcRows(
  schema: FormSchema,
  rows: RowData[],
  formulas: RowFormula[]
): RowData[] {
  if (formulas.length === 0) return rows;

  const numericCols = schema.columns
    .filter((c) => c.type === "number")
    .map((c) => c.key);

  const rowByNum = new Map<string, RowData>();
  for (const r of rows) {
    const k = String(r.num ?? "").trim();
    if (k) rowByNum.set(k, { ...r });
  }

  for (const rule of formulas) {
    const targetKey = String(rule.rowNo);
    const target = rowByNum.get(targetKey);
    if (!target) continue;

    for (const col of numericCols) {
      const computed = evalRowFormula(rule.formula, col, rowByNum);
      target[col] = formatNum(computed);
    }
    rowByNum.set(targetKey, target);
  }

  return rows.map((r) => {
    const k = String(r.num ?? "").trim();
    return k && rowByNum.has(k) ? rowByNum.get(k)! : r;
  });
}

export async function recalcForm(
  schema: FormSchema,
  rows: RowData[]
): Promise<RowData[]> {
  const data = await loadRowFormulas();
  const formulas = data.byForm[schema.id] ?? [];
  return recalcRows(schema, rows, formulas);
}

export async function recalcAllForms(
  instances: Array<{ schema: FormSchema; rows: RowData[] }>
): Promise<RowData[][]> {
  const data = await loadRowFormulas();
  return instances.map(({ schema, rows }) =>
    recalcRows(schema, rows, data.byForm[schema.id] ?? [])
  );
}
