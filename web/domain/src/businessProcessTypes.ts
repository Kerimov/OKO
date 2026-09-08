/**
 * Business process (collection cycle) state machine for PSD monitoring.
 */

export type BpStatus =
  | "not_started"
  | "collecting"
  | "pending_curator_approval"
  | "curator_approved"
  | "completed";

export type PackageKind = "OKO" | "BALANCE";

export const BP_STATUSES: readonly BpStatus[] = [
  "not_started",
  "collecting",
  "pending_curator_approval",
  "curator_approved",
  "completed",
] as const;

const TRANSITIONS: Record<BpStatus, readonly BpStatus[]> = {
  not_started: ["collecting"],
  collecting: ["pending_curator_approval", "not_started"],
  pending_curator_approval: ["curator_approved", "collecting"],
  curator_approved: ["completed", "collecting"],
  completed: ["collecting"], // reopen only with bp.reopen
};

export function normalizeBpStatus(raw: string | null | undefined): BpStatus {
  if (raw && (BP_STATUSES as readonly string[]).includes(raw)) {
    return raw as BpStatus;
  }
  return "not_started";
}

export function normalizePackageKind(raw: string | null | undefined): PackageKind {
  return raw === "BALANCE" ? "BALANCE" : "OKO";
}

export function canTransitionBp(from: BpStatus, to: BpStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isBpLocked(status: BpStatus): boolean {
  return status === "completed";
}

export function bpIdFor(zid: number, eid: number, kind: PackageKind): string {
  return `bp-${zid}-${eid}-${kind}`;
}

export interface BusinessProcessDto {
  id: string;
  eid: number;
  zid: number;
  packageKind: PackageKind;
  status: BpStatus;
  curatorUserId: number | null;
  deadlineAt: string | null;
  iteration: number;
  note: string | null;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  createdAt: string;
  organizationName?: string | null;
  periodName?: string | null;
  curatorName?: string | null;
}

export interface BpEventDto {
  id: number;
  bpId: string;
  fromStatus: string | null;
  toStatus: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export const BP_STATUS_LABELS_RU: Record<BpStatus, string> = {
  not_started: "Не начат",
  collecting: "Сбор",
  pending_curator_approval: "На согласовании",
  curator_approved: "Согласован",
  completed: "Завершён",
};
