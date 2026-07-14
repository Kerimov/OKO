/**
 * Access CheckRelationsAccRows / FillBalanceRows on top of a__TempRows pairs.
 *
 * Source of truth for closing balance fill: N01_02 → N01_1.H
 * («На конец отч.периода»). Then J = H + I (Access recalc).
 */

import type { RowData } from "./types.js";
import {
  BALANCE_FORM_ID,
  buildTempAccountRows,
  type TempAccountRow,
} from "./aggrSetAccount.js";

/** Access a__UncheckingRows (итоги / свёртки — не лист счетов). */
export const DEFAULT_UNCHECKING_ROWS: readonly string[] = [
  "1100",
  "1111",
  "1119",
  "1171",
  "1172",
  "1173",
  "1174",
  "1191",
  "1200",
  "1210",
  "1230",
  "1231",
  "1235",
  "1241",
  "1250",
  "1300",
  "1351",
  "1370",
  "1400",
  "1410",
  "1452",
  "1500",
  "1510",
  "1520",
  "1550",
  "1600",
  "1700",
];

export const FILL_BALANCE_SOURCE_FORM = "N01_02" as const;
export const BALANCE_CLOSING_COL = "H";
export const BALANCE_AGGR_ADJ_COL = "I";
export const BALANCE_AFTER_COL = "J";

export interface RelCheckRow {
  row: string;
  debit: number;
  credit: number;
  balance: number;
  balanceH: number;
  delta: number;
  matched: boolean;
  skipped: boolean;
  name?: string;
}

export interface RelCheckDetail {
  row: string;
  account: string;
  debit: number;
  credit: number;
  balance: number;
  name?: string;
}

export interface RelationsAccRowsResult {
  ok: boolean;
  message?: string;
  compared: number;
  mismatched: number;
  skipped: number;
  rows: RelCheckRow[];
  details: RelCheckDetail[];
  tolerance: number;
}

export interface FillBalanceRowsResult {
  ok: boolean;
  message?: string;
  mode: "ifEmpty" | "overwrite";
  updated: number;
  skippedNonEmpty: number;
  skippedUnchecking: number;
  rows: RowData[];
}

function parseNum(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normRow(v: unknown): string {
  return String(v ?? "").trim();
}

export function aggregateTempByBalanceRow(
  pairs: TempAccountRow[]
): Map<string, { debit: number; credit: number; balance: number; details: RelCheckDetail[] }> {
  const map = new Map<
    string,
    { debit: number; credit: number; balance: number; details: RelCheckDetail[] }
  >();
  for (const p of pairs) {
    const row = normRow(p.row);
    if (!row) continue;
    let agg = map.get(row);
    if (!agg) {
      agg = { debit: 0, credit: 0, balance: 0, details: [] };
      map.set(row, agg);
    }
    agg.debit += p.debit;
    agg.credit += p.credit;
    agg.balance = agg.debit - agg.credit;
    agg.details.push({
      row,
      account: p.account,
      debit: p.debit,
      credit: p.credit,
      balance: p.balance,
      name: p.name,
    });
  }
  return map;
}

/**
 * Access CheckRelationsAccRows: Σ(debit/credit) by Стр. vs N01_1.H (abs).
 */
export function checkRelationsAccRows(options: {
  accRows: RowData[];
  balRows: RowData[];
  uncheckingRows?: Iterable<string>;
  tolerance?: number;
}): RelationsAccRowsResult {
  const tolerance = options.tolerance ?? 0.5; // тыс.руб. rounding
  const skip = new Set(
    [...(options.uncheckingRows ?? DEFAULT_UNCHECKING_ROWS)].map((r) => normRow(r))
  );

  if (!options.accRows.length || !options.balRows.length) {
    return {
      ok: false,
      message:
        "Не заведены данные для проверки соответствия между таблицей со счетами и таблицей со строками.",
      compared: 0,
      mismatched: 0,
      skipped: 0,
      rows: [],
      details: [],
      tolerance,
    };
  }

  const pairs = buildTempAccountRows(options.accRows);
  const byRow = aggregateTempByBalanceRow(pairs);
  const balByNum = new Map<string, RowData>();
  for (const r of options.balRows) {
    const num = normRow(r.num);
    if (num) balByNum.set(num, r);
  }

  const rows: RelCheckRow[] = [];
  const details: RelCheckDetail[] = [];
  let skipped = 0;
  let mismatched = 0;
  let compared = 0;

  const allNums = new Set([...byRow.keys(), ...balByNum.keys()]);
  for (const num of Array.from(allNums).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  })) {
    if (skip.has(num)) {
      skipped++;
      continue;
    }
    const agg = byRow.get(num);
    if (!agg) continue; // balance row without account mapping — not RelCheck scope
    const bal = balByNum.get(num);
    const balanceH = parseNum(bal?.[BALANCE_CLOSING_COL]);
    const delta = Math.abs(Math.abs(agg.balance) - Math.abs(balanceH));
    const matched = delta <= tolerance;
    compared++;
    if (!matched) mismatched++;
    rows.push({
      row: num,
      debit: agg.debit,
      credit: agg.credit,
      balance: agg.balance,
      balanceH,
      delta,
      matched,
      skipped: false,
      name: bal?.name != null ? String(bal.name) : undefined,
    });
    details.push(...agg.details);
  }

  return {
    ok: mismatched === 0 && compared > 0,
    compared,
    mismatched,
    skipped,
    rows,
    details,
    tolerance,
    message:
      compared === 0
        ? "Нет строк с привязкой счетов для сверки сумм (CheckRelationsAccRows)."
        : undefined,
  };
}

