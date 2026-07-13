/** Shared types for @oko/engine (structurally compatible with portal/server). */
export type RowData = Record<string, string | number>;

export interface FormColumn {
  key: string;
  type: "text" | "number";
  label?: string;
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
  fTotal?: boolean;
}

export interface FormSchema {
  id: string;
  columns: FormColumn[];
}

export interface FormMeta {
  organization: string;
  enterpriseCode: string;
  periodStart: string;
  periodEnd: string;
  unit: string;
}

export interface OkoFormInstance {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  rows: RowData[];
  updatedAt: string;
  createdAt: string;
  meta: FormMeta;
  signatures: Record<string, string>;
  zid?: number | null;
  eid?: number | null;
  status?: "draft" | "submitted";
}
