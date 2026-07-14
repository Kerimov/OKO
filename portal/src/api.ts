import type {
  FormCatalog,
  FormSchema,
  RashAddsum,
  RashRule,
  RashRulesData,
  RashThresholds,
} from "./types";
import type { CheckRule } from "./engine/checkEngine";
import { apiFetchRaw } from "./apiClient";

export interface ChecksData {
  version: string;
  source: string;
  total: number;
  activeCount: number;
  checks: CheckRule[];
}

export type ReorgCheckVariant = 1 | 2 | 3 | 4;

export interface ReorgCheckRule {
  variant: ReorgCheckVariant;
  number: number;
  expression: string;
  expressionAlt?: string | null;
  message?: string | null;
  reorg?: string | null;
  fialkina?: string | number | null;
  source?: string | null;
}

export interface ReorgChecksData {
  version: string;
  source: string;
  total: number;
  byVariant?: Record<string, number>;
  checks: ReorgCheckRule[];
}

export interface SaldoRule {
  number: number;
  targetForm: string;
  targetColumn: string;
  targetRow: number | null;
  sourceForm: string | null;
  sourceColumn: string | null;
  sourceRow: number | null;
  endForm?: string | null;
  endColumn?: string | null;
  endRow?: number | null;
  saldoT: boolean;
  saldoS: boolean;
  saldoG: boolean;
  name?: string | null;
  conditional?: boolean;
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
  saldoGreen?: string | null;
  saldoYellowCorr?: string | null;
  saldoRedCorr?: string | null;
  saldoBlueCorr?: string | null;
  reorgUpdate?: string | null;
  reorgUpdate2?: string | null;
  pages?: number | null;
}

export interface FormCorrespondenceData {
  version: string;
  total: number;
  forms: FormCorrespondenceItem[];
}

