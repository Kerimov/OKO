import type {
  FormColumn,
  FormRashEntry,
  FormRowTemplate,
  KontrAgent,
  RashAddsum,
  RashRule,
  RashRulesData,
  RashThresholds,
  RowData,
} from "../types";
import { isKontrForm } from "../constants";
import { loadRashRules } from "../api";
import { numVal, rashThresholdLevel } from "@oko/engine";
import { evalColumnLetterFormula } from "@oko/spreadsheet";
import {
  rashKodForCell,
  rowMeta,
  type RowRashIndexData,
} from "./rowRashIndex";

export { numVal, rashThresholdLevel };

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

export interface RashCellSlot {
  rowNum: string;
  /** Графа расшифровки (итоговая для pattern total). */
  columnKey: string;
  /** Где показывать кнопку «…»; по умолчанию = columnKey. */
  displayColumnKey?: string;
  rashKod: number;
  rule: RashRule;
  pattern: "cell" | "total";
  /** Явная привязка из rash_placements — кнопку «…» показываем всегда. */
  fromPlacement?: boolean;
}

export interface RashEditorContext {
  formId: string;
  parentRowNo: number;
  parentRowIndex: number;
  columnKey: string;
  rashKod: number;
  rule: RashRule;
  parentLabel: string;
  parentValue: number;
  /** All form columns sharing this kod on the parent row. */
  placementColumns?: string[];
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

export interface KontrShowFilter {
  id: string;
  label: string;
  orgTypes: number[];
}

/** Варианты фильтра «Показать» в справочнике контрагентов (как в Access). */
export const KONTR_SHOW_FILTERS: KontrShowFilter[] = [
  { id: "1", label: "Внутригрупповые", orgTypes: [1] },
  { id: "1,2", label: "Внутригрупповые и Ассоциированные", orgTypes: [1, 2] },
  { id: "1,2,3", label: "Все контрагенты", orgTypes: [1, 2, 3] },
];

export function isSpecialKontr(name: string | null | undefined): boolean {
  const u = (name ?? "").trim().toUpperCase();
  return u === "ПРОЧИЕ" || u === "ФИЗИЧЕСКИЕ ЛИЦА";
}

export function effectiveOrgType(agent: KontrAgent): number | null {
  if (agent.mandatoryRash) return 2;
  return agent.orgType ?? null;
}

export function findKontrAgent(
  agents: KontrAgent[],
  name: string | null | undefined
): KontrAgent | undefined {
  const n = (name ?? "").trim();
  if (!n) return undefined;
  return agents.find((a) => a.name === n);
}

/** Минимальный порог детализации для контрагента (тыс. руб.). */
export function rashMinThresholdForAgent(
  agent: KontrAgent,
  thresholds: RashThresholds
): number {
  const t = effectiveOrgType(agent);
  if (t === 1) return thresholds.level1;
  if (t === 2) return thresholds.level2;
  if (t === 3) return thresholds.level3;
  return thresholds.level1;
}

export function defaultKontrShowFilter(refA1Name: string | null | undefined): string {
  const filter = parseRefFilter(refA1Name);
  if (!filter || filter.kind.toLowerCase() !== "контрагент") return "1,2,3";
  if (filter.allowedTypes.length === 0) return "1,2,3";
  const types = [...filter.allowedTypes].sort((a, b) => a - b);
  if (types.length === 1 && types[0] === 1) return "1";
  if (types.includes(1) && types.includes(2) && !types.includes(3)) return "1,2";
  return types.join(",");
}

export function kontrShowOptionsForRule(
  refA1Name: string | null | undefined
): KontrShowFilter[] {
  const filter = parseRefFilter(refA1Name);
  if (!filter || filter.kind.toLowerCase() !== "контрагент") {
    return KONTR_SHOW_FILTERS;
  }
  const allowed = new Set(
    filter.allowedTypes.length ? filter.allowedTypes : [1, 2, 3]
  );
  const options = KONTR_SHOW_FILTERS.filter((opt) =>
    opt.orgTypes.every((t) => allowed.has(t))
  );
  return options.length ? options : KONTR_SHOW_FILTERS;
}

export function filterKontrByShow(
  agents: KontrAgent[],
  refA1Name: string | null | undefined,
  showFilterId: string
): KontrAgent[] {
  const base = filterKontrAgents(agents, refA1Name);
  const show =
    KONTR_SHOW_FILTERS.find((f) => f.id === showFilterId) ?? KONTR_SHOW_FILTERS[1];
  const showTypes = new Set(show.orgTypes);
  const specials = base.filter((a) => isSpecialKontr(a.name));
  const filtered = base.filter((a) => {
    if (isSpecialKontr(a.name)) return false;
    const t = effectiveOrgType(a);
    return t != null && showTypes.has(t);
  });
  return [...filtered, ...specials];
}

export function formIdFromRefRow(ref: string): string {
  const parts = ref.trim().split("_");
  if (parts.length < 2) return ref.trim();
  if (parts[0].startsWith("N") && parts.length >= 3) {
    return `${parts[0]}_${parts[1]}`;
  }
  return ref.trim();
}

export function rashRuleMatchesForm(
  rule: Pick<RashRule, "name" | "refRows">,
  formId: string
): boolean {
  const name = rule.name ?? "";
  if (name === formId || name.startsWith(`${formId}_`)) return true;
  if (!rule.refRows) return false;
  return rule.refRows.split(",").some((token) => {
    const trimmed = token.trim();
    if (!trimmed) return false;
    const fid = formIdFromRefRow(trimmed);
    return fid === formId || trimmed === formId || trimmed.startsWith(`${formId}_`);
  });
}

export function getRashRulesForForm(rules: RashRule[], formId: string): RashRule[] {
  return rules.filter((r) => rashRuleMatchesForm(r, formId) && !isRashClosedKod(r.kod));
}

export function isRashClosedKod(kod: number): boolean {
  return kod === 0 || kod === 1;
}

export function countRashRulesForForm(formId: string, rules: RashRule[]): number {
  return getRashRulesForForm(rules, formId).length;
}

export function formUsesRash(formId: string, rules: RashRule[]): boolean {
  return countRashRulesForForm(formId, rules) > 0;
}

export function parseTotalColumn(formula: string | null | undefined): string | null {
  if (!formula?.trim()) return null;
  const eq = formula.indexOf("=");
  const left = (eq >= 0 ? formula.slice(0, eq) : formula).trim();
  const m = left.match(/([A-ZА-Я])\s*$/i) ?? left.match(/([A-ZА-Я])/i);
  return m ? m[1].toUpperCase() : null;
}

/** Буквы граф из правой части формулы (B+C+D-F…). */
export function parseFormulaColumns(formula: string | null | undefined): string[] {
  if (!formula?.trim()) return [];
  const eq = formula.indexOf("=");
  const rhs = (eq >= 0 ? formula.slice(eq + 1) : formula).replace(/\s/g, "");
  const cols = new Set<string>();
  for (const m of rhs.matchAll(/([A-ZА-Я])/gi)) {
    cols.add(m[1].toUpperCase());
  }
  return [...cols];
}

/** True if string looks like Access total formula `M=B+C+D-…`. */
export function looksLikeRashTotalFormula(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  const compact = raw.replace(/\s/g, "");
  return /^[A-ZА-Я]=[A-ZА-Я0-9+\-*/.()]+$/i.test(compact);
}

/** totalFormula или формула из note (напр. «M=B+C+D» в note правила 51112). */
export function effectiveRashFormula(rule: RashRule): string | null {
  const fromField = rule.totalFormula?.trim();
  if (fromField && looksLikeRashTotalFormula(fromField)) return fromField;
  const note = rule.note?.trim();
  if (!note) return null;
  const compact = note.replace(/\s/g, "");
  const m = compact.match(/([A-ZА-Я])=([A-ZА-Я+\-*/\d.()]+)/i);
  return m ? `${m[1].toUpperCase()}=${m[2]}` : null;
}

/**
 * Parse sp_rash ref attribute: "Контрагент/1, 2" → { kind, allowedTypes }.
 * For classifiers (Страна/RU,DE or Регион/31,32) all tokens go to allowedCodes
 * so numeric kods are not lost as orgType filters.
 */
export function parseRefFilter(spec: string | null | undefined): {
  kind: string;
  allowedTypes: number[];
  allowedCodes: string[];
} | null {
  if (!spec?.trim()) return null;
  const slash = spec.indexOf("/");
  const kind = (slash >= 0 ? spec.slice(0, slash) : spec).trim();
  const rest = slash >= 0 ? spec.slice(slash + 1).trim() : "";
  const allowedTypes: number[] = [];
  const allowedCodes: string[] = [];
  const isKontr = kind.toLowerCase() === "контрагент";
  if (rest) {
    for (const part of rest.split(/[,;]/)) {
      const p = part.trim();
      if (!p) continue;
      if (isKontr) {
        const n = parseInt(p, 10);
        // Access: 1/2/3 = orgType; larger numbers = OrgForm / special codes.
        if (Number.isFinite(n) && n >= 1 && n <= 3) allowedTypes.push(n);
        else allowedCodes.push(p);
      } else {
        allowedCodes.push(p);
      }
    }
  }
  return { kind, allowedTypes, allowedCodes };
}

export function filterKontrAgents(
  agents: KontrAgent[],
  refA1Name: string | null | undefined
): KontrAgent[] {
  const filter = parseRefFilter(refA1Name);
  if (!filter || filter.kind.toLowerCase() !== "контрагент") {
    return agents;
  }
  const specials = agents.filter((a) => isSpecialKontr(a.name));
  if (filter.allowedTypes.length === 0 && filter.allowedCodes.length === 0) {
    return agents;
  }
  const filtered = agents.filter((a) => {
    if (a.orgType != null && filter.allowedTypes.includes(a.orgType)) return true;
    if (filter.allowedCodes.length && a.orgForm && filter.allowedCodes.includes(a.orgForm)) {
      return true;
    }
    return false;
  });
  for (const s of specials) {
    if (!filtered.some((a) => a.id === s.id)) filtered.push(s);
  }
  return filtered.length ? filtered : agents;
}

export function refRowNums(refRows: string | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!refRows?.trim()) return set;
  for (const token of refRows.split(",")) {
    const t = token.trim();
    if (t) set.add(t);
  }
  return set;
}

