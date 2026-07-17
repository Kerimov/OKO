export interface FormColumn {
  key: string;
  label: string;
  type: "text" | "number";
  width?: number;
  frozen?: boolean;
  readonly?: boolean;
  /** Итоговая графа (FTotal из a_stblFIELDs) */
  fTotal?: boolean;
  helpText?: string | null;
  align?: "left" | "center" | "right" | null;
  decimals?: number | null;
  hidden?: boolean;
  formula?: string | null;
}

export interface FormRowTemplate {
  num?: string;
  code?: string;
  name: string;
  /** sp_rash kod из row-rash-index */
  rashKod?: number;
  kind?: "data" | "header" | "total" | "section" | "hidden" | null;
  level?: number | null;
  readonly?: boolean;
  formula?: string | null;
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
  archived?: boolean;
  schemaVersion?: number;
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
    archived?: boolean;
  }>;
}

export type RowData = Record<string, string | number>;

export interface KontrAgent {
  id: number;
  name: string;
  orgForm?: string | null;
  inn?: string | null;
  kpp?: string | null;
  /** 1=внутригрупповой, 2=ассоциированный, 3=внешний */
  orgType?: number | null;
  /** sp_kontr.Forms = «обяз.расшифровка» → порог как у ассоциированных (5 млн) */
  mandatoryRash?: boolean;
  country?: string | null;
  city?: string | null;
  /** Access sp_kontr.OldName — «Другое наименование» (N99) */
  oldName?: string | null;
  ogrn?: string | null;
  /** Access idOBDNSI */
  idObdnsi?: string | null;
}

export interface FormRashEntry {
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
  templateRowKey?: string | null;
  values: Record<string, string | number>;
}

export interface FormMeta {
  organization: string;
  enterpriseCode: string;
  periodStart: string;
  periodEnd: string;
  unit: string;
}

export type FormInstanceStatus = "draft" | "submitted";

export type PackageWorkflowStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "corrected"
  | "accepted";

export interface PackageWorkflow {
  status: PackageWorkflowStatus;
  comment: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Сохранённый экземпляр заполненной формы */
export interface OkoFormInstance {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  zid?: number | null;
  eid?: number | null;
  status?: FormInstanceStatus;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
  /** Расшифровки t_ras (localStorage fallback) */
  rashEntries?: FormRashEntry[];
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency for PATCH /cells (API). */
  revision?: number;
  templateSchemaVersion?: number;
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
  status?: FormInstanceStatus;
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
  packageStatus?: PackageWorkflowStatus;
  packageComment?: string | null;
  periodStatus?: "open" | "closed";
  closedAt?: string | null;
  closedBy?: string | null;
  methodologyReleaseId?: string | null;
  formSetCount?: number;
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
  draft: number;
  submitted: number;
  workflow?: PackageWorkflow;
  items: Array<{
    formId: string;
    title: string;
    category: string;
    filled: boolean;
    instanceId?: string;
    displayName?: string;
    status?: FormInstanceStatus;
  }>;
}

export interface PackageDashboardRow {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
  packageStatus?: PackageWorkflowStatus;
  packageComment?: string | null;
}

export interface CreatePackageResult {
  created: number;
  skipped: number;
  total: number;
  instanceIds: string[];
}

export interface DeletePackageResult {
  deletedInstances: number;
  periodRemoved: boolean;
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
  isActive?: boolean;
}

export type RashModalRowMode = "dynamic" | "fixed" | "mixed";

export interface RashModalSettings {
  rowMode: RashModalRowMode;
}

export interface RashModalRow {
  id?: number;
  kod: number;
  rowKey: string;
  label: string;
  sort: number;
  required: boolean;
  sourceFormId?: string | null;
  sourceRowNo?: string | null;
}

export interface RashAddsum {
  id?: number;
  kod: number;
  sort: number;
  sumTitle: string;
  fldType: string;
  required?: boolean;
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
  /** Layout by rule kod (from API export); absent in static JSON fallback. */
  modalSettings?: Record<string, RashModalSettings>;
  modalRows?: RashModalRow[];
}

/** @deprecated используйте OkoFormInstance */
export interface FormDraft {
  formId: string;
  meta: FormMeta;
  rows: RowData[];
  signatures: Record<string, string>;
  updatedAt: string;
}
