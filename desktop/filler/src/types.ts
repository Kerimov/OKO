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
  rulesSync?: {
    exportedAt: string | null;
    fromPackage: boolean;
    hasChecks: boolean;
    hasRash?: boolean;
  };
}