export function getRashRulesForRow(
  rules: RashRule[],
  formId: string,
  rowNum: string
): RashRule[] {
  const num = rowNum.trim();
  return getRashRulesForForm(rules, formId).filter((r) => {
    if (r.refRows) {
      return refRowNums(r.refRows).has(num);
    }
    return true;
  });
}

export function resolveRashKod(
  row: FormRowTemplate | RowData,
  rules: RashRule[],
  formId: string,
  index?: RowRashIndexData,
  columnKey?: string
): number | null {
  const explicit = (row as FormRowTemplate).rashKod;
  if (explicit != null && explicit > 2) return explicit;
  const num = String(row.num ?? "").trim();
  if (!num) return null;
  if (index && columnKey) {
    const kod = rashKodForCell(index, formId, num, columnKey);
    if (kod != null) return kod;
  }
  if (index) {
    const meta = rowMeta(index, formId, num);
    if (meta?.defaultKod != null) return meta.defaultKod;
  }
  const matched = getRashRulesForRow(rules, formId, num);
  if (matched.length === 1) return matched[0].kod;
  if (matched.length > 1) {
    const withFormula = matched.find((r) => r.totalFormula);
    return (withFormula ?? matched[0]).kod;
  }
  const formRules = getRashRulesForForm(rules, formId).filter((r) => !r.refRows);
  if (formRules.length === 1) return formRules[0].kod;
  return null;
}

