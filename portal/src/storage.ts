import type {
  FormMeta,
  FormSchema,
  InstanceSummary,
  OkoFormInstance,
  KontrAgent,
  FormRashEntry,
} from "./types";
import { buildInitialRows } from "./utils";
import { apiFetch } from "./apiClient";
import { initAuth } from "./auth";

const INDEX_KEY = "oko-instances-index";
const INSTANCE_PREFIX = "oko-instance-";
const GLOBAL_META = "oko-global-meta";
const MIGRATED_KEY = "oko-migrated-to-api";

export interface GlobalMeta extends FormMeta {}

let useBackend = false;

export function isBackendMode(): boolean {
  return useBackend;
}

export async function initStorage(): Promise<boolean> {
  try {
    await apiFetch<{ ok: boolean }>("/api/health");
    useBackend = true;
    await initAuth();
    await migrateLocalToBackend();
    return true;
  } catch {
    useBackend = false;
    return false;
  }
}

function readIndexLocal(): InstanceSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function writeIndexLocal(list: InstanceSummary[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

function summaryFromInstance(inst: OkoFormInstance): InstanceSummary {
  return {
    instanceId: inst.instanceId,
    templateId: inst.templateId,
    templateTitle: inst.templateTitle,
    displayName: inst.displayName,
    organization: inst.meta.organization,
    periodStart: inst.meta.periodStart,
    periodEnd: inst.meta.periodEnd,
    zid: inst.zid ?? null,
    eid: inst.eid ?? null,
    status: inst.status ?? "draft",
    createdAt: inst.createdAt,
    updatedAt: inst.updatedAt,
  };
}

export function defaultDisplayName(
  templateId: string,
  templateTitle: string,
  meta: FormMeta
): string {
  const date = new Date().toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (meta.organization.trim()) {
    return `${templateId} — ${meta.organization.trim().slice(0, 40)} — ${date}`;
  }
  const shortTitle =
    templateTitle.length > 45 ? templateTitle.slice(0, 45) + "…" : templateTitle;
  return `${templateId} — ${shortTitle} — ${date}`;
}

async function migrateLocalToBackend(): Promise<void> {
  if (localStorage.getItem(MIGRATED_KEY)) return;
  const instances = readIndexLocal()
    .map((s) => {
      try {
        const raw = localStorage.getItem(INSTANCE_PREFIX + s.instanceId);
        return raw ? (JSON.parse(raw) as OkoFormInstance) : null;
      } catch {
        return null;
      }
    })
    .filter((i): i is OkoFormInstance => i !== null);

  if (instances.length === 0 && !localStorage.getItem(GLOBAL_META)) {
    localStorage.setItem(MIGRATED_KEY, "1");
    return;
  }

  const settings: Record<string, string> = {};
  const metaRaw = localStorage.getItem(GLOBAL_META);
  if (metaRaw) settings.globalMeta = metaRaw;

  await apiFetch("/api/instances/migrate", {
    method: "POST",
    body: JSON.stringify({ instances, settings }),
  });
  for (const inst of instances) {
    localStorage.removeItem(INSTANCE_PREFIX + inst.instanceId);
  }
  writeIndexLocal([]);
  localStorage.setItem(MIGRATED_KEY, "1");
}

export async function loadGlobalMeta(): Promise<GlobalMeta> {
  const fallback: GlobalMeta = {
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  };
  if (!useBackend) {
    try {
      const raw = localStorage.getItem(GLOBAL_META);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return fallback;
  }
  try {
    const data = await apiFetch<Record<string, string>>("/api/settings");
    if (data.globalMeta) return JSON.parse(data.globalMeta);
  } catch {
    /* ignore */
    }
  return fallback;
}

export async function saveGlobalMeta(meta: GlobalMeta): Promise<void> {
  if (!useBackend) {
    localStorage.setItem(GLOBAL_META, JSON.stringify(meta));
    return;
  }
  await apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ globalMeta: JSON.stringify(meta) }),
  });
}

