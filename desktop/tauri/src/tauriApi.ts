import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { runFormChecksWithData, type CheckRunResult } from "@oko/engine";
import type { FormSchema, OkoFormInstance, RowData } from "@portal/types";

export interface PackageMeta {
  formatVersion: number;
  zid: number;
  eid: number;
  organization: string;
  periodStart: string;
  periodEnd: string;
  enterpriseCode?: string;
  createdAt?: string;
}

export interface OpenPackageResult {
  folderPath: string;
  meta: PackageMeta;
  dbPath: string;
  instances: number;
}

export interface InstanceSummary {
  instanceId: string;
  templateId: string;
  templateTitle: string;
  displayName: string;
  organization: string;
  periodStart: string;
  periodEnd: string;
  zid?: number | null;
  eid?: number | null;
  status: "draft" | "submitted" | string;
  createdAt: string;
  updatedAt: string;
}

export async function pickPackageFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Выберите папку комплекта ОКО",
  });
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

export async function openPackage(folderPath: string): Promise<OpenPackageResult> {
  return invoke<OpenPackageResult>("open_package", { folderPath });
}

export async function closePackage(): Promise<boolean> {
  return invoke<boolean>("close_package");
}

export async function listSummaries(): Promise<InstanceSummary[]> {
  return invoke<InstanceSummary[]>("list_summaries");
}

export async function loadInstance(instanceId: string): Promise<OkoFormInstance> {
  return invoke<OkoFormInstance>("load_instance", { instanceId });
}

export async function saveInstance(inst: OkoFormInstance): Promise<OkoFormInstance> {
  return invoke<OkoFormInstance>("save_instance", { inst });
}

export async function runtimeInfo(): Promise<{ runtime: string; version: string }> {
  return invoke("runtime_info");
}

export async function loadSchema(formId: string): Promise<FormSchema> {
  const res = await fetch(`/schemas/${formId}.json`);
  if (!res.ok) throw new Error(`Схема ${formId} не найдена`);
  return res.json();
}

export function demoEngineCheck(rows: RowData[], formId: string): CheckRunResult {
  return runFormChecksWithData(
    [
      {
        number: 1,
        expression: `Cell("${formId}","C",1)=Cell("${formId}","C",1)`,
        periodActive: true,
        active: true,
      },
    ],
    formId,
    [
      {
        instanceId: "demo",
        templateId: formId,
        templateTitle: formId,
        displayName: formId,
        rows,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        meta: {
          organization: "demo",
          enterpriseCode: "1@1",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          unit: "тыс.руб.",
        },
        signatures: {},
      },
    ],
    "period"
  );
}
