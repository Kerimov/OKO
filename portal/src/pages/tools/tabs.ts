export type ToolsTabId =
  | "overview"
  | "exchange"
  | "quality"
  | "saldo"
  | "aggregation"
  | "references"
  | "advanced";

export const TOOLS_TABS: Array<{
  id: ToolsTabId;
  label: string;
  hint: string;
}> = [
  {
    id: "overview",
    label: "Обзор",
    hint: "Контекст рабочего комплекта и полнота заполнения",
  },
  {
    id: "exchange",
    label: "Обмен",
    hint: "Импорт и экспорт комплекта (JSON/ZIP), сравнение форм и ячеек",
  },
  {
    id: "quality",
    label: "Контроль",
    hint: "Пересчёт и увязки по текущему комплекту организации/периода",
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
    label: "Расширенное",
    hint: "Ручная агрегация нескольких экземпляров одного шаблона",
  },
];
