export type ToolsTabId =
  | "overview"
  | "exchange"
  | "quality"
  | "saldo"
  | "aggregation"
  | "references"
  | "advanced";

export type ExchangeMode = "export" | "upload";

export const TOOLS_TABS: Array<{
  id: ToolsTabId;
  label: string;
  hint: string;
}> = [
  {
    id: "overview",
    label: "Обзор",
    hint: "Сценарии: отправить дочкам, принять, проверить, собрать свод",
  },
  {
    id: "exchange",
    label: "Обмен",
    hint: "Выгрузка комплектов из списка и загрузка файлов drag-and-drop",
  },
  {
    id: "quality",
    label: "Контроль",
    hint: "Пересчёт и увязки по текущему комплекту",
  },
  {
    id: "saldo",
    label: "Сальдо",
    hint: "Перенос остатков между формами одного шаблона",
  },
  {
    id: "aggregation",
    label: "Свод",
    hint: "Агрегация участников в сводную организацию",
  },
  {
    id: "references",
    label: "Справочники",
    hint: "Займы / НЗС и изменения контрагентов (N99)",
  },
  {
    id: "advanced",
    label: "Служебное",
    hint: "Ограничения и обходные пути",
  },
];

export function parseExchangeMode(raw: string | null): ExchangeMode {
  return raw === "upload" ? "upload" : "export";
}