export function getAddsumForRule(kod: number, addsum: RashAddsum[]): RashAddsum[] {
  return addsum
    .filter((a) => a.kod === kod)
    .sort((a, b) => a.sort - b.sort);
}

export type RashAddsumInputType = "number" | "text" | "date";

export function addsumInputType(fldType: string | null | undefined): RashAddsumInputType {
  const t = (fldType ?? "").trim().toLowerCase();
  if (t.includes("дат")) return "date";
  if (t.includes("текст") || t.includes("строк") || t.includes("наимен")) return "text";
  return "number";
}

export function getRashNumericColumns(
  rule: RashRule,
  formColumns: FormColumn[],
  addsum: RashAddsum[],
  placementColumns?: string[]
): FormColumn[] {
  const keys = new Set<string>();
  const formula = effectiveRashFormula(rule);
  const totalCol = parseTotalColumn(formula);
  if (formula) {
    for (const col of parseFormulaColumns(formula)) {
      if (col !== totalCol) keys.add(col);
    }
  } else if (placementColumns && placementColumns.length > 0) {
    for (const col of placementColumns) {
      if (col && col !== "num") keys.add(col);
    }
  } else {
    for (const col of formColumns) {
      if (col.type === "number" && !["num"].includes(col.key)) keys.add(col.key);
    }
  }
  const cols: FormColumn[] = [];
  for (const key of [...keys].sort()) {
    const found = formColumns.find((c) => c.key === key);
    if (found) cols.push(found);
  }
  for (const a of getAddsumForRule(rule.kod, addsum)) {
    const input = addsumInputType(a.fldType);
    cols.push({
      key: `_addsum_${a.sort}`,
      label: a.sumTitle.trim(),
      type: input === "number" ? "number" : "text",
      width: 120,
    });
  }
  return cols;
}

/** Access t_ras: one detail set per form/row/kod — not per opened letter. */
export function rashGroupKey(rowNum: string | number, rashKod: number): string {
  return `${rowNum}:${rashKod}`;
}

