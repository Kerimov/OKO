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

export async function reimportFormsFromJson(): Promise<{ reimported: number }> {
  const res = await apiFetchRaw("/api/forms/reimport", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
