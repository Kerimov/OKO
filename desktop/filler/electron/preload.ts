import { contextBridge, ipcRenderer } from "electron";
import type { OkoFormInstance, InstanceSummary } from "@portal/types";

export interface PackageMeta {
  formatVersion: number;
  zid: number;
  eid: number;
  organization: string;
  periodStart: string;
  periodEnd: string;
  enterpriseCode: string;
  createdAt: string;
}

export interface OpenPackageResult {
  folderPath: string;
  meta: PackageMeta;
  instanceCount: number;
}

export interface SessionInfo {
  folderPath: string;
  meta: PackageMeta;
  instanceCount: number;
}

const api = {
  getUserName: (): Promise<string> => ipcRenderer.invoke("oko:getUserName"),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("oko:pickFolder"),
  pickJsonFile: (): Promise<string | null> => ipcRenderer.invoke("oko:pickJsonFile"),
  openPackage: (folderPath: string): Promise<OpenPackageResult> =>
    ipcRenderer.invoke("oko:openPackage", folderPath),
  createPackage: (payload: {
    folderPath: string;
    zid: number;
    eid: number;
    organization: string;
    periodStart: string;
    periodEnd: string;
    enterpriseCode: string;
  }): Promise<OpenPackageResult> => ipcRenderer.invoke("oko:createPackage", payload),
  seedPackage: (): Promise<{ created: number }> => ipcRenderer.invoke("oko:seedPackage"),
  importJson: (folderPath: string, jsonPath: string): Promise<OpenPackageResult> =>
    ipcRenderer.invoke("oko:importJson", folderPath, jsonPath),
  closePackage: (): Promise<boolean> => ipcRenderer.invoke("oko:closePackage"),
  getSessionInfo: (): Promise<SessionInfo | null> => ipcRenderer.invoke("oko:getSessionInfo"),
  listInstances: (): Promise<InstanceSummary[]> => ipcRenderer.invoke("oko:listInstances"),
  loadInstance: (instanceId: string): Promise<OkoFormInstance> =>
    ipcRenderer.invoke("oko:loadInstance", instanceId),
  loadAllInstances: (): Promise<OkoFormInstance[]> =>
    ipcRenderer.invoke("oko:loadAllInstances"),
  setInstanceStatus: (
    instanceId: string,
    status: "draft" | "submitted"
  ): Promise<OkoFormInstance> =>
    ipcRenderer.invoke("oko:setInstanceStatus", instanceId, status),
  loadSchema: (formId: string) => ipcRenderer.invoke("oko:loadSchema", formId),
  loadCatalog: () => ipcRenderer.invoke("oko:loadCatalog"),
  readPublicJson: (relativePath: string) =>
    ipcRenderer.invoke("oko:readPublicJson", relativePath),
  runFormChecks: (
    formId: string,
    live?: { instanceId: string; rows: import("@portal/types").RowData[] }
  ) => ipcRenderer.invoke("oko:runFormChecks", formId, live),
  runRashChecks: (formId: string, rows: import("@portal/types").RowData[]) =>
    ipcRenderer.invoke("oko:runRashChecks", formId, rows),
  recalcForm: (formId: string, rows: import("@portal/types").RowData[]) =>
    ipcRenderer.invoke("oko:recalcForm", formId, rows),
  getFormRuleCounts: (formId: string) =>
    ipcRenderer.invoke("oko:getFormRuleCounts", formId) as Promise<{
      rashRuleCount: number;
      recalcRuleCount: number;
    }>,
  getKontrAgents: () => ipcRenderer.invoke("oko:getKontrAgents"),
  saveInstance: (inst: OkoFormInstance, userName?: string): Promise<OkoFormInstance> =>
    ipcRenderer.invoke("oko:saveInstance", inst, userName),
  saveInstanceJson: (fileName: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:saveInstanceJson", fileName, content),
  saveExcelFile: (fileName: string, base64: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:saveExcelFile", fileName, base64),
  exportJson: (): Promise<{ filePath: string; fileName: string }> =>
    ipcRenderer.invoke("oko:exportJson"),
  saveExportAs: (): Promise<string | null> => ipcRenderer.invoke("oko:saveExportAs"),
};

contextBridge.exposeInMainWorld("oko", api);

export type OkoDesktopApi = typeof api;
