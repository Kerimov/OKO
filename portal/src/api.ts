import type { FormCatalog, FormSchema } from "./types";
import type { CheckRule } from "./engine/checkEngine";

export interface ChecksData {
  version: string;
  source: string;
  total: number;
  activeCount: number;
  checks: CheckRule[];
}

export interface SaldoRule {
  number: number;
  targetForm: string;
  targetColumn: string;
  targetRow: number | null;
  sourceForm: string | null;
  sourceColumn: string | null;
  sourceRow: number | null;
  saldoT: boolean;
  saldoS: boolean;
  saldoG: boolean;
  name?: string | null;
}

export interface SaldoRulesData {
  version: string;
  total: number;
  rules: SaldoRule[];
}

export interface FormCorrespondenceItem {
  formId: string;
  saldoYellow?: string | null;
  saldoRed?: string | null;
  saldoBlue?: string | null;
  pages?: number | null;
}

export interface FormCorrespondenceData {
  version: string;
  total: number;
  forms: FormCorrespondenceItem[];
}

export async function loadCatalog(): Promise<FormCatalog> {
  const res = await fetch("/schemas/catalog.json");
  if (!res.ok) throw new Error("Не удалось загрузить каталог форм");
  return res.json();
}

export async function loadSchema(formId: string): Promise<FormSchema> {
  const res = await fetch(`/schemas/${formId}.json`);
  if (!res.ok) throw new Error(`Форма ${formId} не найдена`);
  return res.json();
}

export async function loadChecks(): Promise<ChecksData> {
  const res = await fetch("/data/checks.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила проверок");
  return res.json();
}

export async function loadSaldoRules(): Promise<SaldoRulesData> {
  const res = await fetch("/data/saldo-rules.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила сальdo");
  return res.json();
}

export async function loadFormCorrespondence(): Promise<FormCorrespondenceData> {
  const res = await fetch("/data/form-correspondence.json");
  if (!res.ok) throw new Error("Не удалось загрузить FormCorrespondence");
  return res.json();
}

export interface RowFormulasData {
  version: string;
  formsCount: number;
  total: number;
  byForm: Record<string, Array<{ rowNo: number; formula: string; sign?: string | null }>>;
}

export async function loadRowFormulas(): Promise<RowFormulasData> {
  const res = await fetch("/data/row-formulas.json");
  if (!res.ok) throw new Error("Не удалось загрузить формулы строк");
  return res.json();
}

export interface ExcelMapping {
  formName: string;
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: number | string | null;
  formColumn: string | null;
  formRow: number | null;
}

export interface ExcelExportData {
  version: string;
  total: number;
  mappings: ExcelMapping[];
}

export async function loadExcelExport(): Promise<ExcelExportData> {
  const res = await fetch("/data/excel-export.json");
  if (!res.ok) throw new Error("Не удалось загрузить Excel-маппинг");
  return res.json();
}
