/**
 * Access AggrSetAccount / a__TempRows / a__UnusedRows (structural subset).
 *
 * N01_01 / N01_02: Number (`num`) = счёт; slots (B,C,D)…(W,X,Y) = Стр./Дебет/Кредит → N01_1 rows.
 */

import type { RowData } from "./types.js";

export const ACC_FORM_IDS = ["N01_01", "N01_02"] as const;
export type AccFormId = (typeof ACC_FORM_IDS)[number];
export const BALANCE_FORM_ID = "N01_1";

/** Access column triplets: Стр. / Дебет / Кредит */
export const ACC_STR_SLOTS = [
  ["B", "C", "D"],
  ["E", "F", "G"],
  ["H", "I", "J"],
  ["K", "L", "M"],
  ["N", "O", "P"],
  ["Q", "R", "S"],
  ["T", "U", "V"],
  ["W", "X", "Y"],
] as const;

export interface TempAccountRow {
  account: string;
  row: string;
  debit: number;
  credit: number;
  balance: number;
  name?: string;
}

export interface AggrAccountIssue {
  kind: "blank_account" | "missing_row" | "unused_account" | "orphan_amount";
  account?: string;
  row?: string;
  name?: string;
  detail?: string;
}

export interface AggrAccountFormReport {
  formId: AccFormId;
  tempRows: number;
  unusedAccounts: Array<{ account: string; name?: string }>;
  missingRowMappings: Array<{ account: string; row: string; name?: string }>;
  blankAccountCells: Array<{ hint: string; name?: string }>;
  orphanAmounts: Array<{ account: string; name?: string }>;
  issues: AggrAccountIssue[];
}

export interface AggrAccountValidation {
  ok: boolean;
  message?: string;
  forms: AggrAccountFormReport[];
  totals: {
    tempRows: number;
    unusedAccounts: number;
    missingRowMappings: number;
    blankAccountCells: number;
    orphanAmounts: number;
  };
}