function canMergeRashLines(a: FormRashEntry, b: FormRashEntry): boolean {
  // Only collapse legacy letter-scoped clones (B-save vs C-save), never two real lines.
  if (!a.columnKey || !b.columnKey) return false;
  if (a.columnKey === b.columnKey) return false;
  if (String(a.kontrId ?? "") !== String(b.kontrId ?? "")) return false;
  if ((a.kontrName?.trim() || "") !== (b.kontrName?.trim() || "")) return false;
  for (const key of Object.keys(a.values)) {
    if (key.startsWith("_addsum_")) continue;
    if (!(key in b.values)) continue;
    if (String(a.values[key] ?? "") !== String(b.values[key] ?? "")) return false;
  }
  return true;
}

/**
 * Entries for one Access subform (form/row/kod).
 * `columnKey` is ignored: opening B/C/D shares the same t_ras set.
 * Legacy per-letter duplicates are merged only when values don't conflict.
 */
export function entriesForRash(
  all: FormRashEntry[],
  formId: string,
  parentRowNo: number,
  rashKod: number,
  _columnKey?: string | null
): FormRashEntry[] {
  void _columnKey;
  const matched = all.filter(
    (e) =>
      e.formId === formId &&
      e.parentRowNo === parentRowNo &&
      e.rashKod === rashKod
  );
  const merged: FormRashEntry[] = [];
  for (const e of matched) {
    const idx = merged.findIndex((m) => canMergeRashLines(m, e));
    if (idx < 0) {
      merged.push({
        ...e,
        values: { ...e.values },
      });
      continue;
    }
    const prev = merged[idx];
    merged[idx] = {
      ...prev,
      values: { ...prev.values, ...e.values },
      attrA2: prev.attrA2 || e.attrA2,
      attrA3: prev.attrA3 || e.attrA3,
      attrA4: prev.attrA4 || e.attrA4,
      inn: prev.inn || e.inn,
      kpp: prev.kpp || e.kpp,
    };
  }
  return merged.map((e, i) => ({ ...e, lineNo: i, columnKey: null }));
}

export function entryLineTotal(
  entry: FormRashEntry,
  rule: RashRule
): number | null {
  const formula = effectiveRashFormula(rule);
  if (!formula) return null;
  return evaluateTotalFormula(formula, { ...entry.values });
}

export function evaluateTotalFormula(
  formula: string,
  row: RowData,
  columns?: string[]
): number {
  void columns;
  return evalColumnLetterFormula(formula, (letter) => numVal(row[letter]));
}

function pushSlotForColumn(
  slots: RashCellSlot[],
  num: string,
  colKey: string,
  kod: number,
  rule: RashRule,
  fromPlacement = false
): void {
  if (rule.refRows) {
    slots.push({
      rowNum: num,
      columnKey: colKey,
      rashKod: kod,
      rule,
      pattern: "cell",
      fromPlacement,
    });
    return;
  }
  const formula = effectiveRashFormula(rule);
  const totalCol = parseTotalColumn(formula);
  if (totalCol && formula) {
    const formulaCols = new Set(parseFormulaColumns(formula));
    formulaCols.add(totalCol);
    if (formulaCols.has(colKey)) {
      slots.push({
        rowNum: num,
        columnKey: totalCol,
        displayColumnKey: colKey,
        rashKod: kod,
        rule,
        pattern: "total",
        fromPlacement,
      });
      return;
    }
  }
  slots.push({
    rowNum: num,
    columnKey: colKey,
    rashKod: kod,
    rule,
    pattern: "cell",
    fromPlacement,
  });
}

function pushSlotsForDefaultRule(
  slots: RashCellSlot[],
  formId: string,
  num: string,
  kod: number,
  rule: RashRule,
  columns: FormColumn[]
): void {
  if (isKontrForm(formId) && !rule.refRows) return;

  if (rule.refRows) {
    for (const col of columns) {
      if (col.type !== "number" || col.key === "num") continue;
      pushSlotForColumn(slots, num, col.key, kod, rule);
    }
    return;
  }

  const totalCol = parseTotalColumn(effectiveRashFormula(rule));
  if (totalCol) {
    const formula = effectiveRashFormula(rule)!;
    const colsToShow = new Set(parseFormulaColumns(formula));
    colsToShow.add(totalCol);
    for (const displayCol of colsToShow) {
      slots.push({
        rowNum: num,
        columnKey: totalCol,
        displayColumnKey: displayCol,
        rashKod: kod,
        rule,
        pattern: "total",
      });
    }
    return;
  }

  for (const col of columns) {
    if (col.type !== "number" || col.key === "num") continue;
    pushSlotForColumn(slots, num, col.key, kod, rule);
  }
}

