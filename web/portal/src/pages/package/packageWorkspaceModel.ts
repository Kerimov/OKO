import type { PortalPsdPermission } from "../../auth";
import type { BpAction, BpStatus, PackageKind } from "../../psdApi";

export type WorkspaceTab =
  | "period"
  | "period-settings"
  | "overview"
  | "forms"
  | "bp"
  | "open-period"
  | "setup"
  | "fill-forms";

export type FormFilter = "all" | "filled" | "draft" | "submitted" | "missing";

export type PeriodCampaign = {
  key: string;
  periodName: string;
  packageKind: PackageKind;
  periodStart: string | null;
  periodEnd: string | null;
  orgCount: number;
  withoutForms: number;
  openCount: number;
  closedCount: number;
  /** closed = all closed; open = none closed; mixed = both */
  status: "open" | "closed" | "mixed";
  /** Open packages with BP completed — can close without force. */
  closableCount: number;
  /** Open packages still waiting on BP. */
  blockedCloseCount: number;
};

export function campaignKeyOf(r: { periodName: string; packageKind: string }): string {
  return `${r.periodName}||${r.packageKind}`;
}

export function quarterYearFromPeriodName(
  periodName: string
): { quarter: number; year: number } | null {
  const m = periodName.trim().match(/^(\d)\s*квартал\s+(\d{4})$/i);
  if (!m) return null;
  const quarter = Number(m[1]);
  const year = Number(m[2]);
  if (!(quarter >= 1 && quarter <= 4) || !(year >= 2000)) return null;
  return { quarter, year };
}

export function quarterYearFromCampaign(c: {
  periodName: string;
  periodStart: string | null;
}): { quarter: number; year: number } | null {
  const fromName = quarterYearFromPeriodName(c.periodName);
  if (fromName) return fromName;
  if (c.periodStart) {
    const d = new Date(c.periodStart);
    if (!Number.isNaN(d.getTime())) {
      return {
        quarter: Math.floor(d.getMonth() / 3) + 1,
        year: d.getFullYear(),
      };
    }
  }
  return null;
}

export const BP_ACTIONS: Array<{
  action: BpAction;
  label: string;
  from: BpStatus[];
  permission: PortalPsdPermission;
}> = [
  {
    action: "start",
    label: "Запустить",
    from: ["not_started"],
    permission: "bp.start",
  },
  {
    action: "submit_for_approval",
    label: "На согласование",
    from: ["collecting"],
    permission: "bp.submit_for_approval",
  },
  {
    action: "curator_approve",
    label: "Согласовать",
    from: ["pending_curator_approval"],
    permission: "bp.curator_approve",
  },
  {
    action: "curator_return",
    label: "Вернуть",
    from: ["pending_curator_approval"],
    permission: "bp.curator_return",
  },
  {
    action: "complete",
    label: "Завершить",
    from: ["curator_approved"],
    permission: "bp.complete",
  },
  {
    action: "reopen",
    label: "Открыть снова",
    from: ["completed"],
    permission: "bp.reopen",
  },
];

export function rowKey(r: { zid: number; eid: number }): string {
  return `${r.zid}:${r.eid}`;
}
