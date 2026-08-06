import type { RashRefItem } from "./rashRefs";
import { LOAN_NZS_GROUPS, type LoanNzsItem, type LoansNzsPackage } from "./refsPackage";

export function findDuplicateCodes(items: RashRefItem[]): string[] {
  const seen = new Map<string, number>();
  const dups = new Set<string>();
  for (const it of items) {
    const kod = String(it.kod ?? "").trim();
    if (!kod) continue;
    const n = (seen.get(kod) ?? 0) + 1;
    seen.set(kod, n);
    if (n > 1) dups.add(kod);
  }
  return [...dups];
}

export function validateClassifierItems(
  items: RashRefItem[],
  opts?: { allowEmpty?: boolean; ruleCount?: number }
): string[] {
  const errors: string[] = [];
  const cleaned = items.filter((it) => String(it.kod ?? "").trim() || String(it.value ?? "").trim());
  if (!opts?.allowEmpty && cleaned.length === 0) {
    if ((opts?.ruleCount ?? 0) > 0) {
      errors.push("Нельзя сохранить пустой справочник — он используется в правилах расшифровок");
    } else {
      errors.push("Нельзя сохранить пустой справочник — добавьте хотя бы одну запись");
    }
  }
  for (const it of cleaned) {
    if (!String(it.kod ?? "").trim()) {
      errors.push(`У записи «${String(it.value ?? "").slice(0, 40)}» нет кода`);
      break;
    }
    if (!String(it.value ?? "").trim()) {
      errors.push(`У кода «${String(it.kod ?? "").slice(0, 40)}» нет значения`);
      break;
    }
  }
  const dups = findDuplicateCodes(cleaned);
  if (dups.length > 0) {
    errors.push(`Дублирующиеся коды: ${dups.slice(0, 5).join(", ")}${dups.length > 5 ? "…" : ""}`);
  }
  return errors;
}

/** ИНН: 10 или 12 цифр; пустое допустимо. */
export function validateInn(inn: string | null | undefined): string | null {
  const v = (inn ?? "").trim();
  if (!v) return null;
  if (!/^\d{10}$|^\d{12}$/.test(v)) return "ИНН должен содержать 10 или 12 цифр";
  return null;
}

/** КПП: 9 цифр; пустое допустимо. */
export function validateKpp(kpp: string | null | undefined): string | null {
  const v = (kpp ?? "").trim();
  if (!v) return null;
  if (!/^\d{9}$/.test(v)) return "КПП должен содержать 9 цифр";
  return null;
}

export function validateOrgType(orgType: string | number | null | undefined): string | null {
  if (orgType === "" || orgType == null) return null;
  const n = typeof orgType === "number" ? orgType : Number(String(orgType).trim());
  if (![1, 2, 3].includes(n)) return "Тип организации: 1 (ВГ), 2 (assoc) или 3 (внешний)";
  return null;
}

export function validateKontrDraftRow(row: {
  name: string;
  inn?: string;
  kpp?: string;
  orgType?: string;
}): string[] {
  const errors: string[] = [];
  if (!row.name.trim()) errors.push("Наименование обязательно");
  const innErr = validateInn(row.inn);
  if (innErr) errors.push(innErr);
  const kppErr = validateKpp(row.kpp);
  if (kppErr) errors.push(kppErr);
  const otErr = validateOrgType(row.orgType);
  if (otErr) errors.push(otErr);
  return errors;
}

export interface LoansImportPreview {
  mode: "merge" | "replace";
  incomingCounts: Record<string, number>;
  currentCounts: Record<string, number>;
  resultCounts: Record<string, number>;
  added: number;
  removed: number;
  warnings: string[];
}

