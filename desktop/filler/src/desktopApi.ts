import type { OkoFormInstance, InstanceSummary, FormSchema, FormCatalog } from "@portal/types";
import type { OpenPackageResult, SessionInfo } from "./types";

export interface OkoDesktopApi {
  getUserName: () => Promise<string>;
  pickFolder: () => Promise<string | null>;
  pickJsonFile: () => Promise<string | null>;
  openPackage: (folderPath: string) => Promise<OpenPackageResult>;
  createPackage: (payload: {
    folderPath: string;
    zid: number;
    eid: number;
    organization: string;
    periodStart: string;
    periodEnd: string;
    enterpriseCode: string;
  }) => Promise<OpenPackageResult>;
  seedPackage: () => Promise<{ created: number }>;
  importJson: (folderPath: string, jsonPath: string) => Promise<OpenPackageResult>;
  closePackage: () => Promise<boolean>;
  getSessionInfo: () => Promise<SessionInfo | null>;
  listInstances: () => Promise<InstanceSummary[]>;
  loadInstance: (instanceId: string) => Promise<OkoFormInstance>;
  loadAllInstances: () => Promise<OkoFormInstance[]>;
  setInstanceStatus: (
    instanceId: string,
    status: "draft" | "submitted"
  ) => Promise<OkoFormInstance>;
  loadSchema: (formId: string) => Promise<FormSchema>;
  loadCatalog: () => Promise<FormCatalog>;
  readPublicJson: (relativePath: string) => Promise<unknown>;
  saveInstance: (inst: OkoFormInstance, userName?: string) => Promise<OkoFormInstance>;
  exportJson: () => Promise<{ filePath: string; fileName: string }>;
  saveExportAs: () => Promise<string | null>;
}