export function buildRashCellSlots(
  formId: string,
  rows: RowData[],
  columns: FormColumn[],
  rules: RashRule[],
  _thresholds: RashThresholds,
  index?: RowRashIndexData
): RashCellSlot[] {
  const slots: RashCellSlot[] = [];
  const rulesByKod = new Map(rules.map((r) => [r.kod, r]));
  const formMeta = index?.forms[formId];
  const formRules = getRashRulesForForm(rules, formId);

  for (const row of rows) {
    const num = String(row.num ?? "").trim();
    if (!num) continue;

    const meta = formMeta?.[num];
    if (meta) {
      if (meta.columns) {
        for (const [colKey, kod] of Object.entries(meta.columns)) {
          const col = columns.find((c) => c.key === colKey);
          if (!col || col.type !== "number" || colKey === "num") continue;
          const rule = rulesByKod.get(kod);
          if (!rule) continue;
          pushSlotForColumn(slots, num, colKey, kod, rule, true);
        }
      } else if (meta.defaultKod != null) {
        const rule = rulesByKod.get(meta.defaultKod);
        if (rule) {
          const before = slots.length;
          pushSlotsForDefaultRule(slots, formId, num, meta.defaultKod, rule, columns);
          for (let i = before; i < slots.length; i++) {
            slots[i] = { ...slots[i], fromPlacement: true };
          }
        }
      }
      continue;
    }

    // Form already has explicit placements: unbound rows must not get invented «…» buttons.
    if (formMeta && Object.keys(formMeta).length > 0) {
      continue;
    }

    // Legacy fallback only when the form has no placement index at all.
    const rowRules = getRashRulesForRow(formRules, formId, num);
    const rulesForRow = rowRules.length ? rowRules : formRules.filter((r) => !r.refRows);
    for (const rule of rulesForRow) {
      pushSlotsForDefaultRule(slots, formId, num, rule.kod, rule, columns);
    }
  }
  return slots;
}

export function rashSlotKey(rowNum: string, columnKey: string, rashKod: number): string {
  return `${rowNum}:${columnKey}:${rashKod}`;
}

/** Показывать кнопку «…» при сумме ≥ level1, если расшифровка уже есть, или при явной привязке. */
export function rashSlotVisible(
  slot: RashCellSlot,
  row: RowData,
  thresholds: RashThresholds,
  rashEntryCounts?: Map<string, number>
): boolean {
  if (slot.fromPlacement) return true;
  const groupKey = rashGroupKey(slot.rowNum, slot.rashKod);
  if ((rashEntryCounts?.get(groupKey) ?? 0) > 0) return true;
  // Legacy maps keyed by full slot key
  const legacyKey = rashSlotKey(slot.rowNum, slot.columnKey, slot.rashKod);
  if ((rashEntryCounts?.get(legacyKey) ?? 0) > 0) return true;
  const displayCol = slot.displayColumnKey ?? slot.columnKey;
  if (Math.abs(numVal(row[displayCol])) >= thresholds.level1) return true;
  const formula = effectiveRashFormula(slot.rule);
  if (formula && Math.abs(evaluateTotalFormula(formula, row)) >= thresholds.level1) {
    return true;
  }
  return false;
}

export function validateUnknownKontrName(
  name: string | null | undefined,
  agents: KontrAgent[],
  rowIndex: number,
  rowLabel: string,
  column: string
): RashValidationIssue | null {
  const n = (name ?? "").trim();
  if (!n || isSpecialKontr(n)) return null;
  if (findKontrAgent(agents, n)) return null;
  return {
    rowIndex,
    rowLabel,
    column,
    severity: "warning",
    message: `«${n}» нет в справочнике — выберите контрагента из списка, «ПРОЧИЕ» или «ФИЗИЧЕСКИЕ ЛИЦА»`,
  };
}

export function findRashSlot(
  slots: RashCellSlot[],
  rowNum: string,
  columnKey: string
): RashCellSlot | undefined {
  return (
    slots.find((s) => s.rowNum === rowNum && s.columnKey === columnKey) ??
    slots.find((s) => s.rowNum === rowNum && s.pattern === "total")
  );
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

/** Insert index for a new kontr child: after trailing children of the nearest parent. */
export function kontrInsertIndex(rows: RowData[], preferNearIndex?: number): number {
  let parentIdx = -1;
  const probe =
    preferNearIndex != null && Number.isFinite(preferNearIndex)
      ? Math.min(Math.max(0, preferNearIndex), Math.max(0, rows.length - 1))
      : rows.length - 1;

  for (let i = probe; i >= 0; i--) {
    if (String(rows[i]?.num ?? "").trim()) {
      parentIdx = i;
      break;
    }
  }
  if (parentIdx < 0) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i].num ?? "").trim()) parentIdx = i;
    }
  }
  if (parentIdx < 0) return rows.length;

  let insertAt = parentIdx + 1;
  while (insertAt < rows.length && !String(rows[insertAt].num ?? "").trim()) {
    insertAt++;
  }
  return insertAt;
}

