export interface FormMeta {
  organization: string;
  enterpriseCode: string;
  periodStart: string;
  periodEnd: string;
  unit: string;
}

export type FormInstanceStatus = "draft" | "submitted";

export interface FormRashEntryDto {
  id?: number;
  formId: string;
  parentRowNo: number;
  columnKey?: string | null;
  rashKod: number;
  lineNo: number;
  kontrId?: number | null;
  kontrName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  attrA2?: string | null;
  attrA3?: string | null;
  attrA4?: string | null;
  values: Record<string, string | number>;
}

export interface OkoFormInstance {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  zid?: number | null;
  eid?: number | null;
  status?: FormInstanceStatus;
  meta: FormMeta;
  rows: Record<string, string | number>[];
  signatures: Record<string, string>;
  /** Detail lines from form_rash_entries (modal t_ras); omitted for kontr inline forms. */
  rashEntries?: FormRashEntryDto[];
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency for PATCH /cells */
  revision?: number;
  templateSchemaVersion?: number;
}
