import type { FormMeta, FormSchema, InstanceSummary, OkoFormInstance } from "./types";
import { buildInitialRows } from "./utils";

const INDEX_KEY = "oko-instances-index";
const INSTANCE_PREFIX = "oko-instance-";
const GLOBAL_META = "oko-global-meta";

export interface GlobalMeta extends FormMeta {}

function readIndex(): InstanceSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function writeIndex(list: InstanceSummary[]): void {
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
    const org = meta.organization.trim().slice(0, 40);
    return `${templateId} — ${org} — ${date}`;
  }
  const shortTitle =
    templateTitle.length > 45 ? templateTitle.slice(0, 45) + "…" : templateTitle;
  return `${templateId} — ${shortTitle} — ${date}`;
}

export function loadGlobalMeta(): GlobalMeta {
  try {
    const raw = localStorage.getItem(GLOBAL_META);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  };
}

export function saveGlobalMeta(meta: GlobalMeta): void {
  localStorage.setItem(GLOBAL_META, JSON.stringify(meta));
}

export function createInstance(schema: FormSchema): OkoFormInstance {
  const global = loadGlobalMeta();
  const now = new Date().toISOString();
  const meta: FormMeta = {
    organization: global.organization,
    enterpriseCode: global.enterpriseCode || schema.meta.enterpriseCode,
    periodStart: global.periodStart,
    periodEnd: global.periodEnd,
    unit: global.unit || schema.meta.unit,
  };
  const signatures: Record<string, string> = {};
  for (const name of schema.signatures) signatures[name] = "";

  const instance: OkoFormInstance = {
    instanceId: crypto.randomUUID(),
    templateId: schema.id,
    templateTitle: schema.title,
    displayName: defaultDisplayName(schema.id, schema.title, meta),
    meta,
    rows: buildInitialRows(schema),
    signatures,
    createdAt: now,
    updatedAt: now,
  };

  saveInstance(instance);
  return instance;
}

export function saveInstance(instance: OkoFormInstance): void {
  instance.updatedAt = new Date().toISOString();
  localStorage.setItem(
    INSTANCE_PREFIX + instance.instanceId,
    JSON.stringify(instance)
  );

  const summary = summaryFromInstance(instance);
  const index = readIndex().filter((s) => s.instanceId !== instance.instanceId);
  index.push(summary);
  index.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  writeIndex(index);
}

export function loadInstance(instanceId: string): OkoFormInstance | null {
  try {
    const raw = localStorage.getItem(INSTANCE_PREFIX + instanceId);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

export function deleteInstance(instanceId: string): void {
  localStorage.removeItem(INSTANCE_PREFIX + instanceId);
  writeIndex(readIndex().filter((s) => s.instanceId !== instanceId));
}

export function listInstances(): InstanceSummary[] {
  return readIndex().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function countInstances(): number {
  return readIndex().length;
}

export function exportInstance(instance: OkoFormInstance): void {
  const blob = new Blob([JSON.stringify(instance, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = instance.displayName.replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 60);
  a.download = `oko_${instance.templateId}_${safeName}.json`;
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
  if (!data.templateId && data.formId) {
    data.templateId = data.formId;
  }
  if (!data.templateTitle) {
    data.templateTitle = data.templateId ?? "Форма";
  }
  if (!data.displayName) {
    data.displayName = defaultDisplayName(
      data.templateId,
      data.templateTitle,
      data.meta
    );
  }

  saveInstance(data as OkoFormInstance);
  return data as OkoFormInstance;
}
