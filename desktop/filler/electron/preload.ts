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
  getClientId: (): Promise<string> => ipcRenderer.invoke("oko:getClientId"),
  authNeedsSetup: (): Promise<boolean> => ipcRenderer.invoke("oko:authNeedsSetup"),
  authGetSession: (): Promise<import("../src/types").AuthUser | null> =>
    ipcRenderer.invoke("oko:authGetSession"),
  authLogin: (login: string, password: string): Promise<import("../src/types").AuthUser> =>
    ipcRenderer.invoke("oko:authLogin", login, password),
  authCreateInitialAdmin: (
    login: string,
    displayName: string,
    password: string
  ): Promise<import("../src/types").AuthUser> =>
    ipcRenderer.invoke("oko:authCreateInitialAdmin", login, displayName, password),
  authLogout: (): Promise<boolean> => ipcRenderer.invoke("oko:authLogout"),
  authListUsers: (): Promise<import("../src/types").PublicUser[]> =>
    ipcRenderer.invoke("oko:authListUsers"),
  authListActiveLogins: (): Promise<string[]> => ipcRenderer.invoke("oko:authListActiveLogins"),
  authCreateUser: (payload: {
    login: string;
    displayName: string;
    password: string;
    role: import("../src/types").UserRole;
  }): Promise<import("../src/types").PublicUser> =>
    ipcRenderer.invoke("oko:authCreateUser", payload),
  authUpdateUser: (payload: {
    id: string;
    displayName?: string;
    role?: import("../src/types").UserRole;
    active?: boolean;
  }): Promise<import("../src/types").PublicUser> =>
    ipcRenderer.invoke("oko:authUpdateUser", payload),
  authResetPassword: (userId: string, password: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:authResetPassword", userId, password),
  authDeleteUser: (userId: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:authDeleteUser", userId),
  getCollaborationSettings: (): Promise<{
    heartbeatIntervalSec: number;
    presenceStaleSec: number;
    syncPollIntervalSec: number;
  }> => ipcRenderer.invoke("oko:getCollaborationSettings"),
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
  runRashChecks: (
    formId: string,
    rows: import("@portal/types").RowData[],
    rashEntries?: import("@portal/types").FormRashEntry[]
  ) => ipcRenderer.invoke("oko:runRashChecks", formId, rows, rashEntries),
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
  exportJson: (opts?: {
    pin?: string;
    actor?: string;
  }): Promise<{ filePath: string; fileName: string; warnings: string[] }> =>
    ipcRenderer.invoke("oko:exportJson", opts),
  saveExportAs: (): Promise<string | null> => ipcRenderer.invoke("oko:saveExportAs"),
  log: (level: string, message: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:log", level, message),
  claimCell: (payload: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
    userName: string;
  }): Promise<{ ok: boolean; occupiedBy?: string }> =>
    ipcRenderer.invoke("oko:claimCell", payload),
  releasePresence: (): Promise<boolean> => ipcRenderer.invoke("oko:releasePresence"),
  heartbeatCell: (payload: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
  }): Promise<boolean> => ipcRenderer.invoke("oko:heartbeatCell", payload),
  listInstancePresence: (instanceId: string): Promise<
    Array<{
      instanceId: string;
      rowNo: number;
      columnKey: string;
      userName: string;
      machineName: string | null;
      clientId: string;
      heartbeatAt: string;
    }>
  > => ipcRenderer.invoke("oko:listInstancePresence", instanceId),
  listPackageEditors: (): Promise<Record<string, string[]>> =>
    ipcRenderer.invoke("oko:listPackageEditors"),
  listCellChanges: (
    instanceId: string,
    sinceIso: string
  ): Promise<
    Array<{
      rowNo: number;
      columnKey: string;
      value: string | number;
      updatedAt: string;
      updatedBy: string | null;
    }>
  > => ipcRenderer.invoke("oko:listCellChanges", instanceId, sinceIso),
  saveCell: (payload: {
    instanceId: string;
    rowNo: number;
    rowName: string | null;
    columnKey: string;
    value: string | number | undefined;
    userName: string;
  }): Promise<{ updatedAt: string }> => ipcRenderer.invoke("oko:saveCell", payload),
  forceUnlock: (payload: {
    instanceId: string;
    rowNo?: number;
    columnKey?: string;
    actor: string;
    pin?: string;
  }): Promise<number> => ipcRenderer.invoke("oko:forceUnlock", payload),
  hasCoordinatorPin: (): Promise<boolean> => ipcRenderer.invoke("oko:hasCoordinatorPin"),
  verifyCoordinatorPin: (pin: string): Promise<boolean> =>
    ipcRenderer.invoke("oko:verifyCoordinatorPin", pin),
  setCoordinatorPin: (payload: { pin: string; oldPin?: string }): Promise<boolean> =>
    ipcRenderer.invoke("oko:setCoordinatorPin", payload),
  getCompleteness: () => ipcRenderer.invoke("oko:getCompleteness"),
  getAssignments: () => ipcRenderer.invoke("oko:getAssignments"),
  saveAssignments: (
    items: Array<{ templateId: string; assignee: string; status: string }>
  ) => ipcRenderer.invoke("oko:saveAssignments", items),
  listKnownAssignees: (): Promise<string[]> => ipcRenderer.invoke("oko:listKnownAssignees"),
  backupDatabase: (payload?: { pin?: string; actor?: string }): Promise<{ filePath: string }> =>
    ipcRenderer.invoke("oko:backupDatabase", payload),
};

contextBridge.exposeInMainWorld("oko", api);

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ""}`;
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function sendLog(level: string, parts: unknown[]) {
  const msg = parts.map(safeStringify).join(" ");
  void ipcRenderer.invoke("oko:log", level, msg);
}

// Capture uncaught errors in renderer and forward to main log file.
window.addEventListener("error", (e) => {
  sendLog("error", [
    "window.error",
    e.message,
    e.filename,
    `:${e.lineno}:${e.colno}`,
    e.error,
  ]);
});

window.addEventListener("unhandledrejection", (e) => {
  sendLog("error", ["unhandledrejection", (e as PromiseRejectionEvent).reason]);
});

const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  sendLog("error", args);
  origError(...args);
};

const origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  sendLog("warn", args);
  origWarn(...args);
};

export type OkoDesktopApi = typeof api;
