import type { OkoFormInstance, InstanceSummary, FormSchema, FormCatalog, RowData, KontrAgent } from "@portal/types";
import type { CheckRunResult } from "@portal/engine/checkRunCore";
import type { RashValidationIssue } from "@portal/engine/rashEngine";
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
  runFormChecks: (
    formId: string,
    live?: { instanceId: string; rows: RowData[] }
  ) => Promise<CheckRunResult>;
  runRashChecks: (formId: string, rows: RowData[]) => Promise<RashValidationIssue[]>;
  recalcForm: (formId: string, rows: RowData[]) => Promise<RowData[]>;
  getFormRuleCounts: (formId: string) => Promise<{ rashRuleCount: number; recalcRuleCount: number }>;
  getKontrAgents: () => Promise<KontrAgent[]>;
  saveInstance: (inst: OkoFormInstance, userName?: string) => Promise<OkoFormInstance>;
  saveInstanceJson: (fileName: string, content: string) => Promise<boolean>;
  saveExcelFile: (fileName: string, base64: string) => Promise<boolean>;
  exportJson: () => Promise<{ filePath: string; fileName: string }>;
  saveExportAs: () => Promise<string | null>;
}
