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
  meta: FormMeta;
  rows: Record<string, string | number>[];
  signatures: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