/**
 * Access FillBalanceRows: write abs(Debit−Credit) from N01_02 into N01_1.H; J = H + I.
 */
export function fillBalanceRows(options: {
  accRows: RowData[];
  balRows: RowData[];
  mode?: "ifEmpty" | "overwrite";
  uncheckingRows?: Iterable<string>;
}): FillBalanceRowsResult {
  const mode = options.mode ?? "ifEmpty";
  const skip = new Set(
    [...(options.uncheckingRows ?? DEFAULT_UNCHECKING_ROWS)].map((r) => normRow(r))
  );

  if (!options.accRows.length || !options.balRows.length) {
    return {
      ok: false,
      message:
        "Не заведены данные для проверки соответствия между таблицей со счетами и таблицей со строками.",
      mode,
      updated: 0,
      skippedNonEmpty: 0,
      skippedUnchecking: 0,
      rows: options.balRows.map((r) => ({ ...r })),
    };
  }

  const pairs = buildTempAccountRows(options.accRows);
  const byRow = aggregateTempByBalanceRow(pairs);
  let updated = 0;
  let skippedNonEmpty = 0;
  let skippedUnchecking = 0;

  const rows = options.balRows.map((r) => {
    const num = normRow(r.num);
    const next = { ...r };
    if (!num) return next;
    if (skip.has(num)) {
      skippedUnchecking++;
      return next;
    }
    const agg = byRow.get(num);
    if (!agg) return next;

    const value = Math.abs(agg.balance);
    const current = next[BALANCE_CLOSING_COL];
    const hasValue = current !== undefined && current !== null && String(current).trim() !== "";
    if (mode === "ifEmpty" && hasValue && parseNum(current) !== 0) {
      skippedNonEmpty++;
      return next;
    }
    if (parseNum(current) === value && hasValue) {
      // still refresh J
      const h = value;
      const i = parseNum(next[BALANCE_AGGR_ADJ_COL]);
      next[BALANCE_AFTER_COL] = h + i;
      return next;
    }
    next[BALANCE_CLOSING_COL] = value;
    const i = parseNum(next[BALANCE_AGGR_ADJ_COL]);
    next[BALANCE_AFTER_COL] = value + i;
    updated++;
    return next;
  });

  return {
    ok: true,
    mode,
    updated,
    skippedNonEmpty,
    skippedUnchecking,
    rows,
  };
}

export { BALANCE_FORM_ID };