export function sumRashEntries(
  entries: FormRashEntry[],
  columnKey: string
): number {
  let sum = 0;
  let hit = false;
  for (const e of entries) {
    if (e.values[columnKey] !== undefined) {
      sum += numVal(e.values[columnKey]);
      hit = true;
    }
  }
  if (hit) return sum;
  // Legacy lines that store a single amount under another letter — only when no entry
  // has the requested column (so multi-column rashes do not cross-contaminate).
  for (const e of entries) {
    const keys = Object.keys(e.values).filter((k) => !k.startsWith("_addsum_"));
    if (keys.length === 1) sum += numVal(e.values[keys[0]]);
  }
  return sum;
}

/**
 * Display total for the rash modal (same logic as syncRashToParentRow):
 * sum each formula component across lines, then evaluate rItogo; otherwise sum fallbackCol.
 */
export function sumRashSubformTotal(
  entries: FormRashEntry[],
  rule: RashRule,
  fallbackColumnKey: string
): number {
  const formula = effectiveRashFormula(rule);
  if (formula) {
    const totalCol = parseTotalColumn(formula);
    const patch: RowData = {};
    for (const col of parseFormulaColumns(formula)) {
      if (col === totalCol) continue;
      patch[col] = sumRashEntries(entries, col);
    }
    return evaluateTotalFormula(formula, patch);
  }
  return sumRashEntries(entries, fallbackColumnKey);
}

function severityForLevel(level: 0 | 1 | 2 | 3): "error" | "warning" {
  return level >= 2 ? "error" : "warning";
}

export function entryLineAmount(entry: FormRashEntry, slot: RashCellSlot): number {
  const formula = effectiveRashFormula(slot.rule);
  if (formula) {
    const pseudo: RowData = { ...entry.values };
    return Math.abs(evaluateTotalFormula(formula, pseudo));
  }
  if (entry.values[slot.columnKey] !== undefined) {
    return Math.abs(numVal(entry.values[slot.columnKey]));
  }
  const keys = Object.keys(entry.values).filter((k) => !k.startsWith("_addsum_"));
  if (keys.length === 1) return Math.abs(numVal(entry.values[keys[0]]));
  return keys.reduce((s, k) => s + Math.abs(numVal(entry.values[k])), 0);
}

export function validateKontrAmountPolicy(
  kontrName: string,
  amount: number,
  agents: KontrAgent[],
  thresholds: RashThresholds,
  rowIndex: number,
  rowLabel: string,
  column: string
): RashValidationIssue | null {
  const name = kontrName.trim();
  if (!name || isSpecialKontr(name)) return null;
  const agent = findKontrAgent(agents, name);
  if (!agent) return null;
  const absAmount = Math.abs(amount);
  const minThr = rashMinThresholdForAgent(agent, thresholds);
  if (absAmount >= minThr) return null;
  const orgType = effectiveOrgType(agent);
  const thrLabel =
    orgType === 1
      ? thresholds.labels[0]
      : orgType === 2
        ? thresholds.labels[1]
        : thresholds.labels[2];
  return {
    rowIndex,
    rowLabel,
    column,
    severity: orgType === 1 ? "warning" : "error",
    message: `«${name}»: сумма ${absAmount} ниже порога ${thrLabel} — используйте «ПРОЧИЕ»`,
  };
}

export function validateKontrEntryPolicy(
  entry: FormRashEntry,
  slot: RashCellSlot,
  agents: KontrAgent[],
  thresholds: RashThresholds,
  rowIndex: number,
  rowLabel: string
): RashValidationIssue | null {
  const name = entry.kontrName?.trim();
  if (!name) return null;
  return validateKontrAmountPolicy(
    name,
    entryLineAmount(entry, slot),
    agents,
    thresholds,
    rowIndex,
    rowLabel,
    slot.columnKey
  );
}

