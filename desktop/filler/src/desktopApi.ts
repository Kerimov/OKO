import type { OkoFormInstance, InstanceSummary, FormSchema, FormCatalog, RowData, KontrAgent, PackageCompleteness } from "@portal/types";
import type { CheckRunResult } from "@oko/engine";
import type { RashValidationIssue } from "@portal/engine/rashEngine";
import type { OpenPackageResult, SessionInfo } from "./types";
import type { AuthUser, PublicUser, UserRole } from "./types";

export interface OkoDesktopApi {
  getUserName: () => Promise<string>;
  getClientId: () => Promise<string>;
  authNeedsSetup: () => Promise<boolean>;
  authGetSession: () => Promise<AuthUser | null>;
  authLogin: (login: string, password: string) => Promise<AuthUser>;
  authCreateInitialAdmin: (
    login: string,
    displayName: string,
    password: string
  ) => Promise<AuthUser>;
  authLogout: () => Promise<boolean>;
  authListUsers: () => Promise<PublicUser[]>;
  authListActiveLogins: () => Promise<string[]>;
  authCreateUser: (payload: {
    login: string;
    displayName: string;
    password: string;
    role: UserRole;
  }) => Promise<PublicUser>;
  authUpdateUser: (payload: {
    id: string;
    displayName?: string;
    role?: UserRole;
    active?: boolean;
  }) => Promise<PublicUser>;
  authResetPassword: (userId: string, password: string) => Promise<boolean>;
  authDeleteUser: (userId: string) => Promise<boolean>;
  getCollaborationSettings: () => Promise<{
    heartbeatIntervalSec: number;
    presenceStaleSec: number;
    syncPollIntervalSec: number;
  }>;
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
  runRashChecks: (
    formId: string,
    rows: RowData[],
    rashEntries?: import("@portal/types").FormRashEntry[]
  ) => Promise<RashValidationIssue[]>;
  recalcForm: (formId: string, rows: RowData[]) => Promise<RowData[]>;
  getFormRuleCounts: (formId: string) => Promise<{ rashRuleCount: number; recalcRuleCount: number }>;
  getKontrAgents: () => Promise<KontrAgent[]>;
  saveInstance: (inst: OkoFormInstance, userName?: string) => Promise<OkoFormInstance>;
  saveInstanceJson: (fileName: string, content: string) => Promise<boolean>;
  saveExcelFile: (fileName: string, base64: string) => Promise<boolean>;
  exportJson: (opts?: {
    pin?: string;
    actor?: string;
  }) => Promise<{ filePath: string; fileName: string; warnings: string[] }>;
  saveExportAs: () => Promise<string | null>;
  log: (level: string, message: string) => Promise<boolean>;
  claimCell: (payload: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
    userName: string;
  }) => Promise<{ ok: boolean; occupiedBy?: string }>;
  releasePresence: () => Promise<boolean>;
  heartbeatCell: (payload: {
    instanceId: string;
    rowNo: number;
    columnKey: string;
  }) => Promise<boolean>;
  listInstancePresence: (instanceId: string) => Promise<
    Array<{
      instanceId: string;
      rowNo: number;
      columnKey: string;
      userName: string;
      machineName: string | null;
      clientId: string;
      heartbeatAt: string;
    }>
  >;
  listPackageEditors: () => Promise<Record<string, string[]>>;
  listCellChanges: (
    instanceId: string,
    sinceIso: string
  ) => Promise<
    Array<{
      rowNo: number;
      columnKey: string;
      value: string | number;
      updatedAt: string;
      updatedBy: string | null;
      updatedClientId: string | null;
    }>
  >;
  saveCell: (payload: {
    instanceId: string;
    rowNo: number;
    rowName: string | null;
    columnKey: string;
    value: string | number | undefined;
    userName: string;
  }) => Promise<{ updatedAt: string }>;
  forceUnlock: (payload: {
    instanceId: string;
    rowNo?: number;
    columnKey?: string;
    actor: string;
    pin?: string;
  }) => Promise<number>;
  hasCoordinatorPin: () => Promise<boolean>;
  verifyCoordinatorPin: (pin: string) => Promise<boolean>;
  setCoordinatorPin: (payload: { pin: string; oldPin?: string }) => Promise<boolean>;
  getCompleteness: () => Promise<PackageCompleteness>;
  getAssignments: () => Promise<{
    updatedAt: string;
    items: Array<{ templateId: string; assignee: string; status: string }>;
  }>;
  saveAssignments: (
    items: Array<{ templateId: string; assignee: string; status: string }>
  ) => Promise<{ updatedAt: string; items: Array<{ templateId: string; assignee: string; status: string }> }>;
  listKnownAssignees: () => Promise<string[]>;
  backupDatabase: (payload?: { pin?: string; actor?: string }) => Promise<{ filePath: string }>;
}
