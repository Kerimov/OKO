export type Crumb = { label: string; to?: string };

const ADMIN_LABELS: Record<string, string> = {
  forms: "Формы",
  checks: "Увязки",
  saldo: "Сальдо",
  excel: "Маппинг Excel",
  rash: "Расшифровки",
  refs: "Справочники",
  kontr: "Контрагенты",
  aggregation: "Агрегация",
  packages: "Комплекты",
  users: "Пользователи",
  audit: "Аудит",
};

/** Build header breadcrumbs from the current pathname. */
export function breadcrumbsForPath(
  pathname: string,
  formsListLabel = "Мои формы"
): Crumb[] {
  const home: Crumb = { label: "Главная", to: "/catalog" };
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0 || pathname === "/catalog") {
    return [home, { label: "Каталог" }];
  }

  if (parts[0] === "my") {
    if (parts[1]) {
      return [home, { label: formsListLabel, to: "/my" }, { label: "Форма" }];
    }
    return [home, { label: formsListLabel }];
  }

  if (parts[0] === "package") {
    return [home, { label: "Комплект" }];
  }

  if (parts[0] === "tools") {
    return [home, { label: "Сводка и импорт" }];
  }

  if (parts[0] === "settings") {
    return [home, { label: "Настройки" }];
  }

  if (parts[0] === "instructions") {
    return [home, { label: "Инструкция" }];
  }

  if (parts[0] === "admin") {
    const section = parts[1] ?? "";
    const label = ADMIN_LABELS[section] ?? (section || "Админ");
    const group =
      section === "packages" || section === "users" || section === "audit"
        ? "Администрирование"
        : "Редакторы";
    return [home, { label: group }, { label }];
  }

  return [home, { label: pathname }];
}
