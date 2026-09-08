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
  dailyBackupPath?: string | null;
}

export interface SessionInfo {
  folderPath: string;
  meta: PackageMeta;
  instanceCount: number;
  rulesSync?: {
    exportedAt: string | null;
    version?: string | null;
    fromPackage: boolean;
    hasChecks: boolean;
    hasRash?: boolean;
    hasReorgChecks?: boolean;
  };
  hasCoordinatorPin?: boolean;
  restrictExecutorsToAssignments?: boolean;
}

export type UserRole = "admin" | "coordinator" | "executor";

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
}

export interface PublicUser extends AuthUser {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
