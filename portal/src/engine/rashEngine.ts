import type { RashRule, RashRulesData, RashThresholds, RowData } from "../types";
import { loadRashRules } from "../api";

export type {
  RashRule,
  RashAddsum,
  RashRulesData,
  RashThresholds,
} from "../types";

export interface RashValidationIssue {
  rowIndex: number;
  rowLabel: string;
  column: string;
  message: string;
  severity: "error" | "warning";
}

let cachedData: RashRulesData | null = null;

export async function getRashData(): Promise<RashRulesData> {
  if (cachedData) return cachedData;
  cachedData = await loadRashRules();
  return cachedData;
}

export function clearRashCache(): void {
  cachedData = null;
}

/** Parse ref_rows token like N06_11_1 → form N06_11 */
export function formIdFromRefRow(ref: string): string {
  const parts = ref.trim().split("_");
  if (parts.length < 2) return ref.trim();
  if (parts[0].startsWith("N") && parts.length >= 3) {
    return `${parts[0]}_${parts[1]}`;
  }
  return ref.trim();
}

export function getRashRulesForForm(rules: RashRule[], formId: string): RashRule[] {
  return rules.filter((r) => {
    if (!r.refRows) return false;
    return r.refRows.split(",").some((token) => {
      const fid = formIdFromRefRow(token.trim());
      return fid === formId || token.trim().startsWith(formId);
    });
  });
}

export function parseTotalColumn(formula: string | null | undefined): string | null {
  if (!formula?.trim()) return null;
  const eq = formula.indexOf("=");
  const left = (eq >= 0 ? formula.slice(0, eq) : formula).trim();
  const m = left.match(/([A-ZА-Я])\s*$/i) ?? left.match(/([A-ZА-Я])/i);
  return m ? m[1].toUpperCase() : null;
}

export function numVal(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function rashThresholdLevel(
  absValue: number,
  thresholds: RashThresholds
): 0 | 1 | 2 | 3 {
  if (absValue >= thresholds.level3) return 3;
  if (absValue >= thresholds.level2) return 2;
  if (absValue >= thresholds.level1) return 1;
  return 0;
}

export interface KontrRowGroup {
  parent: RowData;
  parentIndex: number;
  kontrRows: Array<{ row: RowData; index: number }>;
}

export function groupKontrRows(rows: RowData[]): KontrRowGroup[] {
  const groups: KontrRowGroup[] = [];
  let current: KontrRowGroup | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row.num ?? "").trim()) {
      if (current) groups.push(current);
      current = { parent: row, parentIndex: i, kontrRows: [] };
    } else if (current && String(row.name ?? "").trim()) {
      current.kontrRows.push({ row, index: i });
    }
  }
  if (current) groups.push(current);
  return groups;
}

export function validateKontrRash(
  formId: string,
  rows: RowData[],
  numericColumns: string[],
  data: RashRulesData
): RashValidationIssue[] {
  const rules = getRashRulesForForm(data.rules, formId);
  if (rules.length === 0) return [];

  const issues: RashValidationIssue[] = [];
  const groups = groupKontrRows(rows);
  const primaryRule = rules.find((r) => r.totalFormula) ?? rules[0];
  const checkColumn = parseTotalColumn(primaryRule.totalFormula) ?? "L";

  for (const group of groups) {
    const parentVal = numVal(group.parent[checkColumn]);
    const level = rashThresholdLevel(Math.abs(parentVal), data.thresholds);
    if (level === 0) continue;

    const label = String(group.parent.name ?? group.parent.num ?? group.parentIndex + 1);
    const kontrSum = group.kontrRows.reduce((s, k) => s + numVal(k.row[checkColumn]), 0);

    if (group.kontrRows.length === 0) {
      issues.push({
        rowIndex: group.parentIndex,
        rowLabel: label,
        column: checkColumn,
        severity: level >= 2 ? "error" : "warning",
        message: `Требуется расшифровка (порог ${data.thresholds.labels[level - 1]}): гр. ${checkColumn} = ${parentVal}`,
      });
      continue;
    }

    if (Math.abs(kontrSum - parentVal) > 0.01) {
      issues.push({
        rowIndex: group.parentIndex,
        rowLabel: label,
        column: checkColumn,
        severity: "error",
        message: `Сумма расшифровки (${kontrSum}) ≠ строка (${parentVal}) по гр. ${checkColumn}`,
      });
    }

    for (const col of numericColumns) {
      if (col === checkColumn || col === "num" || col === "name" || col === "code") continue;
      const p = numVal(group.parent[col]);
      if (Math.abs(p) < data.thresholds.level1) continue;
      const sum = group.kontrRows.reduce((s, k) => s + numVal(k.row[col]), 0);
      if (group.kontrRows.length > 0 && Math.abs(sum - p) > 0.01) {
        issues.push({
          rowIndex: group.parentIndex,
          rowLabel: label,
          column: col,
          severity: "warning",
          message: `Расхождение по гр. ${col}: расшифровка ${sum}, строка ${p}`,
        });
      }
    }
  }

  return issues;
}

export function countRashRulesForForm(formId: string, rules: RashRule[]): number {
  return getRashRulesForForm(rules, formId).length;
}