export function validateKontrRash(
  formId: string,
  rows: RowData[],
  numericColumns: string[],
  data: RashRulesData,
  kontrAgents: KontrAgent[] = []
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
    let kontrSum: number;
    if (primaryRule.totalFormula) {
      kontrSum = group.kontrRows.reduce(
        (s, kr) => s + evaluateTotalFormula(primaryRule.totalFormula!, kr.row),
        0
      );
    } else {
      kontrSum = group.kontrRows.reduce((s, k) => s + numVal(k.row[checkColumn]), 0);
    }

    if (group.kontrRows.length === 0) {
      issues.push({
        rowIndex: group.parentIndex,
        rowLabel: label,
        column: checkColumn,
        severity: severityForLevel(level),
        message: `Требуется расшифровка (порог ${data.thresholds.labels[level - 1]}): гр. ${checkColumn} = ${parentVal}`,
      });
      continue;
    }

    const compareVal = primaryRule.totalFormula
      ? evaluateTotalFormula(primaryRule.totalFormula, group.parent)
      : parentVal;

    if (Math.abs(kontrSum - compareVal) > 0.01) {
      issues.push({
        rowIndex: group.parentIndex,
        rowLabel: label,
        column: checkColumn,
        severity: "error",
        message: `Сумма расшифровки (${kontrSum}) ≠ строка (${compareVal}) по гр. ${checkColumn}`,
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

    if (kontrAgents.length > 0) {
      for (const kr of group.kontrRows) {
        const kName = String(kr.row.name ?? "").trim();
        const kAmount = primaryRule.totalFormula
          ? evaluateTotalFormula(primaryRule.totalFormula, kr.row)
          : numVal(kr.row[checkColumn]);
        const policy = validateKontrAmountPolicy(
          kName,
          kAmount,
          kontrAgents,
          data.thresholds,
          kr.index,
          kName || label,
          checkColumn
        );
        if (policy) issues.push(policy);
        const unknown = validateUnknownKontrName(
          kName,
          kontrAgents,
          kr.index,
          kName || label,
          checkColumn
        );
        if (unknown) issues.push(unknown);
      }
    }
  }

  return issues;
}

export function validateCellRash(
  formId: string,
  rows: RowData[],
  columns: FormColumn[],
  rashEntries: FormRashEntry[],
  data: RashRulesData,
  index?: RowRashIndexData,
  kontrAgents: KontrAgent[] = []
): RashValidationIssue[] {
  const issues: RashValidationIssue[] = [];
  const slots = buildRashCellSlots(
    formId,
    rows,
    columns,
    data.rules,
    data.thresholds,
    index
  );
  const seen = new Set<string>();

  for (const slot of slots) {
    const dedupeKey = rashGroupKey(slot.rowNum, slot.rashKod);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rowIdx = rows.findIndex((r) => String(r.num ?? "").trim() === slot.rowNum);
    if (rowIdx < 0) continue;
    const row = rows[rowIdx];
    const label = String(row.name ?? slot.rowNum);

    const entries = entriesForRash(
      rashEntries,
      formId,
      parseInt(slot.rowNum, 10),
      slot.rashKod
    );

    const formula = effectiveRashFormula(slot.rule);
    if (formula) {
      for (const col of parseFormulaColumns(formula)) {
        const rashSum = sumRashEntries(entries, col);
        const actual = numVal(row[col]);
        if (entries.length > 0 && Math.abs(actual - rashSum) > 0.01) {
          issues.push({
            rowIndex: rowIdx,
            rowLabel: label,
            column: col,
            severity: "error",
            message: `Гр. ${col}: на форме ${actual}, в расшифровке ${rashSum} (правило №${slot.rashKod})`,
          });
        }
      }
      const totalCol = parseTotalColumn(formula);
      if (totalCol && entries.length > 0) {
        const expectedM = evaluateTotalFormula(formula, row);
        const actualM = numVal(row[totalCol]);
        if (Math.abs(actualM - expectedM) > 0.01) {
          issues.push({
            rowIndex: rowIdx,
            rowLabel: label,
            column: totalCol,
            severity: "error",
            message: `Гр. ${totalCol}: итог по формуле ${expectedM}, на форме ${actualM}`,
          });
        }
      }
    } else {
      const rashSum = sumRashEntries(entries, slot.columnKey);
      const actual = numVal(row[slot.columnKey]);
      if (entries.length > 0 && Math.abs(actual - rashSum) > 0.01) {
        issues.push({
          rowIndex: rowIdx,
          rowLabel: label,
          column: slot.columnKey,
          severity: "error",
          message: `Гр. ${slot.columnKey}: на форме ${actual}, в расшифровке ${rashSum}`,
        });
      }
    }

    // Requirement level always comes from the parent form cell / total formula —
    // never from "0 when empty", otherwise mandatory slots above threshold are missed.
    const displayCol = slot.displayColumnKey ?? slot.columnKey;
    const parentValue = formula
      ? evaluateTotalFormula(formula, row)
      : numVal(row[displayCol]);
    const level = rashThresholdLevel(Math.abs(parentValue), data.thresholds);

    if (entries.length === 0 && level > 0) {
      issues.push({
        rowIndex: rowIdx,
        rowLabel: label,
        column: slot.columnKey,
        severity: severityForLevel(level),
        message: `Требуется расшифровка по правилу №${slot.rashKod} (порог ${data.thresholds.labels[level - 1]})`,
      });
      continue;
    }

    for (const e of entries) {
      if (!e.kontrName?.trim()) {
        issues.push({
          rowIndex: rowIdx,
          rowLabel: label,
          column: slot.columnKey,
          severity: "error",
          message: `Строка расшифровки без контрагента (правило №${slot.rashKod})`,
        });
        continue;
      }
      if (kontrAgents.length > 0) {
        const policy = validateKontrEntryPolicy(
          e,
          slot,
          kontrAgents,
          data.thresholds,
          rowIdx,
          label
        );
        if (policy) issues.push(policy);
        const unknown = validateUnknownKontrName(
          e.kontrName,
          kontrAgents,
          rowIdx,
          label,
          slot.columnKey
        );
        if (unknown) issues.push(unknown);
      }
    }
  }

  return issues;
}

export function validateAllRash(
  formId: string,
  rows: RowData[],
  columns: FormColumn[],
  rashEntries: FormRashEntry[],
  data: RashRulesData,
  index?: RowRashIndexData,
  kontrAgents: KontrAgent[] = []
): RashValidationIssue[] {
  const numericColumns = columns
    .filter((c) => c.type === "number")
    .map((c) => c.key);
  const issues: RashValidationIssue[] = [];

  if (isKontrForm(formId)) {
    issues.push(
      ...validateKontrRash(formId, rows, numericColumns, data, kontrAgents)
    );
  }
  issues.push(
    ...validateCellRash(
      formId,
      rows,
      columns,
      rashEntries,
      data,
      index,
      kontrAgents
    )
  );
  return issues;
}

export function rashColumnsForRule(rule: RashRule): string[] {
  const formula = effectiveRashFormula(rule);
  if (!formula) return [];
  const totalCol = parseTotalColumn(formula);
  const cols = parseFormulaColumns(formula);
  if (totalCol && !cols.includes(totalCol)) cols.push(totalCol);
  return cols;
}

/** Суммы из t_ras → ячейки родительской строки (как после закрытия подформы в Access). */
export function syncRashToParentRow(
  rows: RowData[],
  rowIndex: number,
  rashEntries: FormRashEntry[],
  formId: string,
  rashKod: number,
  rule: RashRule
): RowData[] {
  const row = rows[rowIndex];
  const num = parseInt(String(row.num ?? "").trim(), 10);
  if (!Number.isFinite(num)) return rows;

  const entries = entriesForRash(rashEntries, formId, num, rashKod);
  const patch: Record<string, string | number> = {};
  const formula = effectiveRashFormula(rule);
  const formulaCols = rashColumnsForRule(rule);
  const totalCol = parseTotalColumn(formula);

  if (formulaCols.length > 0) {
    for (const col of formulaCols) {
      if (col === totalCol) continue;
      patch[col] = sumRashEntries(entries, col);
    }
    if (totalCol && formula) {
      patch[totalCol] = evaluateTotalFormula(formula, { ...row, ...patch });
    }
  } else if (entries.length > 0) {
    const keys = new Set<string>();
    for (const e of entries) {
      for (const k of Object.keys(e.values)) {
        if (!k.startsWith("_addsum_")) keys.add(k);
      }
    }
    for (const col of keys) {
      patch[col] = sumRashEntries(entries, col);
    }
  } else if (totalCol) {
    for (const col of formulaCols) patch[col] = 0;
  }

  if (Object.keys(patch).length === 0) return rows;
  const changed = Object.entries(patch).some(
    ([k, v]) => String(row[k] ?? "") !== String(v ?? "")
  );
  if (!changed) return rows;
  return rows.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r));
}

export function syncAllRashToRows(
  formId: string,
  rows: RowData[],
  rashEntries: FormRashEntry[],
  rules: RashRule[]
): RowData[] {
  let next = rows;
  const formRules = getRashRulesForForm(rules, formId);
  const seen = new Set<string>();
  for (const e of rashEntries) {
    if (e.formId !== formId) continue;
    // One t_ras group per row+kod (Access); ignore legacy per-columnKey splits.
    const key = rashGroupKey(e.parentRowNo, e.rashKod);
    if (seen.has(key)) continue;
    seen.add(key);
    const rule = formRules.find((r) => r.kod === e.rashKod);
    if (!rule) continue;
    const rowIdx = next.findIndex((r) => String(r.num ?? "").trim() === String(e.parentRowNo));
    if (rowIdx < 0) continue;
    next = syncRashToParentRow(next, rowIdx, rashEntries, formId, e.rashKod, rule);
  }
  return next;
}
