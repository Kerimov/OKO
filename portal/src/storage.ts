import type {
  FormMeta,
  FormSchema,
  InstanceSummary,
  OkoFormInstance,
  KontrAgent,
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
  return apiFetch<KontrAgent[]>("/api/kontr");
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
