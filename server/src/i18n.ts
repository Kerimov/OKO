/**
 * Simple RU/EN label helper for PSD UI strings.
 */
export type LocaleCode = "ru" | "en";

const DICT: Record<string, { ru: string; en: string }> = {
  "nav.bpMonitor": { ru: "Мониторинг БП", en: "BP monitoring" },
  "nav.svods": { ru: "Реестр сводов", en: "Svod registry" },
  "nav.integrations": { ru: "Интеграции", en: "Integrations" },
  "bp.status.not_started": { ru: "Не начат", en: "Not started" },
  "bp.status.collecting": { ru: "Сбор", en: "Collecting" },
  "bp.status.pending_curator_approval": { ru: "На согласовании", en: "Pending approval" },
  "bp.status.curator_approved": { ru: "Согласован", en: "Approved" },
  "bp.status.completed": { ru: "Завершён", en: "Completed" },
  "role.auditor_readonly": { ru: "Аудитор (чтение)", en: "Auditor (read-only)" },
  "action.locked": { ru: "Запись заблокирована", en: "Record is locked" },
};

export function t(key: string, locale: LocaleCode = "ru"): string {
  const row = DICT[key];
  if (!row) return key;
  return row[locale] ?? row.ru;
}

export function normalizeLocale(raw: string | null | undefined): LocaleCode {
  return raw === "en" ? "en" : "ru";
}
