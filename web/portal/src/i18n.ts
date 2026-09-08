import { getCurrentUser } from "./auth";

export type LocaleCode = "ru" | "en";

const DICT: Record<string, { ru: string; en: string }> = {
  "nav.bpMonitor": { ru: "Мониторинг БП", en: "BP monitoring" },
  "nav.perimeter": { ru: "Периметр сбора", en: "Collection perimeter" },
  "nav.integrations": { ru: "Интеграции / своды", en: "Integrations / svods" },
  "nav.psdReports": { ru: "Отчёты ПСД", en: "PSD reports" },
  "bp.status.not_started": { ru: "Не начат", en: "Not started" },
  "bp.status.collecting": { ru: "Сбор", en: "Collecting" },
  "bp.status.pending_curator_approval": { ru: "На согласовании", en: "Pending approval" },
  "bp.status.curator_approved": { ru: "Согласован", en: "Approved" },
  "bp.status.completed": { ru: "Завершён", en: "Completed" },
  "role.business_process_manager": { ru: "Руководитель БП", en: "BP manager" },
  "role.department_curator": { ru: "Куратор", en: "Curator" },
  "role.subsidiary_specialist": { ru: "Специалист ДО", en: "Subsidiary specialist" },
  "role.support_specialist": { ru: "Сопровождение", en: "Support" },
  "role.auditor_readonly": { ru: "Аудитор", en: "Auditor" },
  "form.bpLocked.not_started": {
    ru: "БП не начат — сначала запустите бизнес-процесс на странице комплекта.",
    en: "BP not started — start the business process on the package page first.",
  },
  "form.bpLocked.pending": {
    ru: "Комплект на согласовании куратора — редактирование заблокировано.",
    en: "Package awaiting curator approval — editing is locked.",
  },
  "form.bpLocked.completed": {
    ru: "БП завершён — форма только для просмотра.",
    en: "BP completed — form is read-only.",
  },
  "badge.readonly": { ru: "только чтение", en: "read-only" },
};

export function normalizeLocale(raw: string | null | undefined): LocaleCode {
  return raw === "en" ? "en" : "ru";
}

export function currentLocale(): LocaleCode {
  return normalizeLocale(getCurrentUser()?.locale);
}

export function t(key: string, locale?: LocaleCode): string {
  const loc = locale ?? currentLocale();
  const row = DICT[key];
  if (!row) return key;
  return row[loc] ?? row.ru;
}
