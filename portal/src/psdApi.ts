import { apiFetch } from "./apiClient";

export type PackageKind = "OKO" | "BALANCE";

export type BpStatus =
  | "not_started"
  | "collecting"
  | "pending_curator_approval"
  | "curator_approved"
  | "completed";

export type BpAction =
  | "start"
  | "submit_for_approval"
  | "curator_approve"
  | "curator_return"
  | "complete"
  | "reopen";

export interface BusinessProcessDto {
  id: string;
  eid: number;
  zid: number;
  packageKind: PackageKind;
  status: BpStatus;
  curatorUserId: number | null;
  deadlineAt: string | null;
  iteration: number;
  note: string | null;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  createdAt?: string;
  organizationName?: string | null;
  periodName?: string | null;
  curatorName?: string | null;
}

export interface BpEventDto {
  id: number;
  bpId: string;
  fromStatus: string | null;
  toStatus: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export interface ApprovalBlockers {
  blocked: boolean;
  missingExplanations: Array<{
    ruleNumber: number;
    formId?: string | null;
    message: string | null;
  }>;
}

export type CollectionUnitKind = "organization" | "branch" | "unit";

export interface CollectionUnitDto {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
  unitKind: CollectionUnitKind;
  headZid: number | null;
  branchCode: string | null;
  unitCode: string | null;
  compositeCode: string | null;
  guid: string | null;
}

export interface KontrVersionDto {
  id: number;
  kontrId: number;
  guid: string | null;
  versionNo: number;
  validFrom: string | null;
  validTo: string | null;
  name: string;
  oldName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  orgForm: string | null;
  orgType: number | null;
  mandatoryRash: boolean;
  country: string | null;
  city: string | null;
  idObdnsi: string | null;
  card: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
}

export interface KontrUsageHit {
  formId: string;
  instanceId: string;
  eid: number | null;
  zid: number | null;
  rowNo: number | null;
  columnKey: string | null;
  source: "rash" | "cell_comment";
}

export interface CheckExplanationDto {
  id: number;
  zid: number;
  eid: number;
  packageKind: PackageKind;
  ruleNumber: number;
  formId: string | null;
  explanation: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckJournalEntryDto {
  id: number;
  runId: string;
  zid: number;
  eid: number;
  packageKind: PackageKind;
  ruleNumber: number | null;
  checkType: string | null;
  passed: boolean;
  leftValue: number | null;
  rightValue: number | null;
  message: string | null;
  formId: string | null;
  requiresExplanation: boolean;
  explanationId: number | null;
  actor: string | null;
  createdAt: string;
}

export interface SvodDefinitionDto {
  id: string;
  eid: number;
  packageKind: PackageKind;
  code: string;
  name: string;
  createdAt: string;
  createdBy: string | null;
  members: Array<{
    id: number;
    svodId: string;
    organizationGuid: string | null;
    zid: number | null;
    included: boolean;
    headCompany: string | null;
    flagRsbu: boolean;
    flagMgk: boolean;
    flagNkdo: boolean;
  }>;
}

export type TransferMapKind = "period_to_period" | "balance_to_oko" | "oko_to_balance";

export interface TransferMapDto {
  id: number;
  kind: TransferMapKind;
  sourceForm: string;
  sourceColumn: string | null;
  sourceRow: string | null;
  targetForm: string;
  targetColumn: string | null;
  targetRow: string | null;
  condition: Record<string, unknown>;
  aggregation: string | null;
  excludeRows: string | null;
  active: boolean;
  sortOrder: number;
}

export interface MinfinMappingDto {
  id: number;
  templateName: string;
  sheetName: string | null;
  excelRow: number | null;
  excelColumn: string | null;
  formId: string | null;
  formColumn: string | null;
  formRow: string | null;
  signFactor: number;
  isHeader: boolean;
  periodToken: string | null;
  active: boolean;
}

export interface CellCommentDto {
  id: number;
  instanceId: string;
  formId: string;
  rowNo: number;
  columnKey: string;
  amount: number | null;
  articleCode: string | null;
  kontrId: number | null;
  freeText: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationStatus {
  doXml: { name: string; configured: boolean };
  sap: { name: string; configured: boolean };
  eds: { name: string; configured: boolean };
  minfin: { name: string; configured: boolean };
  docs: string;
}

export interface MinFinExportResult {
  ok: boolean;
  code?: string;
  message?: string;
  mappingCount?: number;
  filename?: string;
  base64?: string;
}

/* ── Business processes ── */

export async function listBusinessProcesses(filter?: {
  eid?: number;
  zid?: number;
  status?: string;
  packageKind?: PackageKind;
  curatorUserId?: number;
}): Promise<BusinessProcessDto[]> {
  const q = new URLSearchParams();
  if (filter?.eid != null) q.set("eid", String(filter.eid));
  if (filter?.zid != null) q.set("zid", String(filter.zid));
  if (filter?.status) q.set("status", filter.status);
  if (filter?.packageKind) q.set("packageKind", filter.packageKind);
  if (filter?.curatorUserId != null) q.set("curatorUserId", String(filter.curatorUserId));
  const qs = q.toString();
  return apiFetch<BusinessProcessDto[]>(`/api/business-processes${qs ? `?${qs}` : ""}`);
}

export async function ensureBusinessProcess(input: {
  zid: number;
  eid: number;
  packageKind?: PackageKind;
}): Promise<BusinessProcessDto> {
  return apiFetch<BusinessProcessDto>("/api/business-processes/ensure", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function transitionBusinessProcess(
  id: string,
  action: BpAction,
  note?: string
): Promise<BusinessProcessDto> {
  return apiFetch<BusinessProcessDto>(
    `/api/business-processes/${encodeURIComponent(id)}/transition`,
    { method: "POST", body: JSON.stringify({ action, note }) }
  );
}

export async function assignBpCurator(
  id: string,
  input: { curatorUserId: number | null; deadlineAt?: string | null }
): Promise<BusinessProcessDto> {
  return apiFetch<BusinessProcessDto>(
    `/api/business-processes/${encodeURIComponent(id)}/curator`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function getBpApprovalBlockers(id: string): Promise<ApprovalBlockers> {
  return apiFetch<ApprovalBlockers>(
    `/api/business-processes/${encodeURIComponent(id)}/approval-blockers`
  );
}

export async function listBpEvents(id: string): Promise<BpEventDto[]> {
  return apiFetch<BpEventDto[]>(
    `/api/business-processes/${encodeURIComponent(id)}/events`
  );
}

/* ── Collection units ── */

export async function listCollectionUnits(): Promise<CollectionUnitDto[]> {
  return apiFetch<CollectionUnitDto[]>("/api/collection-units");
}

export async function upsertCollectionUnit(
  zid: number,
  body: {
    name: string;
    code?: string | null;
    parentZid?: number | null;
    unitKind?: CollectionUnitKind;
    headZid?: number | null;
    branchCode?: string | null;
    unitCode?: string | null;
    guid?: string | null;
    headCode?: string | null;
  }
): Promise<CollectionUnitDto> {
  return apiFetch<CollectionUnitDto>(`/api/collection-units/${zid}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/* ── Kontr versions ── */

export async function listKontrVersions(kontrId: number): Promise<KontrVersionDto[]> {
  return apiFetch<KontrVersionDto[]>(`/api/kontr-versions/${kontrId}`);
}

export async function createKontrVersion(
  kontrId: number,
  body: {
    validFrom?: string | null;
    validTo?: string | null;
    fields: {
      name: string;
      oldName?: string | null;
      inn?: string | null;
      kpp?: string | null;
      ogrn?: string | null;
      orgForm?: string | null;
      orgType?: number | null;
      mandatoryRash?: boolean;
      country?: string | null;
      city?: string | null;
      idObdnsi?: string | null;
      card?: Record<string, unknown>;
    };
  }
): Promise<KontrVersionDto> {
  return apiFetch<KontrVersionDto>(`/api/kontr-versions/${kontrId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listKontrUsages(kontrId: number): Promise<KontrUsageHit[]> {
  return apiFetch<KontrUsageHit[]>(`/api/kontr-versions/${kontrId}/usages`);
}

export async function archiveKontrVersion(
  kontrId: number,
  force?: boolean
): Promise<{ archived: boolean; usages?: KontrUsageHit[] }> {
  return apiFetch(`/api/kontr-versions/${kontrId}/archive`, {
    method: "POST",
    body: JSON.stringify({ force: !!force }),
  });
}

/* ── Checks / explanations ── */

export async function listCheckExplanations(
  zid: number,
  eid: number,
  packageKind?: PackageKind
): Promise<CheckExplanationDto[]> {
  const q = new URLSearchParams({ zid: String(zid), eid: String(eid) });
  if (packageKind) q.set("packageKind", packageKind);
  return apiFetch<CheckExplanationDto[]>(`/api/psd-checks/explanations?${q}`);
}

export async function upsertCheckExplanation(body: {
  zid: number;
  eid: number;
  packageKind?: PackageKind;
  ruleNumber: number;
  formId?: string | null;
  explanation: string;
}): Promise<CheckExplanationDto> {
  return apiFetch<CheckExplanationDto>("/api/psd-checks/explanations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function appendCheckJournal(body: {
  zid: number;
  eid: number;
  packageKind?: PackageKind;
  results: Array<{
    ruleNumber?: number | null;
    checkType?: string | null;
    passed: boolean;
    leftValue?: number | null;
    rightValue?: number | null;
    message?: string | null;
    formId?: string | null;
    requiresExplanation?: boolean;
  }>;
}): Promise<{ runId: string; inserted: number }> {
  return apiFetch("/api/psd-checks/journal", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listCheckJournal(input: {
  zid: number;
  eid: number;
  packageKind?: PackageKind;
  runId?: string;
}): Promise<CheckJournalEntryDto[]> {
  const q = new URLSearchParams({
    zid: String(input.zid),
    eid: String(input.eid),
  });
  if (input.packageKind) q.set("packageKind", input.packageKind);
  if (input.runId) q.set("runId", input.runId);
  return apiFetch<CheckJournalEntryDto[]>(`/api/psd-checks/journal?${q}`);
}

export async function getCheckApprovalBlockers(
  zid: number,
  eid: number,
  packageKind?: PackageKind
): Promise<ApprovalBlockers> {
  const q = new URLSearchParams({ zid: String(zid), eid: String(eid) });
  if (packageKind) q.set("packageKind", packageKind);
  return apiFetch<ApprovalBlockers>(`/api/psd-checks/approval-blockers?${q}`);
}

export async function parseCheckDsl(
  expression: string
): Promise<{ ok: boolean; ast?: unknown; error?: string }> {
  return apiFetch("/api/psd-checks/dsl/parse", {
    method: "POST",
    body: JSON.stringify({ expression }),
  });
}

/* ── Svods ── */

export async function listSvods(eid?: number): Promise<SvodDefinitionDto[]> {
  const q = eid != null ? `?eid=${eid}` : "";
  return apiFetch<SvodDefinitionDto[]>(`/api/svods${q}`);
}

export async function createSvod(body: {
  eid: number;
  packageKind?: PackageKind;
  code: string;
  name: string;
  members?: Array<Record<string, unknown>>;
}): Promise<SvodDefinitionDto> {
  return apiFetch<SvodDefinitionDto>("/api/svods", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSvodDetail(input: {
  zid: number;
  eid: number;
  formId?: string;
}): Promise<unknown> {
  const q = new URLSearchParams({
    zid: String(input.zid),
    eid: String(input.eid),
  });
  if (input.formId) q.set("formId", input.formId);
  return apiFetch(`/api/svods/detail?${q}`);
}

/* ── Transfers ── */

export async function listTransferMaps(kind?: TransferMapKind): Promise<TransferMapDto[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return apiFetch<TransferMapDto[]>(`/api/transfers${q}`);
}

export async function bulkUpsertTransferMaps(
  items: Array<Record<string, unknown>>
): Promise<{ upserted: number }> {
  return apiFetch("/api/transfers/bulk", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function applyTransfers(body: {
  sourceZid: number;
  sourceEid: number;
  targetZid: number;
  targetEid: number;
  packageKind?: PackageKind;
  kind?: TransferMapKind;
}): Promise<{ applied: number; message?: string }> {
  return apiFetch("/api/transfers/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ── MinFin ── */

export async function listMinfinMappings(
  templateName?: string
): Promise<MinfinMappingDto[]> {
  const q = templateName
    ? `?templateName=${encodeURIComponent(templateName)}`
    : "";
  return apiFetch<MinfinMappingDto[]>(`/api/minfin/mappings${q}`);
}

export async function bulkUpsertMinfinMappings(
  items: Array<Record<string, unknown>>
): Promise<{ upserted: number }> {
  return apiFetch("/api/minfin/mappings/bulk", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function exportMinfin(body: {
  eid: number;
  zid: number;
  templateName?: string;
}): Promise<MinFinExportResult> {
  return apiFetch<MinFinExportResult>("/api/minfin/export", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Download MinFin export result as .xlsx in the browser. */
export function downloadMinfinExport(res: MinFinExportResult): boolean {
  if (!res.ok || !res.base64) return false;
  const bin = atob(res.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = res.filename || "minfin.xlsx";
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/* ── Cell comments ── */

export async function listCellComments(
  instanceId: string
): Promise<CellCommentDto[]> {
  return apiFetch<CellCommentDto[]>(
    `/api/cell-comments?instanceId=${encodeURIComponent(instanceId)}`
  );
}

export async function upsertCellComment(body: {
  instanceId: string;
  formId: string;
  rowNo: number;
  columnKey: string;
  amount?: number | null;
  articleCode?: string | null;
  kontrId?: number | null;
  freeText?: string | null;
}): Promise<CellCommentDto> {
  return apiFetch<CellCommentDto>("/api/cell-comments", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ── Integrations (read-only status) ── */

export async function getIntegrationsStatus(): Promise<IntegrationStatus> {
  return apiFetch<IntegrationStatus>("/api/integrations/status");
}
