/**
 * Access FillRequiredRows / tblRequiredSch — validation side.
 * For each chart account on N01_01/N01_02 that has activity, required balance
 * Стр. rows from tblRequiredSch must be mapped.
 */

import {
  ACC_FORM_IDS,
  BALANCE_FORM_ID,
  buildTempAccountRows,
  type AccFormId,
} from "./aggrSetAccount.js";
import type { RowData } from "./types.js";

export interface RequiredSchItem {
  account: number;
  rowNumber: number;
  row: number;
  rowOld?: number;
}

export interface RequiredSchIssue {
  kind: "missing_required_row" | "missing_balance_form" | "missing_account_form";
  formId?: AccFormId;
  account: string;
  row?: string;
  message: string;
}

export interface RequiredSchCheckResult {
  ok: boolean;
  checkedAccounts: number;
  issues: RequiredSchIssue[];
}

export interface RequiredRowSlotItem {
  /** Account code (kod). */
  account: string;
  /** Slot ordinal from refs tblRequiredRow.value (1..N). */
  slot: number;
}

function accountKey(row: RowData): string {
  return String(row.num ?? row.account ?? "").trim();
}

function parseNum(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowHasActivity(row: RowData): boolean {
  for (const key of Object.keys(row)) {
    if (["num", "name", "code", "account", "id"].includes(key)) continue;
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw === "string" && !String(raw).trim()) continue;
    if (Number.isNaN(Number(String(raw).replace(",", ".")))) {
      if (String(raw).trim()) return true;
    } else if (parseNum(raw) !== 0) {
      return true;
    }
  }
  return false;
}

/** Build Map account → set of required balance row numbers (as strings). */
export function indexRequiredSch(
  items: RequiredSchItem[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const item of items) {
    const account = String(item.account).trim();
    if (!account) continue;
    let set = map.get(account);
    if (!set) {
      set = new Set();
      map.set(account, set);
    }
    set.add(String(item.row).trim());
    if (item.rowOld != null) set.add(String(item.rowOld).trim());
  }
  return map;
}

/** Min number of Стр. slots required per account (from tblRequiredRow). */
export function indexRequiredRowMinSlots(
  items: RequiredRowSlotItem[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const account = String(item.account).trim();
    if (!account) continue;
    const slot = Number(item.slot);
    if (!Number.isFinite(slot) || slot <= 0) continue;
    map.set(account, Math.max(map.get(account) ?? 0, slot));
  }
  return map;
}

/**
 * Validate that accounts with activity on N01_0x map all RequiredSch Стр. slots
 * and have at least tblRequiredRow min slot count.
 */
export function checkRequiredSch(options: {
  items: RequiredSchItem[];
  forms: Partial<Record<AccFormId, RowData[] | null | undefined>>;
  balanceRows?: RowData[] | null;
  /** Optional refs tblRequiredRow — min Стр. count per account. */
  requiredRowSlots?: RequiredRowSlotItem[];
}): RequiredSchCheckResult {
  const requiredByAccount = indexRequiredSch(options.items);
  const minSlots = indexRequiredRowMinSlots(options.requiredRowSlots ?? []);
  const issues: RequiredSchIssue[] = [];
  let checkedAccounts = 0;

  const hasAnyAccForm = ACC_FORM_IDS.some(
    (id) => (options.forms[id]?.length ?? 0) > 0
  );
  if (!hasAnyAccForm) {
    return { ok: true, checkedAccounts: 0, issues: [] };
  }

  const balNums = new Set(
    (options.balanceRows ?? [])
      .map((r) => String(r.num ?? "").trim())
      .filter(Boolean)
  );

  for (const formId of ACC_FORM_IDS) {
    const accRows = options.forms[formId];
    if (!accRows?.length) continue;

    const pairs = buildTempAccountRows(accRows);
    const mappedByAccount = new Map<string, Set<string>>();
    for (const p of pairs) {
      let set = mappedByAccount.get(p.account);
      if (!set) {
        set = new Set();
        mappedByAccount.set(p.account, set);
      }
      set.add(p.row);
    }

    for (const row of accRows) {
      const account = accountKey(row);
      if (!account) continue;
      if (!rowHasActivity(row) && !mappedByAccount.has(account)) continue;

      const required = requiredByAccount.get(account);
      const minCount = minSlots.get(account) ?? 0;
      if ((!required || required.size === 0) && minCount <= 0) continue;

      checkedAccounts += 1;
      const mapped = mappedByAccount.get(account) ?? new Set();

      if (required) {
        for (const need of required) {
          if (!mapped.has(need)) {
            issues.push({
              kind: "missing_required_row",
              formId,
              account,
              row: need,
              message: `${formId}: счёт ${account} — нет обязательной Стр. ${need} (tblRequiredSch)`,
            });
            continue;
          }
          if (options.balanceRows && !balNums.has(need)) {
            issues.push({
              kind: "missing_balance_form",
              formId,
              account,
              row: need,
              message: `${formId}: счёт ${account} — обязательная Стр. ${need} отсутствует в ${BALANCE_FORM_ID}`,
            });
          }
        }
      }

      if (minCount > 0 && mapped.size < minCount) {
        issues.push({
          kind: "missing_required_row",
          formId,
          account,
          message: `${formId}: счёт ${account} — нужно минимум ${minCount} Стр. (tblRequiredRow), сейчас ${mapped.size}`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedAccounts,
    issues,
  };
}
