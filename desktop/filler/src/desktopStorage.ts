/**
 * Адаптер portal/storage.ts для десктопа — движки проверок и расшифровок.
 */
import type { FormMeta, InstanceSummary, OkoFormInstance, KontrAgent } from "@portal/types";

let desktopActor: string | undefined;

export function setDesktopActor(name: string): void {
  desktopActor = name;
}

export function isBackendMode(): boolean {
  return false;
}

export async function loadInstance(instanceId: string): Promise<OkoFormInstance | null> {
  try {
    return await window.oko.loadInstance(instanceId);
  } catch {
    return null;
  }
}

export async function saveInstance(instance: OkoFormInstance): Promise<OkoFormInstance> {
  return window.oko.saveInstance(instance, desktopActor);
}

export async function listInstances(): Promise<InstanceSummary[]> {
  return window.oko.listInstances();
}

export async function loadAllInstances(): Promise<OkoFormInstance[]> {
  return window.oko.loadAllInstances();
}

export async function setInstanceStatus(
  instanceId: string,
  status: "draft" | "submitted"
): Promise<OkoFormInstance> {
  return window.oko.setInstanceStatus(instanceId, status);
}

export async function saveGlobalMeta(_meta: FormMeta): Promise<void> {
  /* мета комплекта задаётся при создании/импорте */
}

export async function loadKontrAgents(): Promise<KontrAgent[]> {
  const data = (await window.oko.readPublicJson("data/kontr.json")) as {
    items?: KontrAgent[];
  };
  return data.items ?? [];
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
