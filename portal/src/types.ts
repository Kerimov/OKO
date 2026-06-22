export interface FormColumn {
  key: string;
  label: string;
  type: "text" | "number";
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
  /** Итоговая графа (FTotal из a_stblFIELDs) */
  fTotal?: boolean;
}

export interface FormRowTemplate {
  num?: string;
  code?: string;
  name: string;
}

export interface FormSchema {
  id: string;
  title: string;
  category: string;
  pages: number;
  pdfFile?: string;
  meta: {
    organization: string;
    enterpriseCode: string;
    periodStart: string;
    periodEnd: string;
    unit: string;
  };
  columns: FormColumn[];
  rows: FormRowTemplate[];
  allowAddRows?: boolean;
  kontrForm?: boolean;
  signatures: string[];
}

export interface FormCatalog {
  version: string;
  name: string;
  description: string;
  categories: Record<string, string>;
  forms: Array<{
    id: string;
    title: string;
    category: string;
    pages: number;
    pdfFile: string;
  }>;
}

export type RowData = Record<string, string | number>;

export interface KontrAgent {
  id: number;
  name: string;
  orgForm?: string | null;
  inn?: string | null;
  kpp?: string | null;
}

export interface FormMeta {
  organization: string;
  enterpriseCode: string;
  periodStart: string;
  periodEnd: string;
  unit: string;
}

/** Сохранённый экземпляр заполненной формы */
export interface OkoFormInstance {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  zid?: number | null;
  eid?: number | null;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceSummary {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  zid?: number | null;
  eid?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
}

export interface ReportingPeriod {
  eid: number;
  zid: number;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  quarter: number | null;
  year: number | null;
}

export interface WorkContext {
  zid: number | null;
  eid: number | null;
}

export interface PackageCompleteness {
  zid: number;
  eid: number;
  total: number;
  filled: number;
  items: Array<{
    formId: string;
    title: string;
    category: string;
    filled: boolean;
    instanceId?: string;
    displayName?: string;
  }>;
}

export interface CreatePackageResult {
  created: number;
  skipped: number;
  total: number;
  instanceIds: string[];
}

export interface RashRule {
  kod: number;
  name: string;
  note?: string | null;
  refRows?: string | null;
  totalFormula?: string | null;
  refA1Name?: string | null;
  refA1Title?: string | null;
  refA2Name?: string | null;
  refA2Title?: string | null;
  refA3Name?: string | null;
  refA3Title?: string | null;
  refA4Name?: string | null;
  refA4Title?: string | null;
}

export interface RashAddsum {
  id?: number;
  kod: number;
  sort: number;
  sumTitle: string;
  fldType: string;
}

export interface RashThresholds {
  level1: number;
  level2: number;
  level3: number;
  unit: string;
  labels: string[];
}

export interface RashRulesData {
  version: string;
  total: number;
  rules: RashRule[];
  addsum: RashAddsum[];
  thresholds: RashThresholds;
}

/** @deprecated используйте OkoFormInstance */
export interface FormDraft {
  formId: string;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
  updatedAt: string;
}