function parseNum(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function accountKey(row: RowData): string {
  return String(row.num ?? row.account ?? "").trim();
}

function rowHasAnyAmount(row: RowData): boolean {
  for (const [, d, c] of ACC_STR_SLOTS) {
    if (parseNum(row[d]) !== 0 || parseNum(row[c]) !== 0) return true;
  }
  for (const key of ["Z", "Б", "z", "б"]) {
    if (parseNum(row[key]) !== 0) return true;
  }
  return false;
}

function rowHasAnyStr(row: RowData): boolean {
  for (const [s] of ACC_STR_SLOTS) {
    if (String(row[s] ?? "").trim()) return true;
  }
  return false;
}

/** Expand N01_0x rows into a__TempRows-like pairs. */
export function buildTempAccountRows(accRows: RowData[]): TempAccountRow[] {
  const out: TempAccountRow[] = [];
  for (const r of accRows) {
    const account = accountKey(r);
    const name = r.name != null ? String(r.name) : undefined;
    for (const [s, d, c] of ACC_STR_SLOTS) {
      const row = String(r[s] ?? "").trim();
      if (!row) continue;
      if (!account) continue;
      const debit = parseNum(r[d]);
      const credit = parseNum(r[c]);
      out.push({
        account,
        row,
        debit,
        credit,
        balance: debit - credit,
        name,
      });
    }
  }
  return out;
}

export function validateAggrAccounts(options: {
  formId: AccFormId;
  accRows: RowData[];
  balRows: RowData[];
}): AggrAccountFormReport {
  const { formId, accRows, balRows } = options;
  const pairs = buildTempAccountRows(accRows);
  const balNums = new Set(
    balRows.map((r) => String(r.num ?? "").trim()).filter(Boolean)
  );

  const blankAccountCells: AggrAccountFormReport["blankAccountCells"] = [];
  const orphanAmounts: AggrAccountFormReport["orphanAmounts"] = [];
  const usedAccounts = new Set(pairs.map((p) => p.account));

  for (const r of accRows) {
    const account = accountKey(r);
    const name = r.name != null ? String(r.name) : undefined;
    const hasStr = rowHasAnyStr(r);
    const hasAmt = rowHasAnyAmount(r);

    if ((hasStr || hasAmt) && !account) {
      blankAccountCells.push({
        hint: hasStr ? "есть Стр. без номера счёта" : "есть суммы без номера счёта",
        name,
      });
    }

    if (account && hasAmt && !usedAccounts.has(account) && !hasStr) {
      orphanAmounts.push({ account, name });
    }
  }

  const missingRowMappings = pairs
    .filter((p) => !balNums.has(p.row))
    .map((p) => ({ account: p.account, row: p.row, name: p.name }));

  const unusedAccounts: AggrAccountFormReport["unusedAccounts"] = [];
  for (const r of accRows) {
    const account = accountKey(r);
    if (!account) continue;
    if (usedAccounts.has(account)) continue;
    // Catalog-like rows without amounts and without Стр. are normal labels — skip quiet zeros
    if (!rowHasAnyAmount(r) && !rowHasAnyStr(r)) continue;
    unusedAccounts.push({
      account,
      name: r.name != null ? String(r.name) : undefined,
    });
  }

  const issues: AggrAccountIssue[] = [
    ...blankAccountCells.map((b) => ({
      kind: "blank_account" as const,
      name: b.name,
      detail: b.hint,
    })),
    ...missingRowMappings.map((m) => ({
      kind: "missing_row" as const,
      account: m.account,
      row: m.row,
      name: m.name,
      detail: `Стр. ${m.row} нет в ${BALANCE_FORM_ID}`,
    })),
    ...unusedAccounts.map((u) => ({
      kind: "unused_account" as const,
      account: u.account,
      name: u.name,
      detail: "счёт без привязки к строкам баланса (a__UnusedRows)",
    })),
    ...orphanAmounts.map((o) => ({
      kind: "orphan_amount" as const,
      account: o.account,
      name: o.name,
      detail: "суммы без колонок Стр.",
    })),
  ];

  return {
    formId,
    tempRows: pairs.length,
    unusedAccounts,
    missingRowMappings,
    blankAccountCells,
    orphanAmounts,
    issues,
  };
}

export function validateAggrAccountPackage(options: {
  forms: Array<{ formId: AccFormId; accRows: RowData[] }>;
  balRows: RowData[] | null;
}): AggrAccountValidation {
  if (!options.balRows || options.balRows.length === 0) {
    const anyAcc = options.forms.some((f) => f.accRows.length > 0);
    if (!anyAcc) {
      return {
        ok: false,
        message:
          "Не заведены данные для проверки соответствия между таблицей со счетами и таблицей со строками.",
        forms: [],
        totals: {
          tempRows: 0,
          unusedAccounts: 0,
          missingRowMappings: 0,
          blankAccountCells: 0,
          orphanAmounts: 0,
        },
      };
    }
    return {
      ok: false,
      message:
        "Не заведены данные для проверки соответствия между таблицей со счетами и таблицей со строками.",
      forms: [],
      totals: {
        tempRows: 0,
        unusedAccounts: 0,
        missingRowMappings: 0,
        blankAccountCells: 0,
        orphanAmounts: 0,
      },
    };
  }

  if (options.forms.every((f) => f.accRows.length === 0)) {
    return {
      ok: false,
      message:
        "Не заведены данные для проверки соответствия между таблицей со счетами и таблицей со строками.",
      forms: [],
      totals: {
        tempRows: 0,
        unusedAccounts: 0,
        missingRowMappings: 0,
        blankAccountCells: 0,
        orphanAmounts: 0,
      },
    };
  }

  const forms = options.forms
    .filter((f) => f.accRows.length > 0)
    .map((f) =>
      validateAggrAccounts({
        formId: f.formId,
        accRows: f.accRows,
        balRows: options.balRows!,
      })
    );

  const totals = {
    tempRows: forms.reduce((n, f) => n + f.tempRows, 0),
    unusedAccounts: forms.reduce((n, f) => n + f.unusedAccounts.length, 0),
    missingRowMappings: forms.reduce((n, f) => n + f.missingRowMappings.length, 0),
    blankAccountCells: forms.reduce((n, f) => n + f.blankAccountCells.length, 0),
    orphanAmounts: forms.reduce((n, f) => n + f.orphanAmounts.length, 0),
  };

  const issueCount =
    totals.unusedAccounts +
    totals.missingRowMappings +
    totals.blankAccountCells +
    totals.orphanAmounts;

  return {
    ok: issueCount === 0,
    forms,
    totals,
  };
}
