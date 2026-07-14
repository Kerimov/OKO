import { apiFetch } from "./apiClient";

export interface AggListEntry {
  id: number;
  parentZid: number;
  childZid: number;
  included: boolean;
  parentName?: string | null;
  childName?: string | null;
  parentCode?: string | null;
  childCode?: string | null;
}

export interface AggStats {
  total: number;
  included: number;
  parents: number;
}

export type AggregationColorMode = "full" | "green" | "yellow" | "red" | "blue";

export interface RunAggregationOptions {
  parentZid: number;
  eid: number;
  childZids?: number[];
  formIds?: string[];
  requireAllChildren?: boolean;
  recalc?: boolean;
  colorMode?: AggregationColorMode;
  reorg?: boolean;
  updateCorrSet?: boolean;
  targetZid?: number;
}

export interface AggFormPreview {
  formId: string;
  title: string;
  presentChildZids: number[];
  missingChildZids: number[];
  ready: boolean;
  willAggregate: boolean;
  maskPresent?: boolean;
  skippedReason?: "no-color-spec" | "reorg-update-blocked" | "no-existing-corr" | null;
}

export interface AggregationPreview {
  parentZid: number;
  eid: number;
  children: number[];
  forms: AggFormPreview[];
  willAggregate: number;
  willSkip: number;
  targetZid?: number;
}

export interface RunAggregationResult {
  parentZid: number;
  eid: number;
  children: number[];
  aggregated: number;
  skipped: number;
  missing: string[];
  instanceIds: string[];
  targetZid?: number;
  forms?: Array<{
    formId: string;
    status: "ok" | "skipped" | "partial";
    sourceChildZids: number[];
    instanceId?: string;
  }>;
}

export type CorrSetKind = "correct" | "mirror";

export interface AggCorrSet {
  id: number;
  parentZid: number;
  corrZid: number;
  kind: CorrSetKind;
  sourceEid: number;
  label: string | null;
  corrName?: string | null;
  corrCode?: string | null;
  formCount?: number;
}

export async function fetchAggStats(): Promise<AggStats> {
  return apiFetch<AggStats>("/api/aggregation/stats");
}

export async function listAggEntries(parentZid?: number): Promise<AggListEntry[]> {
  const q = parentZid != null ? `?parentZid=${parentZid}` : "";
  return apiFetch<AggListEntry[]>(`/api/aggregation/list${q}`);
}

export async function createAggEntry(input: {
  parentZid: number;
  childZid: number;
  included?: boolean;
}): Promise<AggListEntry> {
  return apiFetch<AggListEntry>("/api/aggregation/list", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAggEntry(
  id: number,
  input: { parentZid: number; childZid: number; included?: boolean }
): Promise<AggListEntry> {
  return apiFetch<AggListEntry>(`/api/aggregation/list/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAggEntry(id: number): Promise<void> {
  await apiFetch(`/api/aggregation/list/${id}`, { method: "DELETE" });
}

export async function previewPackageAggregation(
  options: RunAggregationOptions
): Promise<AggregationPreview> {
  return apiFetch<AggregationPreview>("/api/aggregation/preview", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function runPackageAggregation(
  parentZidOrOpts: number | RunAggregationOptions,
  eid?: number
): Promise<RunAggregationResult> {
  const body: RunAggregationOptions =
    typeof parentZidOrOpts === "number"
      ? { parentZid: parentZidOrOpts, eid: eid! }
      : parentZidOrOpts;
  return apiFetch<RunAggregationResult>("/api/aggregation/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function reimportAggFromJson(): Promise<{ reimported: number }> {
  return apiFetch("/api/aggregation/reimport", { method: "POST" });
}

export async function listCorrSets(parentZid: number): Promise<AggCorrSet[]> {
  return apiFetch<AggCorrSet[]>(`/api/aggregation/corr-sets?parentZid=${parentZid}`);
}

export async function createCorrSet(input: {
  parentZid: number;
  eid: number;
  kind?: CorrSetKind;
  label?: string;
}): Promise<{ set: AggCorrSet; formsCreated: number; formsMirrored: number }> {
  return apiFetch("/api/aggregation/corr-sets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCorrSet(id: number): Promise<void> {
  await apiFetch(`/api/aggregation/corr-sets/${id}`, { method: "DELETE" });
}

export interface AggrAccountValidationResult {
  ok: boolean;
  message?: string;
  zid: number;
  eid: number;
  forms: Array<{
    formId: "N01_01" | "N01_02";
    tempRows: number;
    unusedAccounts: Array<{ account: string; name?: string }>;
    missingRowMappings: Array<{ account: string; row: string; name?: string }>;
    blankAccountCells: Array<{ hint: string; name?: string }>;
    orphanAmounts: Array<{ account: string; name?: string }>;
    issues: Array<{
      kind: string;
      account?: string;
      row?: string;
      name?: string;
      detail?: string;
    }>;
  }>;
  totals: {
    tempRows: number;
    unusedAccounts: number;
    missingRowMappings: number;
    blankAccountCells: number;
    orphanAmounts: number;
  };
}

export async function validateAccountRows(input: {
  parentZid: number;
  eid: number;
  targetZid?: number;
  forms?: string[];
}): Promise<AggrAccountValidationResult> {
  return apiFetch<AggrAccountValidationResult>("/api/aggregation/account-rows", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface RelationsAccRowsApiResult {
  ok: boolean;
  message?: string;
  zid: number;
  eid: number;
  compared: number;
  mismatched: number;
  skipped: number;
  tolerance: number;
  rows: Array<{
    row: string;
    debit: number;
    credit: number;
    balance: number;
    balanceH: number;
    delta: number;
    matched: boolean;
    skipped: boolean;
    name?: string;
  }>;
}

export interface FillBalanceApiResult {
  ok: boolean;
  message?: string;
  zid: number;
  eid: number;
  mode: "ifEmpty" | "overwrite";
  updated: number;
  skippedNonEmpty: number;
  skippedUnchecking: number;
  instanceId?: string;
}

export async function checkAccountRelations(input: {
  parentZid: number;
  eid: number;
  targetZid?: number;
}): Promise<RelationsAccRowsApiResult> {
  return apiFetch<RelationsAccRowsApiResult>("/api/aggregation/account-rows/relations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fillBalanceFromAccounts(input: {
  parentZid: number;
  eid: number;
  targetZid?: number;
  mode?: "ifEmpty" | "overwrite";
}): Promise<FillBalanceApiResult> {
  return apiFetch<FillBalanceApiResult>("/api/aggregation/account-rows/fill-balance", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loadAggListJson(): Promise<{
  version: string;
  total: number;
  entries: Array<{
    parentCode?: string;
    childCode?: string;
    included?: boolean;
    parentName?: string;
    childName?: string;
  }>;
}> {
  const res = await fetch("/data/agg-list.json");
  if (!res.ok) throw new Error("agg-list.json not found");
  return res.json();
}
