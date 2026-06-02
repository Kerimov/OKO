export interface FormColumn {
  key: string;
  label: string;
  type: "text" | "number";
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
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
  createdAt: string;
  updatedAt: string;
}

/** @deprecated используйте OkoFormInstance */
export interface FormDraft {
  formId: string;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
  updatedAt: string;
}
