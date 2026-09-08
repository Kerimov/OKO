import type {
  FormSchema,
  RashAddsum,
  RashModalRow,
  RashModalSettings,
  RashRule,
} from "../../types";
import { buildFormulaString, type FormulaDraft } from "./formulaSpec";
import { buildRefName, type RefSpecDraft } from "./refSpec";

export const RESERVED_KODS = new Set([0, 1, 2, 3, 4, 6]);
export const SUPPORTED_FLD_TYPES = ["Сумма", "Количество"] as const;

export type RashWizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface PlacementDraft {
  formId: string;
  rowNo: string;
  columnKey: string;
}

export interface RashValidationIssue {
  level: "error" | "warning";
  message: string;
  step?: RashWizardStep;
}

export function validateRashDraft(input: {
  isNew: boolean;
  draft: RashRule;
  formula: FormulaDraft;
  refs: [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft];
  addsum: RashAddsum[];
  placements: PlacementDraft[];
  modalSettings?: RashModalSettings;
  modalRows?: RashModalRow[];
  schemas: Record<string, FormSchema | undefined>;
}): RashValidationIssue[] {
  const issues: RashValidationIssue[] = [];
  const {
    draft,
    formula,
    refs,
    addsum,
    placements,
    schemas,
    modalSettings,
    modalRows = [],
  } = input;

  if (!draft.kod || draft.kod < 0) {
    issues.push({ level: "error", message: "Укажите код расшифровки", step: 1 });
  } else if (RESERVED_KODS.has(draft.kod)) {
    issues.push({
      level: "error",
      message: `Код ${draft.kod} служебный (0/1/2/3/4/6) — выберите другой`,
      step: 1,
    });
  }

  if (!draft.name.trim()) {
    issues.push({
      level: "error",
      message: "Укажите название правила",
      step: 1,
    });
  }

  const formulaStr = buildFormulaString(formula);
  if (formula.rawMode && formula.raw.trim() && !parseTotalColumnSafe(formula.raw)) {
    issues.push({
      level: "warning",
      message: "В формуле не найдена итоговая графа слева от =",
      step: 4,
    });
  }
  if (!formulaStr && placements.some((p) => p.columnKey.trim())) {
    issues.push({
      level: "warning",
      message: "Нет формулы итога — для многоколоночной расшифровки задайте L=B+C…",
      step: 4,
    });
  }

  if (formulaStr && !formula.rawMode) {
    const total = formula.totalCol.trim().toUpperCase();
    if (!total) {
      issues.push({ level: "error", message: "Выберите итоговую графу формулы", step: 4 });
    }
    if (!formula.terms.some((t) => t.col.trim())) {
      issues.push({ level: "warning", message: "Формула без слагаемых", step: 4 });
    }
  }

  const a1 = buildRefName(refs[0]);
  if (!a1) {
    issues.push({
      level: "warning",
      message: "Не задано измерение 1 (обычно Контрагент)",
      step: 4,
    });
  }

  for (const a of addsum) {
    if (!a.sumTitle.trim()) {
      issues.push({
        level: "error",
        message: "У доп. графы пустой заголовок",
        step: 4,
      });
    }
    if (
      a.fldType &&
      !(SUPPORTED_FLD_TYPES as readonly string[]).includes(a.fldType) &&
      a.fldType !== "Текст" &&
      a.fldType !== "Дата"
    ) {
      issues.push({
        level: "warning",
        message: `Неизвестный тип поля «${a.fldType}»`,
        step: 4,
      });
    }
    if (a.fldType === "Текст" || a.fldType === "Дата") {
      issues.push({
        level: "warning",
        message: `Тип «${a.fldType}» в UI поддерживается ограничено — предпочтительнее Сумма/Количество`,
        step: 4,
      });
    }
  }

  if (placements.length === 0) {
    issues.push({
      level: "warning",
      message: "Нет привязок к форме — кнопка «…» на сетке не появится",
      step: 2,
    });
  }

  if (
    modalSettings &&
    modalSettings.rowMode !== "dynamic" &&
    modalRows.length === 0
  ) {
    issues.push({
      level: "error",
      message: "Для фиксированного или смешанного режима добавьте хотя бы одну строку окна",
      step: 3,
    });
  }
  const modalKeys = new Set<string>();
  for (const row of modalRows) {
    const key = row.rowKey.trim();
    if (!key || !row.label.trim()) {
      issues.push({
        level: "error",
        message: "У строки окна должны быть ключ и название",
        step: 3,
      });
    } else if (modalKeys.has(key)) {
      issues.push({
        level: "error",
        message: `Дублируется строка окна «${key}»`,
        step: 3,
      });
    }
    modalKeys.add(key);
  }

  const seen = new Set<string>();
  for (const p of placements) {
    if (!p.formId.trim() || !String(p.rowNo).trim()) {
      issues.push({
        level: "error",
        message: "Привязка без формы или номера строки",
        step: 2,
      });
      continue;
    }
    const key = `${p.formId}|${p.rowNo}|${(p.columnKey || "").toUpperCase()}`;
    if (seen.has(key)) {
      issues.push({
        level: "error",
        message: `Дубликат привязки ${p.formId}/${p.rowNo}/${p.columnKey || "*"}`,
        step: 2,
      });
    }
    seen.add(key);

    const schema = schemas[p.formId];
    if (!schema) {
      issues.push({
        level: "warning",
        message: `Схема формы ${p.formId} не загружена — проверьте id`,
        step: 2,
      });
      continue;
    }
    const row = schema.rows.find((r) => String(r.num ?? "").trim() === String(p.rowNo).trim());
    if (!row) {
      issues.push({
        level: "warning",
        message: `Строки ${p.rowNo} пока нет в шаблоне ${p.formId} — будет предложено создать при сохранении`,
        step: 2,
      });
    }
    const col = (p.columnKey || "").trim().toUpperCase();
    if (col && !schema.columns.some((c) => c.key.toUpperCase() === col)) {
      issues.push({
        level: "warning",
        message: `Графы ${col} пока нет в шаблоне ${p.formId} — будет предложено создать при сохранении`,
        step: 2,
      });
    }
  }

  return issues;
}

export function stepHasErrors(
  issues: RashValidationIssue[],
  step: RashWizardStep
): boolean {
  return issues.some((issue) => issue.level === "error" && issue.step === step);
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
  modalSettings?: RashModalSettings;
  modalRows?: RashModalRow[];
}): string {
  return JSON.stringify({
    draft: input.draft,
    addsum: input.addsum.map((a) => ({
      sort: a.sort,
      sumTitle: a.sumTitle,
      fldType: a.fldType,
      required: a.required ?? false,
    })),
    placements: input.placements,
    modalSettings: input.modalSettings ?? { rowMode: "dynamic" },
    modalRows: (input.modalRows ?? []).map((row) => ({
      rowKey: row.rowKey,
      label: row.label,
      sort: row.sort,
      required: row.required,
      sourceFormId: row.sourceFormId ?? null,
      sourceRowNo: row.sourceRowNo ?? null,
    })),
  });
}
