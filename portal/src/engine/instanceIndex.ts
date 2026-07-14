import type { OkoFormInstance, RowData } from "../types";
import type { EvalContext } from "./cellExpression";
import {
  loadAllInstances,
  loadInstance,
  listInstances,
  isBackendMode,
} from "../storage";
import { fetchEvalSnapshot } from "../api";

/** Scope for check evaluation: prefer ZID/EID package; fall back to period dates. */
export type CheckScopeFilter = {
  start?: string;
  end?: string;
  zid?: number | null;
  eid?: number | null;
};

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
  return evalContextFromRowsAndIndex(rowsByForm, index);
}

function evalContextFromRowsAndIndex(
  rowsByForm: Map<string, RowData[]>,
  index: FormDataIndex
): EvalContext {
  return {
    getCell: cellGetterFromIndex(index),
    getCellSv: cellGetterFromIndex(index),
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

export function evalContextFromSnapshot(snapshot: {
  rowsByForm: Record<string, RowData[]>;
  cellIndex: Record<string, Record<string, Record<string, number>>>;
}): EvalContext {
  const rowsByForm = new Map<string, RowData[]>();
  for (const [formId, rows] of Object.entries(snapshot.rowsByForm)) {
    rowsByForm.set(formId, rows);
  }
  return {
    getCell(form, column, row) {
      return snapshot.cellIndex[form]?.[String(row)]?.[column] ?? 0;
    },
    getCellSv(form, column, row) {
      return snapshot.cellIndex[form]?.[String(row)]?.[column] ?? 0;
    },
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

export async function loadEvalContextForChecks(
  filter?: CheckScopeFilter
): Promise<EvalContext> {
  const scoped =
    filter?.zid != null ||
    filter?.eid != null ||
    !!filter?.start ||
    !!filter?.end;
  // Global snapshot mixes orgs — only use it when no package/period filter is set.
  if (isBackendMode() && !scoped) {
    const snapshot = await fetchEvalSnapshot();
    if (snapshot) return evalContextFromSnapshot(snapshot);
  }
  const instances = latestInstancePerTemplate(await loadInstancesForCheck(filter));
  return evalContextFromInstances(instances);
}

function numId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Pure filter used by loadInstancesForCheck (also covered by unit tests). */
export function instanceMatchesCheckScope(
  inst: Pick<OkoFormInstance, "zid" | "eid" | "meta">,
  filter?: CheckScopeFilter
): boolean {
  if (!filter) return true;
  if (filter.start && inst.meta.periodStart !== filter.start) return false;
  if (filter.end && inst.meta.periodEnd !== filter.end) return false;
  if (filter.zid != null) {
    const z = numId(inst.zid);
    if (z != null && z !== filter.zid) return false;
  }
  if (filter.eid != null) {
    const e = numId(inst.eid);
    if (e != null && e !== filter.eid) return false;
  }
  return true;
}

export async function loadInstancesForCheck(
  filter?: CheckScopeFilter
): Promise<OkoFormInstance[]> {
  if (filter?.zid != null && filter?.eid != null) {
    const summaries = await listInstances({ zid: filter.zid, eid: filter.eid });
    const out: OkoFormInstance[] = [];
    for (const s of summaries) {
      const inst = await loadInstance(s.instanceId);
      if (inst) {
        out.push({
          ...inst,
          zid: numId(inst.zid) ?? filter.zid,
          eid: numId(inst.eid) ?? filter.eid,
        });
      }
    }
    return out;
  }

  const all = await loadAllInstances();
  if (!filter?.start && !filter?.end && filter?.zid == null && filter?.eid == null) {
    return all;
  }
  return all.filter((inst) => instanceMatchesCheckScope(inst, filter));
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
