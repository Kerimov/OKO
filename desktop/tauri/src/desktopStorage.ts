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
  return (await window.oko.getKontrAgents()) as KontrAgent[];
}

export async function searchKontrAgents(
  q: string,
  orgTypes?: number[] | null,
  limit = 80
): Promise<KontrAgent[]> {
  const all = await loadKontrAgents();
  const needle = q.trim().toLowerCase();
  const types = orgTypes?.length ? new Set(orgTypes) : null;
  const isSpecial = (name: string) => {
    const u = name.toUpperCase();
    return u === "ПРОЧИЕ" || u === "ФИЗИЧЕСКИЕ ЛИЦА";
  };
  return all
    .filter((a) => {
      if (types && a.orgType != null && !types.has(a.orgType) && !isSpecial(a.name)) {
        return false;
      }
      if (!needle) return true;
      return (
        a.name.toLowerCase().includes(needle) ||
        (a.inn ?? "").includes(needle) ||
        (a.kpp ?? "").includes(needle) ||
        (a.oldName ?? "").toLowerCase().includes(needle)
      );
    })
    .slice(0, limit);
}

export function exportInstance(instance: OkoFormInstance): void {
  const label = (instance.displayName ?? instance.templateId ?? "form")
    .replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_")
    .slice(0, 60);
  const fileName = `oko_${instance.templateId}_${label}.json`;
  void window.oko.saveInstanceJson(fileName, JSON.stringify(instance, null, 2));
}
