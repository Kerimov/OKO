import { randomUUID } from "node:crypto";
import type { PeriodLifecycleStatus } from "./periodLifecycle.js";
import type { OkoFormInstance } from "./types.js";

export interface OrganizationDto {
  zid: number;
  name: string;
  code: string | null;
  parentZid: number | null;
  unitKind?: string | null;
  headZid?: number | null;
  branchCode?: string | null;
  unitCode?: string | null;
  compositeCode?: string | null;
  guid?: string | null;
}

export interface PeriodDto {
  eid: number;
  zid: number;
  packageId?: string | null;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  quarter: number | null;
  year: number | null;
  packageStatus?: PackageWorkflowStatus;
  packageComment?: string | null;
  periodStatus?: PeriodLifecycleStatus;
  closedAt?: string | null;
  closedBy?: string | null;
  methodologyReleaseId?: string | null;
  formSetCount?: number;
  packageKind?: "OKO" | "BALANCE";
  collectionUnitZid?: number | null;
}

export interface PackageContext {
  packageId: string;
  zid: number;
  eid: number;
  packageKind: "OKO" | "BALANCE";
  collectionUnitZid: number;
}

export interface WorkContextDto {
  zid: number | null;
  eid: number | null;
}

export type PackageWorkflowStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "corrected"
  | "accepted";