export function validateLoansNzsPackageShape(data: unknown): LoansNzsPackage {
  if (!data || typeof data !== "object") {
    throw new Error("Неверный файл справочников займов/НЗС: ожидался JSON-объект");
  }
  const raw = data as Record<string, unknown>;
  if (!raw.groups || typeof raw.groups !== "object" || Array.isArray(raw.groups)) {
    throw new Error("Неверный файл справочников займов/НЗС: нет объекта groups");
  }
  const groups = raw.groups as Record<string, unknown>;
  const normalized: Record<string, LoanNzsItem[]> = {};
  const missing: string[] = [];
  for (const g of LOAN_NZS_GROUPS) {
    const list = groups[g];
    if (list == null) {
      missing.push(g);
      normalized[g] = [];
      continue;
    }
    if (!Array.isArray(list)) {
      throw new Error(`Группа «${g}» должна быть массивом`);
    }
    normalized[g] = list.map((it, idx) => {
      if (!it || typeof it !== "object") {
        throw new Error(`Группа «${g}», элемент ${idx + 1}: ожидался объект`);
      }
      const row = it as Record<string, unknown>;
      const kod = String(row.kod ?? "").trim();
      const value = String(row.value ?? "").trim();
      const newkod = row.newkod == null ? null : String(row.newkod).trim() || null;
      if (!kod && !value && !newkod) {
        throw new Error(`Группа «${g}», элемент ${idx + 1}: пустая запись`);
      }
      return {
        kod: kod || value,
        value: value || kod,
        note: row.note == null ? null : String(row.note),
        newkod,
        creditor: row.creditor == null ? null : String(row.creditor),
        dateStart: row.dateStart == null ? null : String(row.dateStart),
        dateFinish: row.dateFinish == null ? null : String(row.dateFinish),
        currency: row.currency == null ? null : String(row.currency),
        percent: row.percent == null ? null : String(row.percent),
        vfo: row.vfo == null ? null : String(row.vfo),
        period: row.period == null ? null : String(row.period),
        idObdnsi: row.idObdnsi == null ? null : String(row.idObdnsi),
        idKontr: row.idKontr == null ? null : String(row.idKontr),
        use: typeof row.use === "boolean" ? row.use : undefined,
        dateRevision: row.dateRevision == null ? null : String(row.dateRevision),
        comment: row.comment == null ? null : String(row.comment),
      } satisfies LoanNzsItem;
    });
  }
  if (missing.length === LOAN_NZS_GROUPS.length) {
    throw new Error(
      `В файле нет групп «${LOAN_NZS_GROUPS.join("» / «")}» — импорт отклонён`
    );
  }
  return {
    version: String(raw.version ?? "1.0"),
    kind: "loans-nzs-refs",
    exportedAt: String(raw.exportedAt ?? new Date().toISOString()),
    source: raw.source == null ? undefined : String(raw.source),
    organization: raw.organization == null ? undefined : String(raw.organization),
    zid: typeof raw.zid === "number" ? raw.zid : null,
    groups: normalized,
    counts: Object.fromEntries(LOAN_NZS_GROUPS.map((g) => [g, normalized[g].length])),
  };
}

export function previewLoansNzsImport(
  current: LoansNzsPackage,
  incoming: LoansNzsPackage,
  mode: "merge" | "replace"
): LoansImportPreview {
  const warnings: string[] = [];
  const incomingCounts: Record<string, number> = {};
  const currentCounts: Record<string, number> = {};
  const resultCounts: Record<string, number> = {};
  let added = 0;
  let removed = 0;

  for (const g of LOAN_NZS_GROUPS) {
    const cur = current.groups?.[g] ?? [];
    const inc = incoming.groups?.[g] ?? [];
    currentCounts[g] = cur.length;
    incomingCounts[g] = inc.length;
    if (mode === "replace") {
      resultCounts[g] = inc.length;
      if (inc.length === 0 && cur.length > 0) {
        warnings.push(`Замена очистит группу «${g}» (${cur.length} → 0)`);
      }
      removed += Math.max(0, cur.length - inc.length);
      added += Math.max(0, inc.length - cur.length);
    } else {
      const keys = new Set(
        cur.map((it) => (it.newkod || it.kod || it.value || "").trim().toLowerCase()).filter(Boolean)
      );
      let mergeAdded = 0;
      for (const it of inc) {
        const k = (it.newkod || it.kod || it.value || "").trim().toLowerCase();
        if (k && !keys.has(k)) mergeAdded++;
      }
      resultCounts[g] = cur.length + mergeAdded;
      added += mergeAdded;
    }
  }

  const totalIncoming = LOAN_NZS_GROUPS.reduce((n, g) => n + incomingCounts[g], 0);
  if (mode === "replace" && totalIncoming === 0) {
    warnings.push("Файл не содержит записей — замена очистит оба справочника");
  }

  return {
    mode,
    incomingCounts,
    currentCounts,
    resultCounts,
    added,
    removed,
    warnings,
  };
}
