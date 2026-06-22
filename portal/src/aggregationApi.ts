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

export interface RunAggregationResult {
  parentZid: number;
  eid: number;
  children: number[];
  aggregated: number;
  skipped: number;
  missing: string[];
  instanceIds: string[];
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

export async function runPackageAggregation(
  parentZid: number,
  eid: number
): Promise<RunAggregationResult> {
  return apiFetch<RunAggregationResult>("/api/aggregation/run", {
    method: "POST",
    body: JSON.stringify({ parentZid, eid }),
  });
}

export async function reimportAggFromJson(): Promise<{ reimported: number }> {
  return apiFetch("/api/aggregation/reimport", { method: "POST" });
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