export async function createInstance(schema: FormSchema): Promise<OkoFormInstance> {
  const { loadWorkContext, listOrganizations, listPeriods } = await import("./packagesApi");
  const global = await loadGlobalMeta();
  const work = await loadWorkContext();
  const now = new Date().toISOString();

  let organization = global.organization;
  let periodStart = global.periodStart;
  let periodEnd = global.periodEnd;

  if (work.zid != null && work.eid != null) {
    const orgs = await listOrganizations();
    const org = orgs.find((o) => o.zid === work.zid);
    if (org) organization = org.name;
    const periods = await listPeriods(work.zid);
    const period = periods.find((p) => p.eid === work.eid);
    if (period) {
      periodStart = period.periodStart ?? periodStart;
      periodEnd = period.periodEnd ?? periodEnd;
    }
  }

  const meta: FormMeta = {
    organization,
    enterpriseCode: global.enterpriseCode || schema.meta.enterpriseCode,
    periodStart,
    periodEnd,
    unit: global.unit || schema.meta.unit,
  };
  const signatures: Record<string, string> = {};
  for (const name of schema.signatures) signatures[name] = "";

  const instance: OkoFormInstance = {
    instanceId: crypto.randomUUID(),
    templateId: schema.id,
    templateTitle: schema.title,
    displayName: defaultDisplayName(schema.id, schema.title, meta),
    zid: work.zid,
    eid: work.eid,
    meta,
    rows: buildInitialRows(schema),
    signatures,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  await saveInstance(instance);
  return instance;
}

export async function saveInstance(instance: OkoFormInstance): Promise<void> {
  instance.updatedAt = new Date().toISOString();

  if (!useBackend) {
    localStorage.setItem(
      INSTANCE_PREFIX + instance.instanceId,
      JSON.stringify(instance)
    );
    const summary = summaryFromInstance(instance);
    const index = readIndexLocal().filter((s) => s.instanceId !== instance.instanceId);
    index.push(summary);
    index.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    writeIndexLocal(index);
    return;
  }

  const existing = await loadInstance(instance.instanceId);
  if (existing) {
    await apiFetch(`/api/instances/${instance.instanceId}`, {
      method: "PUT",
      body: JSON.stringify(instance),
    });
  } else {
    await apiFetch("/api/instances", {
      method: "POST",
      body: JSON.stringify(instance),
    });
  }
}

/** Batch cell patch (optimistic revision). Backend only. */
export async function patchInstanceCells(
  instanceId: string,
  cells: Array<{ rowNo: number; columnKey: string; value?: string | number | null }>,
  expectedRevision?: number
): Promise<{ revision: number; updated: number }> {
  if (!useBackend) {
    throw new Error("patchInstanceCells требует API-сервер");
  }
  return apiFetch(`/api/instances/${instanceId}/cells`, {
    method: "PATCH",
    body: JSON.stringify({ cells, expectedRevision }),
  });
}

/**
 * Persist many instances atomically when API is available (single DB transaction).
 * Offline/local mode updates all localStorage keys in one pass (same process).
 */
export async function saveInstancesAtomic(
  instances: OkoFormInstance[]
): Promise<{ saved: number }> {
  if (!instances.length) return { saved: 0 };
  const now = new Date().toISOString();
  const stamped = instances.map((inst) => ({ ...inst, updatedAt: now }));

  if (!useBackend) {
    const index = readIndexLocal();
    const byId = new Map(index.map((s) => [s.instanceId, s]));
    for (const instance of stamped) {
      localStorage.setItem(
        INSTANCE_PREFIX + instance.instanceId,
        JSON.stringify(instance)
      );
      byId.set(instance.instanceId, summaryFromInstance(instance));
    }
    const next = Array.from(byId.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    writeIndexLocal(next);
    return { saved: stamped.length };
  }

  return apiFetch<{ saved: number }>("/api/instances/batch", {
    method: "POST",
    body: JSON.stringify({ instances: stamped }),
  });
}

export async function setInstanceStatus(
  instanceId: string,
  status: "draft" | "submitted"
): Promise<OkoFormInstance> {
  if (!useBackend) {
    const inst = await loadInstance(instanceId);
    if (!inst) throw new Error("Not found");
    const updated = { ...inst, status, updatedAt: new Date().toISOString() };
    await saveInstance(updated);
    return updated;
  }
  return apiFetch<OkoFormInstance>(`/api/instances/${instanceId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** Server dry-run of period checks (Nest). Offline mode returns null. */
export async function runInstanceChecks(
  instanceId: string,
  mode: "period" | "active" | "all" = "period"
): Promise<import("./engine/checkEngine").CheckRunResult | null> {
  if (!useBackend) return null;
  return apiFetch(`/api/instances/${instanceId}/run-checks`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function loadInstance(instanceId: string): Promise<OkoFormInstance | null> {
  if (!useBackend) {
    try {
      const raw = localStorage.getItem(INSTANCE_PREFIX + instanceId);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    return await apiFetch<OkoFormInstance>(`/api/instances/${instanceId}`);
  } catch {
    return null;
  }
}

function purgeInstanceLocal(instanceId: string): void {
  localStorage.removeItem(INSTANCE_PREFIX + instanceId);
  writeIndexLocal(readIndexLocal().filter((s) => s.instanceId !== instanceId));
}

export async function deleteInstance(instanceId: string): Promise<void> {
  purgeInstanceLocal(instanceId);
  if (!useBackend) {
    return;
  }
  await apiFetch(`/api/instances/${instanceId}`, { method: "DELETE" });
}

export async function listInstances(filter?: {
  zid?: number;
  eid?: number;
}): Promise<InstanceSummary[]> {
  if (!useBackend) {
    let list = readIndexLocal();
    if (filter?.zid != null) {
      const zid = Number(filter.zid);
      list = list.filter((s) => Number(s.zid) === zid);
    }
    if (filter?.eid != null) {
      const eid = Number(filter.eid);
      list = list.filter((s) => Number(s.eid) === eid);
    }
    return list.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }
  const params = new URLSearchParams();
  if (filter?.zid != null) params.set("zid", String(filter.zid));
  if (filter?.eid != null) params.set("eid", String(filter.eid));
  const q = params.toString();
  return apiFetch<InstanceSummary[]>(`/api/instances${q ? `?${q}` : ""}`);
}

export async function loadAllInstances(): Promise<OkoFormInstance[]> {
  const index = await listInstances();
  const out: OkoFormInstance[] = [];
  for (const s of index) {
    const inst = await loadInstance(s.instanceId);
    if (inst) out.push(inst);
  }
  return out;
}

export async function countInstances(): Promise<number> {
  return (await listInstances()).length;
}

export function exportInstance(instance: OkoFormInstance): void {
  const blob = new Blob([JSON.stringify(instance, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oko_${instance.templateId}_${instance.displayName.replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 60)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importInstanceFile(file: File): Promise<OkoFormInstance> {
  const text = await file.text();
  const data = JSON.parse(text) as OkoFormInstance & { formId?: string };

  if (!data.instanceId) {
    data.instanceId = crypto.randomUUID();
    data.createdAt = data.createdAt ?? new Date().toISOString();
  }
  if (!data.templateId && data.formId) data.templateId = data.formId;
  if (!data.templateTitle) data.templateTitle = data.templateId ?? "Форма";
  if (!data.displayName) {
    data.displayName = defaultDisplayName(
      data.templateId,
      data.templateTitle,
      data.meta
    );
  }

  await saveInstance(data as OkoFormInstance);
  return data as OkoFormInstance;
}

export async function loadKontrAgents(): Promise<KontrAgent[]> {
  if (!useBackend) {
    const res = await fetch("/data/kontr.json");
    const data = await res.json();
    return data.items as KontrAgent[];
  }
  return apiFetch<KontrAgent[]>("/api/kontr?limit=5000");
}

export async function searchKontrAgents(
  query: string,
  orgTypes?: number[],
  limit = 80
): Promise<KontrAgent[]> {
  if (!useBackend) {
    const all = await loadKontrAgents();
    const q = query.trim().toLowerCase();
    const types = orgTypes?.length ? new Set(orgTypes) : null;
    return all
      .filter((a) => {
        if (types && a.orgType != null && !types.has(a.orgType)) {
          const u = a.name.toUpperCase();
          if (u !== "ПРОЧИЕ" && u !== "ФИЗИЧЕСКИЕ ЛИЦА") return false;
        }
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          (a.inn ?? "").includes(q) ||
          (a.kpp ?? "").includes(q) ||
          (a.oldName ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, limit);
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  if (orgTypes?.length) params.set("orgTypes", orgTypes.join(","));
  return apiFetch<KontrAgent[]>(`/api/kontr?${params}`);
}

export async function reimportKontrAgents(): Promise<number> {
  const data = await apiFetch<{ reimported: number }>("/api/kontr/reimport", {
    method: "POST",
  });
  return data.reimported;
}

export async function addKontrAgent(
  agent: Omit<KontrAgent, "id">
): Promise<KontrAgent> {
  if (!useBackend) {
    return { id: Date.now(), ...agent };
  }
  return apiFetch<KontrAgent>("/api/kontr", {
    method: "POST",
    body: JSON.stringify(agent),
  });
}

export async function updateKontrAgent(
  id: number,
  patch: Partial<Omit<KontrAgent, "id">>
): Promise<KontrAgent> {
  if (!useBackend) {
    throw new Error("Обновление контрагентов доступно только в режиме API");
  }
  return apiFetch<KontrAgent>(`/api/kontr/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function renameKontrAgent(
  id: number,
  name: string
): Promise<KontrAgent> {
  if (!useBackend) {
    throw new Error("Переименование доступно только в режиме API");
  }
  return apiFetch<KontrAgent>(`/api/kontr/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function loadRashEntries(
  instanceId: string,
  formId: string
): Promise<FormRashEntry[]> {
  if (!useBackend) {
    const inst = await loadInstance(instanceId);
    return (inst?.rashEntries ?? []).filter((e) => e.formId === formId);
  }
  const data = await apiFetch<{ entries: FormRashEntry[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/rash?formId=${encodeURIComponent(formId)}`
  );
  return data.entries ?? [];
}

export async function saveRashEntries(
  instanceId: string,
  formId: string,
  entries: FormRashEntry[]
): Promise<FormRashEntry[]> {
  if (!useBackend) {
    const inst = await loadInstance(instanceId);
    if (!inst) throw new Error("Not found");
    const other = (inst.rashEntries ?? []).filter((e) => e.formId !== formId);
    const updated: OkoFormInstance = {
      ...inst,
      rashEntries: [...other, ...entries],
      updatedAt: new Date().toISOString(),
    };
    await saveInstance(updated);
    return entries;
  }
  const data = await apiFetch<{ entries: FormRashEntry[] }>(
    `/api/instances/${encodeURIComponent(instanceId)}/rash`,
    {
      method: "PUT",
      body: JSON.stringify({ formId, entries }),
    }
  );
  return data.entries ?? entries;
}
