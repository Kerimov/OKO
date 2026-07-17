import type { FormSchema } from "../../types";
import type { RashAddsum, RashRule } from "../../types";
import { buildFormulaString, type FormulaDraft } from "./formulaSpec";
import { buildRefName, type RefSpecDraft } from "./refSpec";

export const RESERVED_KODS = new Set([0, 1, 2, 3, 4, 6]);
export const SUPPORTED_FLD_TYPES = ["Сумма", "Количество"] as const;

export interface PlacementDraft {
  formId: string;
  rowNo: string;
  columnKey: string;
}

export interface RashValidationIssue {
  level: "error" | "warning";
  message: string;
}

export function validateRashDraft(input: {
  isNew: boolean;
  draft: RashRule;
  formula: FormulaDraft;
  refs: [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft];
  addsum: RashAddsum[];
  placements: PlacementDraft[];
  schemas: Record<string, FormSchema | undefined>;
}): RashValidationIssue[] {
  const issues: RashValidationIssue[] = [];
  const { draft, formula, refs, addsum, placements, schemas } = input;

  if (!draft.kod || draft.kod < 0) {
    issues.push({ level: "error", message: "Укажите код расшифровки" });
  } else if (RESERVED_KODS.has(draft.kod)) {
    issues.push({
      level: "error",
      message: `Код ${draft.kod} служебный (0/1/2/3/4/6) — выберите другой`,
    });
  }

  if (!draft.name.trim()) {
    issues.push({ level: "error", message: "Укажите тип / привязку к форме (название правила)" });
  }

  const formulaStr = buildFormulaString(formula);
  if (formula.rawMode && formula.raw.trim() && !parseTotalColumnSafe(formula.raw)) {
    issues.push({ level: "warning", message: "В формуле не найдена итоговая графа слева от =" });
  }
  if (!formulaStr && placements.some((p) => p.columnKey.trim())) {
    issues.push({
      level: "warning",
      message: "Нет формулы итога — для многоколоночной расшифровки задайте L=B+C…",
    });
  }

  if (formulaStr && !formula.rawMode) {
    const total = formula.totalCol.trim().toUpperCase();
    if (!total) issues.push({ level: "error", message: "Выберите итоговую графу формулы" });
    if (!formula.terms.some((t) => t.col.trim())) {
      issues.push({ level: "warning", message: "Формула без слагаемых" });
    }
  }

  const a1 = buildRefName(refs[0]);
  if (!a1) {
    issues.push({ level: "warning", message: "Не задано измерение 1 (обычно Контрагент)" });
  }

  for (const a of addsum) {
    if (!a.sumTitle.trim()) {
      issues.push({ level: "error", message: "У доп. графы пустой заголовок" });
    }
    if (
      a.fldType &&
      !(SUPPORTED_FLD_TYPES as readonly string[]).includes(a.fldType) &&
      a.fldType !== "Текст" &&
      a.fldType !== "Дата"
    ) {
      issues.push({ level: "warning", message: `Неизвестный тип поля «${a.fldType}»` });
    }
    if (a.fldType === "Текст" || a.fldType === "Дата") {
      issues.push({
        level: "warning",
        message: `Тип «${a.fldType}» в UI поддерживается ограничено — предпочтительнее Сумма/Количество`,
      });
    }
  }

  if (placements.length === 0) {
    issues.push({
      level: "warning",
      message: "Нет привязок к форме — кнопка «…» на сетке не появится",
    });
  }

  const seen = new Set<string>();
  for (const p of placements) {
    if (!p.formId.trim() || !String(p.rowNo).trim()) {
      issues.push({ level: "error", message: "Привязка без формы или номера строки" });
      continue;
    }
    const key = `${p.formId}|${p.rowNo}|${(p.columnKey || "").toUpperCase()}`;
    if (seen.has(key)) {
      issues.push({
        level: "error",
        message: `Дубликат привязки ${p.formId}/${p.rowNo}/${p.columnKey || "*"}`,
      });
    }
    seen.add(key);

    const schema = schemas[p.formId];
    if (!schema) {
      issues.push({
        level: "warning",
        message: `Схема формы ${p.formId} не загружена — проверьте id`,
      });
      continue;
    }
    const row = schema.rows.find((r) => String(r.num ?? "").trim() === String(p.rowNo).trim());
    if (!row) {
      issues.push({
        level: "warning",
        message: `Строки ${p.rowNo} пока нет в шаблоне ${p.formId} — привязка сохранится; добавьте строку в редакторе форм при необходимости`,
      });
    }
    const col = (p.columnKey || "").trim().toUpperCase();
    if (col && !schema.columns.some((c) => c.key.toUpperCase() === col)) {
      issues.push({
        level: "warning",
        message: `Графа ${col} пока нет в шаблоне ${p.formId} — привязка сохранится; добавьте графу в редакторе форм при необходимости`,
      });
    }
    if (formulaStr && col) {
      const total = (parseTotalColumnSafe(formulaStr) || "").toUpperCase();
      if (total && col !== total) {
        // ok — placement on display col while formula totals another
      }
    }
  }

  return issues;
}

function parseTotalColumnSafe(formula: string): string | null {
  const eq = formula.indexOf("=");
  const left = (eq >= 0 ? formula.slice(0, eq) : formula).trim();
  const m = left.match(/([A-ZА-Я])\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

export function draftFingerprint(input: {
  draft: RashRule;
  addsum: RashAddsum[];
  placements: PlacementDraft[];
}): string {
  return JSON.stringify({
    draft: input.draft,
    addsum: input.addsum.map((a) => ({
      sort: a.sort,
      sumTitle: a.sumTitle,
      fldType: a.fldType,
    })),
    placements: input.placements,
  });
}
