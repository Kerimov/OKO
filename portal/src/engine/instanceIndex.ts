import type { OkoFormInstance, RowData } from "../types";
import type { EvalContext } from "./cellExpression";
import { loadAllInstances } from "../storage";

/** formId -> rowNum -> row data */
export type FormDataIndex = Map<string, Map<string, RowData>>;

export function buildFormIndex(instances: OkoFormInstance[]): FormDataIndex {
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

export function cellGetterFromIndex(index: FormDataIndex) {
  return (form: string, column: string, row: number): number => {
    const rowData = index.get(form)?.get(String(row));
    if (!rowData) return 0;
    return parseCellValue(rowData[column]);
  };
}

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
    if (op === "=" && Number.isFinite(num) && Number.isFinite(tNum) && num === tNum)
      return true;
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
  const fields = [row.code, row.account, row.name, row.num].map((v) =>
    String(v ?? "").trim()
  );
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

/** Build evaluation context with Cell() and CellK() lookups. */
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

export async function loadInstancesForCheck(
  filterPeriod?: { start: string; end: string }
): Promise<OkoFormInstance[]> {
  const all = await loadAllInstances();
  if (!filterPeriod?.start && !filterPeriod?.end) return all;
  return all.filter((inst) => {
    if (filterPeriod.start && inst.meta.periodStart !== filterPeriod.start)
      return false;
    if (filterPeriod.end && inst.meta.periodEnd !== filterPeriod.end)
      return false;
    return true;
  });
}

/** Latest instance per template (by updatedAt). */
export function latestInstancePerTemplate(
  instances: OkoFormInstance[]
): OkoFormInstance[] {
  const map = new Map<string, OkoFormInstance>();
  for (const inst of instances) {
    const prev = map.get(inst.templateId);
    if (!prev || inst.updatedAt > prev.updatedAt) {
      map.set(inst.templateId, inst);
    }
  }
  return Array.from(map.values());
}