export async function loadCatalog(): Promise<FormCatalog> {
  try {
    const res = await apiFetchRaw("/api/forms/catalog");
    if (res.ok) {
      const data = (await res.json()) as FormCatalog;
      if (data.forms?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/schemas/catalog.json");
  if (!res.ok) throw new Error("Не удалось загрузить каталог форм");
  return res.json();
}

export async function loadSchema(formId: string): Promise<FormSchema> {
  try {
    const res = await apiFetchRaw(`/api/forms/${encodeURIComponent(formId)}`);
    if (res.ok) return res.json();
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw(`/schemas/${formId}.json`);
  if (!res.ok) throw new Error(`Форма ${formId} не найдена`);
  return res.json();
}

export async function saveFormSchema(schema: FormSchema): Promise<FormSchema> {
  const res = await apiFetchRaw(`/api/forms/${encodeURIComponent(schema.id)}/schema`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface FormCellDefinitionDto {
  formId: string;
  rowId: string;
  columnKey: string;
  formulaA1?: string | null;
  formulaStable?: string | null;
  readonly?: boolean;
  style?: unknown;
  validation?: unknown;
  numberFormat?: string | null;
  helpText?: string | null;
}

export async function listFormCellDefinitions(
  formId: string
): Promise<FormCellDefinitionDto[]> {
  const res = await apiFetchRaw(
    `/api/forms/${encodeURIComponent(formId)}/cell-definitions`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveFormCellDefinition(
  formId: string,
  body: Omit<FormCellDefinitionDto, "formId">
): Promise<FormCellDefinitionDto[]> {
  const res = await apiFetchRaw(
    `/api/forms/${encodeURIComponent(formId)}/cell-definitions`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteFormCellDefinition(
  formId: string,
  rowId: string,
  columnKey: string
): Promise<{ deleted: number }> {
  const q = new URLSearchParams({ rowId, columnKey });
  const res = await apiFetchRaw(
    `/api/forms/${encodeURIComponent(formId)}/cell-definitions?${q}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function renameFormColumn(
  formId: string,
  fromKey: string,
  toKey: string
): Promise<{
  formId: string;
  fromKey: string;
  toKey: string;
  updated: Record<string, number>;
}> {
  const res = await apiFetchRaw(
    `/api/forms/${encodeURIComponent(formId)}/columns/rename`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromKey, toKey }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function reimportFormsFromJson(): Promise<{ reimported: number }> {
  const res = await apiFetchRaw("/api/forms/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function previewFormsImport() {
  const res = await apiFetchRaw("/api/forms/import-preview", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    added: string[];
    removed: string[];
    changed: string[];
    unchanged: number;
    jsonTotal: number;
    dbTotal: number;
  }>;
}

export async function createForm(payload: {
  id: string;
  title?: string;
  category?: string;
  cloneFrom?: string;
}) {
  const res = await apiFetchRaw("/api/forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<FormSchema>;
}

export async function archiveForm(formId: string, archived = true) {
  const res = await apiFetchRaw(`/api/forms/${encodeURIComponent(formId)}/archive`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<FormSchema>;
}

export async function fetchFormDependencies(
  formId: string,
  opts?: { columnKey?: string; rowNo?: string }
) {
  const sp = new URLSearchParams();
  if (opts?.columnKey) sp.set("columnKey", opts.columnKey);
  if (opts?.rowNo) sp.set("rowNo", opts.rowNo);
  const q = sp.toString() ? `?${sp}` : "";
  const res = await apiFetchRaw(`/api/forms/${encodeURIComponent(formId)}/dependencies${q}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    formId: string;
    totals: Record<string, number>;
    hits: Array<{ kind: string; ref: string; detail: string }>;
  }>;
}

export async function loadChecks(): Promise<ChecksData> {
  try {
    const res = await apiFetchRaw("/api/checks/export");
    if (res.ok) {
      const data = (await res.json()) as ChecksData;
      if (data.checks?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/checks.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила проверок");
  return res.json();
}

/** Access CheckItReorg* catalogues (a_tblchecks_Reorg*). */
export async function loadReorgChecks(): Promise<ReorgChecksData> {
  const res = await apiFetchRaw("/data/checks-reorg.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила CheckItReorg");
  return res.json();
}

export interface ChecksListResponse {
  total: number;
  limit: number;
  offset: number;
  items: import("./engine/checkEngine").CheckRule[];
}

export async function fetchChecksPage(params: {
  q?: string;
  formId?: string;
  active?: boolean;
  periodActive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ChecksListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.formId) sp.set("formId", params.formId);
  if (params.active) sp.set("active", "1");
  if (params.periodActive) sp.set("periodActive", "1");
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  return apiFetchRaw(`/api/checks?${sp}`).then((r) => {
    if (!r.ok) throw new Error("API checks unavailable");
    return r.json();
  });
}

export async function fetchCheckRule(number: number) {
  const res = await apiFetchRaw(`/api/checks/${number}`);
  if (!res.ok) throw new Error("Rule not found");
  return res.json();
}

export async function saveCheckRule(rule: import("./engine/checkEngine").CheckRule) {
  const res = await apiFetchRaw(`/api/checks/${rule.number}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCheckRule(rule: import("./engine/checkEngine").CheckRule) {
  const res = await apiFetchRaw("/api/checks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteCheckRule(number: number) {
  const res = await apiFetchRaw(`/api/checks/${number}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function reimportChecksFromJson() {
  const res = await apiFetchRaw("/api/checks/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export async function fetchChecksStats() {
  const res = await apiFetchRaw("/api/checks/stats");
  if (!res.ok) throw new Error("API unavailable");
  return res.json() as Promise<{
    total: number;
    active: number;
    periodActive: number;
    aggrOnly: number;
  }>;
}

export async function loadSaldoRules(): Promise<SaldoRulesData> {
  try {
    const res = await apiFetchRaw("/api/saldo/export");
    if (res.ok) {
      const data = (await res.json()) as SaldoRulesData;
      if (data.rules?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/saldo-rules.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила сальdo");
  return res.json();
}

export async function loadFormCorrespondence(): Promise<FormCorrespondenceData> {
  try {
    const res = await apiFetchRaw("/api/correspondence/export");
    if (res.ok) {
      const data = (await res.json()) as FormCorrespondenceData;
      if (data.forms?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/form-correspondence.json");
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
  const res = await apiFetchRaw("/data/row-formulas.json");
  if (!res.ok) throw new Error("Не удалось загрузить формулы строк");
  return res.json();
}

export interface RecalcRulesData {
  version: string;
  formsCount: number;
  total: number;
  byForm: Record<
    string,
    Array<{
      kind: string;
      rowNo?: number;
      formula?: string;
      sign?: string | null;
      sourceRow?: number;
      columns?: string;
      column?: string;
      sourceColumns?: string[];
    }>
  >;
}

export async function loadRecalcRules(): Promise<RecalcRulesData> {
  try {
    const res = await apiFetchRaw("/api/recalc/export");
    if (res.ok) {
      const data = (await res.json()) as RecalcRulesData;
      if (data.byForm && Object.keys(data.byForm).length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/recalc-rules.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила пересчёта");
  return res.json();
}

export interface ExcelMapping {
  id?: number;
  formName: string;
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: number | string | null;
  formColumn: string | null;
  formRow: number | null;
  period?: boolean;
  addText?: string | null;
}

export interface ExcelExportData {
  version: string;
  total: number;
  mappings: ExcelMapping[];
}

export async function loadExcelExport(): Promise<ExcelExportData> {
  try {
    const res = await apiFetchRaw("/api/excel/export");
    if (res.ok) {
      const data = (await res.json()) as ExcelExportData;
      if (data.mappings?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/excel-export.json");
  if (!res.ok) throw new Error("Не удалось загрузить Excel-маппинг");
  return res.json();
}

export interface SaldoListResponse {
  total: number;
  limit: number;
  offset: number;
  items: SaldoRule[];
}

export async function fetchSaldoPage(params: {
  q?: string;
  formId?: string;
  saldoType?: "t" | "s" | "g";
  limit?: number;
  offset?: number;
}): Promise<SaldoListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.formId) sp.set("formId", params.formId);
  if (params.saldoType) sp.set("saldoType", params.saldoType);
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  const res = await apiFetchRaw(`/api/saldo?${sp}`);
  if (!res.ok) throw new Error("API saldo unavailable");
  return res.json();
}

export async function fetchSaldoStats() {
  const res = await apiFetchRaw("/api/saldo/stats");
  if (!res.ok) throw new Error("API unavailable");
  return res.json() as Promise<{ total: number; typeT: number; typeS: number; typeG: number }>;
}

export async function saveSaldoRule(rule: SaldoRule) {
  const res = await apiFetchRaw(`/api/saldo/${rule.number}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SaldoRule>;
}

export async function createSaldoRule(rule: SaldoRule) {
  const res = await apiFetchRaw("/api/saldo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SaldoRule>;
}

export async function deleteSaldoRule(number: number) {
  const res = await apiFetchRaw(`/api/saldo/${number}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function reimportSaldoFromJson() {
  const res = await apiFetchRaw("/api/saldo/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export async function saveFormCorrespondence(item: FormCorrespondenceItem) {
  const res = await apiFetchRaw(`/api/correspondence/${encodeURIComponent(item.formId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<FormCorrespondenceItem>;
}

export async function reimportCorrespondenceFromJson() {
  const res = await apiFetchRaw("/api/correspondence/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export interface ExcelListResponse {
  total: number;
  limit: number;
  offset: number;
  items: ExcelMapping[];
}

export async function fetchExcelPage(params: {
  q?: string;
  formName?: string;
  limit?: number;
  offset?: number;
}): Promise<ExcelListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.formName) sp.set("formName", params.formName);
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  const res = await apiFetchRaw(`/api/excel?${sp}`);
  if (!res.ok) throw new Error("API excel unavailable");
  return res.json();
}

export async function fetchExcelStats() {
  const res = await apiFetchRaw("/api/excel/stats");
  if (!res.ok) throw new Error("API unavailable");
  return res.json() as Promise<{ total: number; formsCount: number }>;
}

export async function saveExcelMapping(mapping: ExcelMapping) {
  if (mapping.id) {
    const res = await apiFetchRaw(`/api/excel/${mapping.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapping),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<ExcelMapping>;
  }
  const res = await apiFetchRaw("/api/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mapping),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ExcelMapping>;
}

export async function deleteExcelMapping(id: number) {
  const res = await apiFetchRaw(`/api/excel/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function reimportExcelFromJson() {
  const res = await apiFetchRaw("/api/excel/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export interface EvalSnapshot {
  rowsByForm: Record<string, import("./types").RowData[]>;
  cellIndex: Record<string, Record<string, Record<string, number>>>;
}

export async function fetchEvalSnapshot(): Promise<EvalSnapshot | null> {
  try {
    const res = await apiFetchRaw("/api/instances/eval-snapshot");
    if (res.ok) return res.json() as Promise<EvalSnapshot>;
  } catch {
    /* API unavailable */
  }
  return null;
}

export async function fetchInstanceStorageStats() {
  const res = await apiFetchRaw("/api/instances/stats");
  if (!res.ok) throw new Error("API unavailable");
  return res.json() as Promise<{
    instances: number;
    cells: number;
    legacyPayloads: number;
    pendingMigration: number;
  }>;
}

export interface AuditLogItem {
  id: number;
  action: string;
  instance_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor: string | null;
  details: string | null;
  created_at: string;
}

export interface AuditListResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditLogItem[];
}

export async function fetchAuditPage(params: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  const res = await apiFetchRaw(`/api/audit?${sp}`);
  if (!res.ok) throw new Error("API audit unavailable");
  return res.json();
}

export type { RashRule, RashAddsum, RashRulesData, RashThresholds };

export async function loadRashRules(): Promise<RashRulesData> {
  try {
    const res = await apiFetchRaw("/api/rash/export");
    if (res.ok) {
      const data = (await res.json()) as RashRulesData;
      if (data.rules?.length) return data;
    }
  } catch {
    /* API unavailable */
  }
  const res = await apiFetchRaw("/data/rash-rules.json");
  if (!res.ok) throw new Error("Не удалось загрузить правила расшифровок");
  return res.json();
}

export interface RashListResponse {
  total: number;
  limit: number;
  offset: number;
  items: RashRule[];
}

export async function fetchRashPage(params: {
  q?: string;
  formId?: string;
  limit?: number;
  offset?: number;
}): Promise<RashListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.formId) sp.set("formId", params.formId);
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  const res = await apiFetchRaw(`/api/rash?${sp}`);
  if (!res.ok) throw new Error("API rash unavailable");
  return res.json();
}

export async function fetchRashStats() {
  const res = await apiFetchRaw("/api/rash/stats");
  if (!res.ok) throw new Error("API rash stats unavailable");
  return res.json() as Promise<{ total: number; addsum: number; withFormula: number }>;
}

export async function fetchRashThresholds(): Promise<RashThresholds> {
  try {
    const res = await apiFetchRaw("/api/rash/thresholds");
    if (res.ok) return res.json();
  } catch {
    /* fallback */
  }
  const data = await loadRashRules();
  return data.thresholds;
}

export async function saveRashThresholds(thresholds: RashThresholds): Promise<RashThresholds> {
  const res = await apiFetchRaw("/api/rash/thresholds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(thresholds),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRashRule(kod: number) {
  const res = await apiFetchRaw(`/api/rash/${kod}`);
  if (!res.ok) throw new Error("Not found");
  return res.json() as Promise<RashRule & { addsum: RashAddsum[] }>;
}

export async function saveRashRule(rule: RashRule) {
  const res = await apiFetchRaw(`/api/rash/${rule.kod}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RashRule>;
}

export async function createRashRule(rule: RashRule) {
  const res = await apiFetchRaw("/api/rash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RashRule>;
}

export async function deleteRashRule(kod: number) {
  const res = await apiFetchRaw(`/api/rash/${kod}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function reimportRashFromJson() {
  const res = await apiFetchRaw("/api/rash/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export async function saveRashAddsum(kod: number, items: RashAddsum[]) {
  const res = await apiFetchRaw(`/api/rash/${kod}/addsum`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RashAddsum[]>;
}

export interface RashPlacement {
  formId: string;
  rowNo: string;
  columnKey: string;
  kod: number;
}

export async function fetchRashPlacements(kod: number) {
  const res = await apiFetchRaw(`/api/rash/${kod}/placements`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RashPlacement[]>;
}

export async function saveRashPlacements(
  kod: number,
  items: Array<Omit<RashPlacement, "kod"> & { kod?: number }>
) {
  const res = await apiFetchRaw(`/api/rash/${kod}/placements`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<RashPlacement[]>;
}

export async function reimportRashPlacementsFromJson() {
  const res = await apiFetchRaw("/api/rash/placements/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ reimported: number }>;
}

export async function fetchNextRashKod() {
  const res = await apiFetchRaw("/api/rash/next-kod");
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ kod: number }>;
}

export async function saveRashBundle(payload: {
  rule: RashRule;
  addsum: RashAddsum[];
  placements: Array<Omit<RashPlacement, "kod"> & { kod?: number }>;
  forceConflicts?: boolean;
}) {
  const res = await apiFetchRaw("/api/rash/bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; conflicts?: RashPlacement[] } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: string; conflicts?: RashPlacement[] };
    } catch {
      /* ignore */
    }
    const err = new Error(parsed?.error || text) as Error & {
      conflicts?: Array<{
        formId: string;
        rowNo: string;
        columnKey: string;
        existingKod: number;
      }>;
    };
    if (parsed && "conflicts" in (parsed as object)) {
      err.conflicts = (parsed as { conflicts: typeof err.conflicts }).conflicts;
    }
    throw err;
  }
  return res.json() as Promise<{
    rule: RashRule;
    addsum: RashAddsum[];
    placements: RashPlacement[];
    conflicts: Array<{
      formId: string;
      rowNo: string;
      columnKey: string;
      existingKod: number;
    }>;
  }>;
}

export async function fetchRashUsage(kod: number) {
  const res = await apiFetchRaw(`/api/rash/${kod}/usage`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    kod: number;
    placementCount: number;
    forms: string[];
    samplePlacements: RashPlacement[];
    entryCount: number;
    instanceCount: number;
  }>;
}

export async function previewRashRulesImport() {
  const res = await apiFetchRaw("/api/rash/import-preview", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    added: number[];
    removed: number[];
    changed: number[];
    unchanged: number;
    jsonTotal: number;
    dbTotal: number;
  }>;
}

export async function previewRashPlacementsImport() {
  const res = await apiFetchRaw("/api/rash/placements/import-preview", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    jsonTotal: number;
    dbTotal: number;
    sampleConflicts: Array<{
      formId: string;
      rowNo: string;
      columnKey: string;
      existingKod: number;
    }>;
  }>;
}