export interface PackageWorkflowDto {
  status: PackageWorkflowStatus;
  comment: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const WORKFLOW_TRANSITIONS: Record<PackageWorkflowStatus, PackageWorkflowStatus[]> = {
  draft: ["submitted"],
  submitted: ["returned", "accepted"],
  returned: ["corrected", "draft"],
  corrected: ["submitted"],
  accepted: ["returned"],
};

const ORG_TRANSITIONS = new Set<string>([
  "draft:submitted",
  "returned:corrected",
  "corrected:submitted",
]);

export function normalizePackageWorkflowStatus(
  raw: string | null | undefined
): PackageWorkflowStatus {
  if (
    raw === "submitted" ||
    raw === "returned" ||
    raw === "corrected" ||
    raw === "accepted"
  ) {
    return raw;
  }
  return "draft";
}

export function canTransitionPackageStatus(
  from: PackageWorkflowStatus,
  to: PackageWorkflowStatus,
  isAdmin: boolean
): boolean {
  if (!WORKFLOW_TRANSITIONS[from]?.includes(to)) return false;
  if (isAdmin) return true;
  return ORG_TRANSITIONS.has(`${from}:${to}`);
}

export interface PackageCompletenessItem {
  formId: string;
  title: string;
  category: string;
  filled: boolean;
  instanceId?: string;
  displayName?: string;
  status?: "draft" | "submitted";
}

export interface PackageCompletenessDto {
  zid: number;
  eid: number;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  items: PackageCompletenessItem[];
  workflow?: PackageWorkflowDto;
}

export interface PackageDashboardRow {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
  packageStatus: PackageWorkflowStatus;
  packageComment: string | null;
}

/** Aggregated package list row for the Package workspace UI. */
export interface PackageWorkspaceRow {
  zid: number;
  eid: number;
  /** Stable package GUID — exchange marks and identity key. */
  packageId: string;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodStatus: PeriodLifecycleStatus;
  packageKind: "OKO" | "BALANCE";
  total: number;
  filled: number;
  draft: number;
  submitted: number;
  percent: number;
  bpId: string | null;
  bpStatus: import("./businessProcessTypes.js").BpStatus | null;
  curatorUserId: number | null;
  curatorName: string | null;
  bpLastChangedAt: string | null;
  bpIteration: number | null;
  hasBlockers: boolean;
  methodologyReleaseId: string | null;
  lastExportedAt: string | null;
  lastImportedAt: string | null;
  importVersion: number;
}

export interface PackageWorkspaceDetail {
  row: PackageWorkspaceRow;
  completeness: PackageCompletenessDto;
  bp: import("./businessProcessTypes.js").BusinessProcessDto | null;
  blockers: {
    blocked: boolean;
    missingExplanations: Array<{
      ruleNumber: number;
      formId: string | null;
      message: string | null;
    }>;
  } | null;
  childOrgCount: number;
}

export interface PackageConstructInput {
  mode: "single" | "bulk";
  targets: Array<{ zid: number }>;
  period: {
    /** Prefer existing period by eid when set (period-first flow). */
    eid?: number;
    name?: string;
    periodStart?: string;
    periodEnd?: string;
    quarter?: number;
    year?: number;
    packageKind?: "OKO" | "BALANCE";
    reuseExisting?: boolean;
    methodologyReleaseId?: string | null;
    collectionUnitZid?: number | null;
  };
  forms: {
    mode: "all" | "selected";
    formIds?: string[];
  };
  options?: {
    createInstances?: boolean;
    continueOnError?: boolean;
    /** When false (default), construct refuses to create a missing period. */
    allowCreatePeriod?: boolean;
  };
}

export interface PackageConstructRowResult {
  zid: number;
  organizationName: string;
  eid?: number;
  periodName: string;
  status: "ready" | "created" | "skipped" | "error";
  periodCreated: boolean;
  formsTotal: number;
  formsCreated: number;
  formsSkipped: number;
  warnings: string[];
  error?: string;
}

export interface PackageConstructResult {
  summary: {
    targets: number;
    periodsCreated: number;
    formsCreated: number;
    skipped: number;
    errors: number;
  };
  rows: PackageConstructRowResult[];
}

export interface CreatePackageResult {
  created: number;
  skipped: number;
  total: number;
  instanceIds: string[];
}

export interface ImportPackageResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ReportPackageInput {
  organization?: string;
  periodStart?: string;
  periodEnd?: string;
  zid?: number | null;
  eid?: number | null;
  packageId?: string | null;
  instances: OkoFormInstance[];
}

export type ListOrganizationsOpts = {
  /** Case-insensitive search on name / code / zid. */
  q?: string;
  /** Max rows (default: all). Cap at 5000. */
  limit?: number;
  offset?: number;
  /** Restrict to a single zid (org-scoped users). */
  zid?: number;
};

/** Lightweight campaign (period × kind) aggregates for the workspace sidebar. */
export interface PackageCampaignSummary {
  key: string;
  periodName: string;
  packageKind: "OKO" | "BALANCE";
  periodStart: string | null;
  periodEnd: string | null;
  orgCount: number;
  withoutForms: number;
  openCount: number;
  closedCount: number;
  status: "open" | "closed" | "mixed";
  closableCount: number;
  blockedCloseCount: number;
}

export type PackageWorkspaceOpts = {
  zid?: number;
  /** Filter to one campaign (period name + kind). */
  periodName?: string;
  packageKind?: "OKO" | "BALANCE";
  periodStart?: string | null;
  periodEnd?: string | null;
  quarter?: number;
  year?: number;
  /** Org name/code search within the result set. */
  q?: string;
  limit?: number;
  offset?: number;
};

export interface DeletePackageResult {
  deletedInstances: number;
  periodRemoved: boolean;
}

export interface BulkDeletePackageItem {
  zid: number;
  eid: number;
}

export interface BulkDeletePackageItemResult {
  zid: number;
  eid: number;
  ok: boolean;
  deletedInstances?: number;
  error?: string;
}

export interface BulkDeletePackageResult {
  deleted: number;
  failed: number;
  deletedInstances: number;
  results: BulkDeletePackageItemResult[];
}

export interface BulkExportPackageItem {
  zid: number;
  eid: number;
}

export interface BulkExportManifestEntry {
  zid: number;
  eid: number;
  organizationName: string;
  organizationCode: string | null;
  periodName: string;
  packageKind: "OKO" | "BALANCE";
  formCount: number;
  filled: number;
  submitted: number;
  filename: string;
  ok: boolean;
  error?: string;
}

export interface BulkExportPackagesResult {
  zip: Uint8Array;
  filename: string;
  exported: number;
  failed: number;
  manifest: {
    exportedAt: string;
    packages: BulkExportManifestEntry[];
  };
}

export function packageIdFor(
  zid: number,
  eid: number,
  packageKind: string | null | undefined
): string {
  return `pkg-${zid}-${eid}-${packageKind === "BALANCE" ? "BALANCE" : "OKO"}`;
}

/** New unique package GUID — never reuse zid/eid so exchange history cannot stick to recreations. */
export function newPackageGuid(): string {
  return randomUUID();
}
