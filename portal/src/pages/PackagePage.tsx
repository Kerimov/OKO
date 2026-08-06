import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  canMutateData,
  isAuditorReadonly,
  resolveUiPsdRole,
  type PsdRole,
} from "../auth";
import { PackageFormsFillPanel } from "../components/PackageFormsFillPanel";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";
import {
  Button,
  PageHeader,
  StatusBadge,
  StatusBanner,
  TabBar,
} from "../components/ui";
import {
  constructPackages,
  createPeriod,
  createPeriodsBulk,
  createReportPackageAsync,
  closePeriod,
  reopenPeriod,
  distributePackagesToChildren,
  deleteReportPackage,
  deleteReportPackagesBulk,
  fetchPackageWorkspace,
  fetchPackageWorkspaceDetail,
  listOrganizations,
  peekCreatePackageJobId,
  getBackgroundJob,
  saveWorkContext,
  type BackgroundJobStatusDto,
} from "../packagesApi";
import type { CreatePackageResult } from "../types";
import {
  ensureBusinessProcess,
  getBpApprovalBlockers,
  runPackageChecks,
  transitionBusinessProcess,
  type ApprovalBlockers,
  type BpAction,
  type BpStatus,
  type BusinessProcessDto,
  type PackageKind,
} from "../psdApi";
import { isBackendMode } from "../storage";
import {
  packageKindLabel,
  BP_STATUS_LABEL,
  formatDateTimeRu,
  orgOptionLabel,
  bpStatusLabel,
} from "../uiLabels";
import type {
  Organization,
  PackageCompleteness,
  PackageWorkspaceDetail,
  PackageWorkspaceRow,
} from "../types";
import {
  formatPeriod,
  formStatusLabel,
  currentReportingQuarter,
  quarterDateRange,
  quarterPeriodName,
} from "../utils";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";

function ProgressMeter({ percent, label }: { percent: number; label?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className="progress-meter" title={label ?? `${safe}%`}>
      <div className="progress-meter-track">
        <div className="progress-meter-fill" style={{ width: `${safe}%` }} />
      </div>
      <span className="progress-meter-label">{safe}%</span>
    </div>
  );
}

type WorkspaceTab =
  | "period"
  | "period-settings"
  | "overview"
  | "forms"
  | "bp"
  | "open-period"
  | "setup"
  | "fill-forms";
type FormFilter = "all" | "filled" | "draft" | "submitted" | "missing";

type PeriodCampaign = {
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

function campaignKeyOf(r: {
  periodName: string;
  packageKind: string;
}): string {
  return `${r.periodName}||${r.packageKind}`;
}

function quarterYearFromPeriodName(
  periodName: string
): { quarter: number; year: number } | null {
  const m = periodName.trim().match(/^(\d)\s*квартал\s+(\d{4})$/i);
  if (!m) return null;
  const quarter = Number(m[1]);
  const year = Number(m[2]);
  if (!(quarter >= 1 && quarter <= 4) || !(year >= 2000)) return null;
  return { quarter, year };
}

function quarterYearFromCampaign(c: {
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

const BP_ACTIONS: Array<{
  action: BpAction;
  label: string;
  from: BpStatus[];
  roles: PsdRole[];
}> = [
  {
    action: "start",
    label: "Запустить",
    from: ["not_started"],
    roles: ["business_process_manager", "support_specialist"],
  },
  {
    action: "submit_for_approval",
    label: "На согласование",
    from: ["collecting"],
    roles: ["subsidiary_specialist", "support_specialist"],
  },
  {
    action: "curator_approve",
    label: "Согласовать",
    from: ["pending_curator_approval"],
    roles: ["department_curator", "support_specialist"],
  },
  {
    action: "curator_return",
    label: "Вернуть",
    from: ["pending_curator_approval"],
    roles: ["department_curator", "support_specialist"],
  },
  {
    action: "complete",
    label: "Завершить",
    from: ["curator_approved"],
    roles: ["business_process_manager", "support_specialist"],
  },
  {
    action: "reopen",
    label: "Открыть снова",
    from: ["completed"],
    roles: ["business_process_manager", "support_specialist"],
  },
];

function rowKey(r: { zid: number; eid: number }): string {
  return `${r.zid}:${r.eid}`;
}

export function PackagePage() {
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const canMutate = canMutateData();
  const auditorRo = isAuditorReadonly();
  const psdRole = resolveUiPsdRole(auth.user);
  const orgZid = auth.user?.role === "org" ? auth.user.zid ?? null : null;
  const formsLinkLabel = formsListNavLabel(auth);
  const backend = isBackendMode();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<PackageWorkspaceRow[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [zid, setZid] = useState<number | "">("");
  const [eid, setEid] = useState<number | "">("");
  const [detail, setDetail] = useState<PackageWorkspaceDetail | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("period");

  const [listSearch, setListSearch] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set());

  const [formSearch, setFormSearch] = useState("");
  const [formFilter, setFormFilter] = useState<FormFilter>("all");

  const [newPeriodQuarter, setNewPeriodQuarter] = useState(
    () => currentReportingQuarter().quarter
  );
  const [newPeriodYear, setNewPeriodYear] = useState(
    () => currentReportingQuarter().year
  );
  const [newPackageKind, setNewPackageKind] = useState<PackageKind>("OKO");
  const [periodsCreateZid, setPeriodsCreateZid] = useState<number | "">("");
  const [bpBusy, setBpBusy] = useState(false);
  const [packageChecksBusy, setPackageChecksBusy] = useState(false);

  const [selectedCampaignKey, setSelectedCampaignKey] = useState("");
  /** Orgs from directory to attach to the open period. */
  const [addOrgZids, setAddOrgZids] = useState<number[]>([]);
  const [addOrgSearch, setAddOrgSearch] = useState("");
  /** Targets for «Завести формы» dialog (one org or multi-select). */
  const [fillTargets, setFillTargets] = useState<PackageWorkspaceRow[] | null>(
    null
  );
  /** Filters for packages inside a period (right pane). */
  const [filterBp, setFilterBp] = useState("");
  const [filterIncomplete, setFilterIncomplete] = useState(false);
  const [filterBlockers, setFilterBlockers] = useState(false);

  const selectedRow = useMemo(
    () =>
      typeof zid === "number" && typeof eid === "number"
        ? rows.find((r) => r.zid === zid && r.eid === eid) ?? detail?.row ?? null
        : null,
    [rows, zid, eid, detail]
  );

  const completeness: PackageCompleteness | null = detail?.completeness ?? null;
  const bp: BusinessProcessDto | null = (detail?.bp as BusinessProcessDto | null) ?? null;
  const bpBlockers: ApprovalBlockers | null = detail?.blockers ?? null;
  const childOrgCount = detail?.childOrgCount ?? 0;
  const periodClosed = selectedRow?.periodStatus === "closed";

  const childOrgs = useMemo(
    () => (typeof zid === "number" ? orgs.filter((o) => o.parentZid === zid) : []),
    [orgs, zid]
  );

  const periodsCreateOrgs = useMemo(() => {
    if (orgZid != null) return orgs.filter((o) => o.zid === orgZid);
    return orgs;
  }, [orgs, orgZid]);

  /** Periods (campaigns) — top level of the workspace. */
  const allCampaigns = useMemo(() => {
    const map = new Map<string, PeriodCampaign>();
    for (const r of rows) {
      const key = campaignKeyOf(r);
      const prev = map.get(key);
      const closable = r.periodStatus !== "closed" && r.bpStatus === "completed";
      const blockedClose =
        r.periodStatus !== "closed" && r.bpStatus !== "completed";
      if (prev) {
        prev.orgCount += 1;
        if (r.filled === 0) prev.withoutForms += 1;
        if (r.periodStatus === "closed") prev.closedCount += 1;
        else prev.openCount += 1;
        if (closable) prev.closableCount += 1;
        if (blockedClose) prev.blockedCloseCount += 1;
      } else {
        map.set(key, {
          key,
          periodName: r.periodName,
          packageKind: r.packageKind,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          orgCount: 1,
          withoutForms: r.filled === 0 ? 1 : 0,
          openCount: r.periodStatus === "closed" ? 0 : 1,
          closedCount: r.periodStatus === "closed" ? 1 : 0,
          status: r.periodStatus === "closed" ? "closed" : "open",
          closableCount: closable ? 1 : 0,
          blockedCloseCount: blockedClose ? 1 : 0,
        });
      }
    }
    for (const c of map.values()) {
      if (c.openCount > 0 && c.closedCount > 0) c.status = "mixed";
      else if (c.closedCount > 0 && c.openCount === 0) c.status = "closed";
      else c.status = "open";
    }
    const q = listSearch.trim().toLowerCase();
    return [...map.values()]
      .filter((c) => {
        if (filterKind && c.packageKind !== filterKind) return false;
        if (filterPeriod === "open" && c.status === "closed") return false;
        if (filterPeriod === "closed" && c.status !== "closed") return false;
        if (!q) return true;
        return (
          c.periodName.toLowerCase().includes(q) ||
          packageKindLabel(c.packageKind).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const sa = a.periodStart ?? "";
        const sb = b.periodStart ?? "";
        if (sa !== sb) return sb.localeCompare(sa);
        return b.periodName.localeCompare(a.periodName, "ru");
      });
  }, [rows, listSearch, filterKind, filterPeriod]);

  const selectedCampaign = useMemo(
    () => allCampaigns.find((c) => c.key === selectedCampaignKey) ?? null,
    [allCampaigns, selectedCampaignKey]
  );

  const campaignPackages = useMemo(() => {
    if (!selectedCampaign) return [];
    return rows
      .filter((r) => campaignKeyOf(r) === selectedCampaign.key)
      .filter((r) => {
        if (filterBp && r.bpStatus !== filterBp) return false;
        if (filterIncomplete && r.filled >= r.total) return false;
        if (filterBlockers && !r.hasBlockers) return false;
        return true;
      })
      .sort((a, b) =>
        a.organizationName.localeCompare(b.organizationName, "ru")
      );
  }, [
    rows,
    selectedCampaign,
    filterBp,
    filterIncomplete,
    filterBlockers,
  ]);

  const periodLocked = selectedCampaign?.status === "closed";

  /** Organizations from directory that are not yet in this period. */
  const orgsMissingFromCampaign = useMemo(() => {
    if (!selectedCampaign) return [];
    const inPeriod = new Set(
      rows
        .filter((r) => campaignKeyOf(r) === selectedCampaign.key)
        .map((r) => r.zid)
    );
    const source =
      orgZid != null ? orgs.filter((o) => o.zid === orgZid) : orgs;
    const q = addOrgSearch.trim().toLowerCase();
    return source
      .filter((o) => !inPeriod.has(o.zid))
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) ||
          (o.code ?? "").toLowerCase().includes(q) ||
          String(o.zid).includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [selectedCampaign, rows, orgs, orgZid, addOrgSearch]);

  const selectCampaign = useCallback((key: string) => {
    setSelectedCampaignKey(key);
    setZid("");
    setEid("");
    setDetail(null);
    setTab("period");
    setCheckedKeys(new Set());
    setAddOrgZids([]);
    setAddOrgSearch("");
  }, []);

  useEffect(() => {
    if (selectedRow) {
      const key = campaignKeyOf(selectedRow);
      if (key !== selectedCampaignKey) setSelectedCampaignKey(key);
    }
  }, [selectedRow, selectedCampaignKey]);

  useEffect(() => {
    if (selectedCampaignKey) return;
    if (allCampaigns[0]) setSelectedCampaignKey(allCampaigns[0].key);
  }, [allCampaigns, selectedCampaignKey]);

  useEffect(() => {
    if (periodsCreateZid !== "") return;
    if (typeof zid === "number") {
      setPeriodsCreateZid(zid);
      return;
    }
    if (orgZid != null) {
      setPeriodsCreateZid(orgZid);
      return;
    }
    if (periodsCreateOrgs[0]) setPeriodsCreateZid(periodsCreateOrgs[0].zid);
  }, [periodsCreateZid, zid, orgZid, periodsCreateOrgs]);

  const canDeletePackage =
    admin || (orgZid != null && typeof zid === "number" && zid === orgZid);

  const canBulkSelect = !auditorRo;
  const canBulkDelete = canMutate && !auditorRo && (admin || orgZid != null);
  const canBulkStartCollection =
    backend &&
    canMutate &&
    !auditorRo &&
    (psdRole === "business_process_manager" || psdRole === "support_specialist");
  const canBulkRunChecks = backend && canMutate && !auditorRo;

  const syncUrl = useCallback(
    (nextZid: number, nextEid: number) => {
      setSearchParams(
        { zid: String(nextZid), eid: String(nextEid) },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const loadList = useCallback(async () => {
    const [list, orgList] = await Promise.all([
      fetchPackageWorkspace(orgZid ?? undefined),
      listOrganizations(),
    ]);
    setRows(list);
    setOrgs(orgList);
    return list;
  }, [orgZid]);

  const loadDetail = useCallback(
    async (nextZid: number, nextEid: number, kind?: PackageKind) => {
      setDetailLoading(true);
      try {
        const d = await fetchPackageWorkspaceDetail(nextZid, nextEid, kind);
        setDetail(d);
        setRows((prev) =>
          prev.map((r) =>
            r.zid === d.row.zid && r.eid === d.row.eid ? d.row : r
          )
        );
        return d;
      } catch (e) {
        setDetail(null);
        setStatus(e instanceof Error ? e.message : "Не удалось загрузить комплект");
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  const selectPackage = useCallback(
    async (nextZid: number, nextEid: number, kind?: PackageKind) => {
      setZid(nextZid);
      setEid(nextEid);
      syncUrl(nextZid, nextEid);
      await saveWorkContext({ zid: nextZid, eid: nextEid });
      await loadDetail(nextZid, nextEid, kind);
    },
    [loadDetail, syncUrl]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await loadList();
        const paramZid = Number(searchParams.get("zid"));
        const paramEid = Number(searchParams.get("eid"));
        const hasUrlPackage =
          Number.isFinite(paramZid) &&
          paramZid > 0 &&
          Number.isFinite(paramEid) &&
          paramEid > 0;
        const fromUrl = hasUrlPackage
          ? list.find((r) => r.zid === paramZid && r.eid === paramEid)
          : undefined;
        if (fromUrl) {
          setSelectedCampaignKey(campaignKeyOf(fromUrl));
          setZid(fromUrl.zid);
          setEid(fromUrl.eid);
          syncUrl(fromUrl.zid, fromUrl.eid);
          await saveWorkContext({ zid: fromUrl.zid, eid: fromUrl.eid });
          await loadDetail(fromUrl.zid, fromUrl.eid, fromUrl.packageKind);
          setTab("overview");
        } else if (list[0]) {
          // Period-first: open campaign list, do not pin a single org package.
          setSelectedCampaignKey(campaignKeyOf(list[0]));
          setZid("");
          setEid("");
          setDetail(null);
          setTab("period");
        } else {
          setStatus("Комплектов пока нет — создайте организацию и период");
        }
      } catch (e) {
        setStatus(
          e instanceof Error ? e.message : "Не удалось загрузить список комплектов"
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume in-flight create job after reload (same tab session).
  useEffect(() => {
    if (!backend || typeof zid !== "number" || typeof eid !== "number") return;
    const jobId = peekCreatePackageJobId(zid, eid);
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        for (;;) {
          if (cancelled) return;
          const job = await getBackgroundJob(jobId);
          setStatus(
            job.status === "queued" || job.status === "running"
              ? `Создание комплекта… ${job.progress}% — ${job.message || job.status}`
              : job.message || job.status
          );
          if (job.status === "succeeded") {
            const result = job.result as CreatePackageResult | null;
            try {
              sessionStorage.removeItem(`oko.createPackageJob.${zid}.${eid}`);
            } catch {
              /* ignore */
            }
            if (result && typeof result.created === "number") {
              setStatus(
                `Комплект заведён: создано ${result.created}, пропущено ${result.skipped} (всего ${result.total})`
              );
              applyCreateResultLocally(result);
              void refreshAll().catch(() => undefined);
            }
            return;
          }
          if (job.status === "failed") {
            try {
              sessionStorage.removeItem(`oko.createPackageJob.${zid}.${eid}`);
            } catch {
              /* ignore */
            }
            setStatus(job.errorMessage || job.message || "Ошибка создания комплекта");
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : "Ошибка опроса задачи");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally only when package selection settles after first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, zid, eid]);

  const filteredRows = useMemo(() => {
    // Bulk actions operate on packages inside the selected period.
    if (selectedCampaign) return campaignPackages;
    return rows;
  }, [selectedCampaign, campaignPackages, rows]);

  const checkedRows = useMemo(
    () => filteredRows.filter((r) => checkedKeys.has(rowKey(r))),
    [filteredRows, checkedKeys]
  );

  const checkedDeletableRows = useMemo(
    () =>
      checkedRows.filter((r) => {
        if (admin) return true;
        return orgZid != null && r.zid === orgZid;
      }),
    [checkedRows, admin, orgZid]
  );

  const formItems = useMemo(() => {
    const items = completeness?.items ?? [];
    const q = formSearch.trim().toLowerCase();
    return items.filter((i) => {
      if (formFilter === "filled" && !i.filled) return false;
      if (formFilter === "missing" && i.filled) return false;
      if (formFilter === "draft" && !(i.filled && i.status !== "submitted")) return false;
      if (formFilter === "submitted" && i.status !== "submitted") return false;
      if (!q) return true;
      return (
        i.formId.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [completeness, formSearch, formFilter]);

  const bpActions = useMemo(() => {
    if (!bp) return [];
    return BP_ACTIONS.filter(
      (a) => a.from.includes(bp.status) && a.roles.includes(psdRole)
    );
  }, [bp, psdRole]);

  const checkExplanationsLink =
    typeof zid === "number" && typeof eid === "number"
      ? `/check-explanations?zid=${zid}&eid=${eid}&packageKind=${selectedRow?.packageKind ?? "OKO"}`
      : "/check-explanations";

  const primaryCta = useMemo(() => {
    if (!selectedRow || !canMutate || periodClosed) return null;
    if (selectedRow.filled === 0) {
      return { kind: "create" as const, label: "Завести пустые формы" };
    }
    if (bp?.status === "not_started") {
      return { kind: "bp" as const, action: "start" as BpAction, label: "Запустить сбор" };
    }
    if (bp?.status === "collecting" && bpActions.some((a) => a.action === "submit_for_approval")) {
      return {
        kind: "bp" as const,
        action: "submit_for_approval" as BpAction,
        label: "На согласование",
      };
    }
    if (selectedRow.filled < selectedRow.total) {
      return { kind: "create" as const, label: "Дозавести недостающие формы" };
    }
    return { kind: "forms-tab" as const, label: "Открыть список форм" };
  }, [selectedRow, canMutate, periodClosed, bp, bpActions]);

  const refreshAll = async () => {
    try {
      const list = await loadList();
      if (typeof zid === "number" && typeof eid === "number") {
        const hit = list.find((r) => r.zid === zid && r.eid === eid);
        await loadDetail(zid, eid, hit?.packageKind);
      }
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Не удалось обновить список комплектов"
      );
    }
  };

  const handleCreatePeriod = async () => {
    if (!canMutate) return;
    if (
      newPeriodQuarter < 1 ||
      newPeriodQuarter > 4 ||
      !Number.isFinite(newPeriodYear)
    ) {
      setStatus("Укажите квартал и год");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const name = quarterPeriodName(newPeriodQuarter, newPeriodYear);
      const range = quarterDateRange(newPeriodQuarter, newPeriodYear);
      const kind: PackageKind =
        newPackageKind === "BALANCE" ? "BALANCE" : "OKO";

      let created = 0;
      let reused = 0;
      let errors = 0;

      if (admin) {
        const res = await createPeriodsBulk({
          quarter: newPeriodQuarter,
          year: newPeriodYear,
          packageKind: kind,
          name,
          periodStart: range.periodStart,
          periodEnd: range.periodEnd,
          reuseExisting: true,
        });
        created = res.summary.created;
        reused = res.summary.reused;
        errors = res.summary.errors;
        if (created + reused === 0) {
          throw new Error(
            res.rows.find((r) => r.error)?.error ||
              "Не удалось открыть период ни для одной организации"
          );
        }
      } else {
        const targetZid =
          orgZid ??
          (typeof periodsCreateZid === "number"
            ? periodsCreateZid
            : orgs[0]?.zid);
        if (targetZid == null) {
          throw new Error("Не выбрана организация");
        }
        try {
          await createPeriod({
            zid: targetZid,
            name,
            periodStart: range.periodStart,
            periodEnd: range.periodEnd,
            quarter: newPeriodQuarter,
            year: newPeriodYear,
            packageKind: kind,
          });
          created = 1;
        } catch (createErr) {
          const res = await constructPackages({
            mode: "single",
            targets: [{ zid: targetZid }],
            period: {
              quarter: newPeriodQuarter,
              year: newPeriodYear,
              packageKind: kind,
              reuseExisting: true,
            },
            forms: { mode: "all" },
            options: {
              createInstances: false,
              allowCreatePeriod: true,
            },
          });
          const row = res.rows[0];
          if (!row || row.status === "error" || row.eid == null) {
            throw new Error(
              row?.error ||
                (createErr instanceof Error
                  ? createErr.message
                  : "Не удалось создать период")
            );
          }
          if (row.periodCreated) created = 1;
          else reused = 1;
        }
      }

      const qy = currentReportingQuarter();
      setNewPeriodQuarter(qy.quarter);
      setNewPeriodYear(qy.year);
      setNewPackageKind("OKO");
      await loadList();
      const key = `${name}||${kind}`;
      setSelectedCampaignKey(key);
      setTab("period");
      setStatus(
        `Период «${name}» открыт` +
          (admin
            ? `: создано ${created}, уже было ${reused}` +
              (errors ? `, ошибок ${errors}` : "")
            : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания периода");
    } finally {
      setBusy(false);
    }
  };

  const handleClosePeriodFor = async (targetZid: number, targetEid: number) => {
    if (
      !confirm(
        "Закрыть период для этого комплекта? После закрытия формы нельзя будет редактировать."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await closePeriod(targetZid, targetEid);
      setStatus("Период закрыт");
      await refreshAll();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка закрытия периода");
    } finally {
      setBusy(false);
    }
  };

  const handleReopenPeriodFor = async (targetZid: number, targetEid: number) => {
    if (!confirm("Переоткрыть закрытый период?")) return;
    setBusy(true);
    setStatus("");
    try {
      await reopenPeriod(targetZid, targetEid);
      setStatus("Период переоткрыт");
      await refreshAll();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка переоткрытия периода");
    } finally {
      setBusy(false);
    }
  };

  const handleCloseCampaign = async (opts?: { force?: boolean }) => {
    if (!selectedCampaign) return;
    const force = Boolean(opts?.force);
    const targets = rows.filter((r) => {
      if (campaignKeyOf(r) !== selectedCampaign.key) return false;
      if (r.periodStatus === "closed") return false;
      if (force) return true;
      return r.bpStatus === "completed";
    });
    if (!targets.length) {
      setStatus(
        force
          ? "Нет открытых комплектов для закрытия"
          : "Нет комплектов для закрытия: сначала завершите бизнес-процесс или закройте принудительно в настройках периода"
      );
      return;
    }
    const msg = force
      ? `Принудительно закрыть период «${selectedCampaign.periodName}» для ${targets.length} организаций (БП может быть не завершён)? После закрытия формы нельзя будет редактировать.`
      : `Закрыть период «${selectedCampaign.periodName}» для ${targets.length} организаций с завершённым БП? После закрытия формы нельзя будет редактировать.`;
    if (!confirm(msg)) return;
    setBusy(true);
    setStatus("");
    let ok = 0;
    let fail = 0;
    try {
      for (const r of targets) {
        try {
          await closePeriod(r.zid, r.eid, {
            requireAccepted: !force,
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setStatus(
        `Период закрыт: ${ok}` + (fail ? ` · ошибок ${fail}` : "")
      );
      await refreshAll();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка закрытия периода");
    } finally {
      setBusy(false);
    }
  };

  const handleReopenCampaign = async () => {
    if (!selectedCampaign) return;
    const targets = rows.filter(
      (r) =>
        campaignKeyOf(r) === selectedCampaign.key &&
        r.periodStatus === "closed"
    );
    if (!targets.length) {
      setStatus("Нет закрытых комплектов для переоткрытия");
      return;
    }
    if (
      !confirm(
        `Переоткрыть период «${selectedCampaign.periodName}» для ${targets.length} организаций?`
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    let ok = 0;
    let fail = 0;
    try {
      for (const r of targets) {
        try {
          await reopenPeriod(r.zid, r.eid);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setStatus(
        `Период переоткрыт: ${ok}` + (fail ? ` · ошибок ${fail}` : "")
      );
      await refreshAll();
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Ошибка переоткрытия периода"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleBpAction = async (action: BpAction) => {
    if (!bp || !canMutate) return;
    setBpBusy(true);
    setStatus("");
    try {
      const updated = await transitionBusinessProcess(bp.id, action);
      setStatus(`БП: ${BP_STATUS_LABEL[updated.status]}`);
      await refreshAll();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка перехода БП");
    } finally {
      setBpBusy(false);
    }
  };

  const applyCreateResultLocally = (result: CreatePackageResult) => {
    if (typeof zid !== "number" || typeof eid !== "number") return;
    const patchRow = (r: PackageWorkspaceRow): PackageWorkspaceRow => {
      if (r.zid !== zid || r.eid !== eid) return r;
      const total = result.total || r.total;
      const filled = Math.min(total, (r.filled || 0) + result.created);
      const draft = (r.draft || 0) + result.created;
      const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
      return { ...r, filled, total, draft, percent };
    };
    setRows((prev) => prev.map(patchRow));
    setDetail((prev) => {
      if (!prev || prev.row.zid !== zid || prev.row.eid !== eid) return prev;
      const total = result.total || prev.completeness.total;
      const filled = Math.min(total, (prev.completeness.filled || 0) + result.created);
      const draft = (prev.completeness.draft || 0) + result.created;
      return {
        ...prev,
        row: patchRow(prev.row),
        completeness: { ...prev.completeness, filled, total, draft },
      };
    });
    setTab("forms");
  };

  const openFillForms = (targets: PackageWorkspaceRow[]) => {
    if (periodLocked) {
      setStatus("Период закрыт — заведение форм недоступно");
      return;
    }
    const open = targets.filter((r) => r.periodStatus !== "closed");
    if (!open.length) {
      setStatus("Нет открытых комплектов для заведения форм");
      return;
    }
    if (!selectedCampaignKey && open[0]) {
      setSelectedCampaignKey(campaignKeyOf(open[0]));
    }
    setFillTargets(open);
    setTab("fill-forms");
  };

  const handleAddOrgsToPeriod = async () => {
    if (!selectedCampaign || !canMutate) return;
    if (periodLocked) {
      setStatus("Период закрыт — нельзя добавлять организации");
      return;
    }
    if (!addOrgZids.length) {
      setStatus("Выберите организации из справочника");
      return;
    }
    const qy = quarterYearFromCampaign(selectedCampaign);
    if (!qy) {
      setStatus(
        "Не удалось определить квартал и год периода. Откройте период заново."
      );
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      let created = 0;
      let reused = 0;
      let errors = 0;

      if (admin) {
        const res = await createPeriodsBulk({
          zids: addOrgZids,
          quarter: qy.quarter,
          year: qy.year,
          packageKind: selectedCampaign.packageKind,
          name: selectedCampaign.periodName,
          periodStart: selectedCampaign.periodStart ?? undefined,
          periodEnd: selectedCampaign.periodEnd ?? undefined,
          reuseExisting: true,
        });
        created = res.summary.created;
        reused = res.summary.reused;
        errors = res.summary.errors;
        if (created + reused === 0) {
          throw new Error(
            res.rows.find((r) => r.error)?.error ||
              "Не удалось добавить организации в период"
          );
        }
      } else {
        for (const targetZid of addOrgZids) {
          try {
            await createPeriod({
              zid: targetZid,
              name: selectedCampaign.periodName,
              periodStart: selectedCampaign.periodStart ?? undefined,
              periodEnd: selectedCampaign.periodEnd ?? undefined,
              quarter: qy.quarter,
              year: qy.year,
              packageKind: selectedCampaign.packageKind,
            });
            created += 1;
          } catch {
            const res = await constructPackages({
              mode: "single",
              targets: [{ zid: targetZid }],
              period: {
                quarter: qy.quarter,
                year: qy.year,
                packageKind: selectedCampaign.packageKind,
                name: selectedCampaign.periodName,
                reuseExisting: true,
              },
              forms: { mode: "all" },
              options: {
                createInstances: false,
                allowCreatePeriod: true,
              },
            });
            const row = res.rows[0];
            if (!row || row.status === "error" || row.eid == null) {
              errors += 1;
            } else if (row.periodCreated) {
              created += 1;
            } else {
              reused += 1;
            }
          }
        }
        if (created + reused === 0) {
          throw new Error("Не удалось добавить организацию в период");
        }
      }

      setAddOrgZids([]);
      await loadList();
      setStatus(
        `В период добавлено: создано ${created}` +
          (reused ? `, уже было ${reused}` : "") +
          (errors ? `, ошибок ${errors}` : "") +
          ". Далее заведите формы у новых комплектов."
      );
      setTab("period");
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Ошибка добавления организаций"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFillFormsConfirm = async (opts: {
    formsMode: "all" | "selected";
    formIds: string[];
  }) => {
    if (!fillTargets?.length || !selectedCampaign) return;
    setBusy(true);
    setStatus("");
    try {
      // Full set for a single org — keep async job path (progress).
      if (opts.formsMode === "all" && fillTargets.length === 1) {
        const t = fillTargets[0];
        await selectPackage(t.zid, t.eid, t.packageKind);
        const result = await createReportPackageAsync(t.zid, t.eid, {
          onProgress: (job: BackgroundJobStatusDto) => {
            const msg = job.message || job.status;
            setStatus(
              job.status === "queued" || job.status === "running"
                ? `Создание комплекта… ${job.progress}% — ${msg}`
                : msg
            );
          },
        });
        setStatus(
          `Комплект заведён: создано ${result.created}, пропущено ${result.skipped} (всего ${result.total})`
        );
        applyCreateResultLocally(result);
        await refreshAll();
        setFillTargets(null);
        setTab("overview");
        return;
      }

      const res = await constructPackages({
        mode: fillTargets.length > 1 ? "bulk" : "single",
        targets: fillTargets.map((r) => ({ zid: r.zid })),
        period: {
          eid: fillTargets.length === 1 ? fillTargets[0].eid : undefined,
          name: selectedCampaign.periodName,
          periodStart: selectedCampaign.periodStart ?? undefined,
          periodEnd: selectedCampaign.periodEnd ?? undefined,
          packageKind: selectedCampaign.packageKind,
          reuseExisting: true,
        },
        forms: {
          mode: opts.formsMode,
          formIds: opts.formsMode === "selected" ? opts.formIds : undefined,
        },
        options: {
          createInstances: true,
          allowCreatePeriod: false,
          continueOnError: true,
        },
      });
      const ok = res.rows.filter((r) => r.status === "created").length;
      setStatus(
        `Формы заведены: комплектов ${ok}/${res.summary.targets}` +
          (res.summary.formsCreated
            ? ` · форм +${res.summary.formsCreated}`
            : "") +
          (res.summary.errors ? ` · ошибок ${res.summary.errors}` : "")
      );
      await loadList();
      const first = fillTargets[0];
      if (first) {
        await selectPackage(first.zid, first.eid, first.packageKind);
        setTab("overview");
      } else {
        setTab("period");
      }
      setFillTargets(null);
      clearSelection();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка заведения форм");
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePackage = async () => {
    if (typeof zid !== "number" || typeof eid !== "number" || !selectedRow) {
      return;
    }
    openFillForms([selectedRow]);
  };

  const handleDeletePackage = async () => {
    if (typeof zid !== "number" || typeof eid !== "number" || !selectedRow) return;
    const filled = completeness?.filled ?? selectedRow.filled;
    if (
      !confirm(
        `Удалить комплект «${selectedRow.organizationName} — ${selectedRow.periodName}»?\n\n` +
          (filled > 0 ? `Будут удалены все формы (${filled}).\n` : "Форм нет.\n") +
          "Также будут удалены БП, набор форм, проверки, своды, inbox, переносы и прочие связи комплекта.\n" +
          (periodClosed || selectedRow.bpStatus === "completed"
            ? "Комплект закрыт/завершён — удаление всё равно выполнится.\n"
            : "") +
          "Действие необратимо."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await deleteReportPackage(zid, eid);
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        next.delete(rowKey({ zid, eid }));
        return next;
      });
      setDetail(null);
      const list = await loadList();
      const next = list.find((r) => r.zid === zid) ?? list[0];
      if (next) {
        await selectPackage(next.zid, next.eid, next.packageKind);
      } else {
        setZid("");
        setEid("");
        await saveWorkContext({ zid: typeof zid === "number" ? zid : null, eid: null });
      }
      setStatus(`Комплект удалён: форм ${result.deletedInstances}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка удаления комплекта");
    } finally {
      setBusy(false);
    }
  };

  const toggleChecked = (key: string, checked: boolean) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const clearSelection = () => setCheckedKeys(new Set());

  const handleBulkStartCollection = async () => {
    if (!canBulkStartCollection || checkedRows.length === 0) return;
    const targets = checkedRows.filter((r) => {
      if (r.periodStatus === "closed") return false;
      const status = r.bpStatus ?? "not_started";
      return status === "not_started";
    });
    if (!targets.length) {
      setStatus(
        "Нет выбранных комплектов со статусом «Не начат» (закрытые периоды пропускаются)"
      );
      return;
    }
    if (
      !confirm(`Запустить сбор для выбранных комплектов: ${targets.length}?`)
    ) {
      return;
    }
    setBusy(true);
    setBpBusy(true);
    setStatus("");
    let started = 0;
    const errors: string[] = [];
    try {
      for (const r of targets) {
        try {
          const process = await ensureBusinessProcess({
            zid: r.zid,
            eid: r.eid,
            packageKind: r.packageKind,
          });
          if (process.status === "not_started") {
            await transitionBusinessProcess(process.id, "start");
          }
          started += 1;
        } catch (e) {
          errors.push(
            `${r.organizationName}: ${e instanceof Error ? e.message : "ошибка"}`
          );
        }
      }
      await refreshAll();
      setStatus(
        `Сбор запущен: ${started}/${targets.length}` +
          (errors.length
            ? ` · сбои: ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "…" : ""}`
            : "")
      );
    } finally {
      setBpBusy(false);
      setBusy(false);
    }
  };

  const handleBulkChecks = async () => {
    if (!canBulkRunChecks || checkedRows.length === 0) return;
    setBusy(true);
    setPackageChecksBusy(true);
    setStatus("");
    let passedSum = 0;
    let failedSum = 0;
    let okCount = 0;
    const errors: string[] = [];
    try {
      for (const r of checkedRows) {
        try {
          const res = await runPackageChecks({
            zid: r.zid,
            eid: r.eid,
            packageKind: r.packageKind,
          });
          passedSum += res.passed;
          failedSum += res.failed;
          okCount += 1;
        } catch (e) {
          errors.push(
            `${r.organizationName}: ${e instanceof Error ? e.message : "ошибка"}`
          );
        }
      }
      setStatus(
        `Проверки: комплектов ${okCount}/${checkedRows.length}` +
          ` · ок ${passedSum} · ошибок ${failedSum}` +
          (errors.length
            ? ` · сбои: ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "…" : ""}`
            : "")
      );
      if (
        typeof zid === "number" &&
        typeof eid === "number" &&
        checkedRows.some((r) => r.zid === zid && r.eid === eid)
      ) {
        await loadDetail(zid, eid, selectedRow?.packageKind);
      }
    } finally {
      setPackageChecksBusy(false);
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!canBulkDelete || checkedDeletableRows.length === 0) {
      if (checkedRows.length > 0) {
        setStatus("Нет комплектов, доступных для удаления (нет прав на выбранные)");
      }
      return;
    }
    const toDelete = checkedDeletableRows;
    const filledSum = toDelete.reduce((s, r) => s + r.filled, 0);
    const closedOrDone = toDelete.filter(
      (r) => r.periodStatus === "closed" || r.bpStatus === "completed"
    ).length;
    if (
      !confirm(
        `Удалить выбранные комплекты: ${toDelete.length}?\n\n` +
          (filledSum > 0
            ? `Будут удалены формы (всего заведено: ${filledSum}).\n`
            : "") +
          "Также будут удалены БП и все связанные данные каждого комплекта.\n" +
          (closedOrDone > 0
            ? `Среди них закрытых/завершённых: ${closedOrDone} — они тоже будут удалены.\n`
            : "") +
          "Действие необратимо."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await deleteReportPackagesBulk(
        toDelete.map((r) => ({ zid: r.zid, eid: r.eid }))
      );
      const deletedKeys = new Set(
        result.results.filter((r) => r.ok).map((r) => `${r.zid}:${r.eid}`)
      );
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        for (const k of deletedKeys) next.delete(k);
        return next;
      });
      const list = await loadList();
      const currentKey =
        typeof zid === "number" && typeof eid === "number" ? `${zid}:${eid}` : "";
      if (currentKey && deletedKeys.has(currentKey)) {
        setDetail(null);
        const next = list[0];
        if (next) {
          await selectPackage(next.zid, next.eid, next.packageKind);
        } else {
          setZid("");
          setEid("");
          await saveWorkContext({
            zid: orgZid ?? (typeof zid === "number" ? zid : null),
            eid: null,
          });
        }
      } else if (typeof zid === "number" && typeof eid === "number") {
        await loadDetail(zid, eid, selectedRow?.packageKind);
      }
      const failHint =
        result.failed > 0
          ? ` · ошибок ${result.failed}` +
            (result.results
              .filter((r) => !r.ok)
              .slice(0, 3)
              .map((r) => ` (${r.zid}/${r.eid}: ${r.error ?? "—"})`)
              .join("") || "")
          : "";
      setStatus(
        `Удалено комплектов: ${result.deleted} (форм ${result.deletedInstances})${failHint}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка массового удаления");
    } finally {
      setBusy(false);
    }
  };

  const handleDistribute = async () => {
    if (typeof zid !== "number" || typeof eid !== "number") return;
    const hasChildren = childOrgs.length > 0 || childOrgCount > 0;
    const others = orgs.filter((o) => o.zid !== zid).length;
    const useFallback = !hasChildren;
    if (useFallback && others === 0) {
      setStatus("Некому раздавать: создайте дочерние организации");
      return;
    }
    const count = childOrgs.length || childOrgCount;
    const msg = hasChildren
      ? `Создать такие же периоды и пустые комплекты у ${count} дочерних организаций?`
      : `У текущей организации нет дочерних. Раздать всем остальным (${others})?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await distributePackagesToChildren({
        parentZid: zid,
        sourceEid: eid,
        fallbackAllOthers: useFallback,
      });
      setStatus(
        `Раздано: периодов ${res.createdPeriods}, комплектов ${res.createdPackages}` +
          (res.children.length ? ` → ${res.children.map((c) => c.name).join(", ")}` : "")
      );
      await loadList();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка раздачи");
    } finally {
      setBusy(false);
    }
  };

  const handleRunPackageChecks = async () => {
    if (typeof zid !== "number" || typeof eid !== "number") return;
    setPackageChecksBusy(true);
    try {
      const result = await runPackageChecks({
        zid,
        eid,
        packageKind: selectedRow?.packageKind === "BALANCE" ? "BALANCE" : "OKO",
      });
      const failSamples = result.results
        .filter((r) => !r.passed)
        .slice(0, 3)
        .map((r) => r.message)
        .join("; ");
      setStatus(
        `Проверки: успешно ${result.passed}, с ошибками ${result.failed}` +
          (result.failed > 0 && failSamples ? ` · ${failSamples}` : "") +
          (result.results.length === 0 ? " · нет правил" : "")
      );
      if (bp) {
        try {
          const blockers = await getBpApprovalBlockers(bp.id);
          setDetail((prev) => (prev ? { ...prev, blockers } : prev));
        } catch {
          /* ignore */
        }
      }
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось выполнить проверки");
    } finally {
      setPackageChecksBusy(false);
    }
  };

  const runPrimaryCta = async () => {
    if (!primaryCta) return;
    if (primaryCta.kind === "create") await handleCreatePackage();
    else if (primaryCta.kind === "bp") await handleBpAction(primaryCta.action);
    else if (primaryCta.kind === "forms-tab") setTab("forms");
  };

  if (loading) {
    return <div className="loading">Загрузка комплектов…</div>;
  }

  return (
    <div className="page package-workspace">
      <PageHeader
        title="Комплекты отчётности"
        description={
          <>
            Сначала период, внутри — комплекты по организациям.
            {auditorRo ? " Режим аудитора: только чтение." : ""}
          </>
        }
        actions={
          <Button variant="secondary" disabled={busy} onClick={() => void refreshAll()}>
            Обновить
          </Button>
        }
      />

      {status && <StatusBanner tone="info">{status}</StatusBanner>}

      <div className="package-workspace-layout">
        <aside className="tools-section package-workspace-list">
          <h2>Периоды</h2>
          <CollapsibleFilters
            activeCount={countActiveFilters(
              listSearch.trim().length > 0,
              filterKind !== "",
              filterPeriod !== ""
            )}
            bodyClassName="package-workspace-filters"
          >
            <input
              type="search"
              className="search-input"
              placeholder="Поиск периода…"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
            <div className="tools-grid package-workspace-filter-grid">
              <label>
                Тип
                <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
                  <option value="">Все</option>
                  <option value="OKO">ОКО</option>
                  <option value="BALANCE">Баланс</option>
                </select>
              </label>
              <label>
                Статус
                <select
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value)}
                >
                  <option value="">Все</option>
                  <option value="open">Открыт</option>
                  <option value="closed">Закрыт</option>
                </select>
              </label>
            </div>
          </CollapsibleFilters>
          <p className="package-workspace-list-totals table-sub">
            Периодов: {allCampaigns.length}
          </p>

          <div className="package-workspace-list-scroll">
            {allCampaigns.map((c) => {
              const selected = c.key === selectedCampaignKey;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`package-workspace-item${selected ? " is-selected" : ""}`}
                  onClick={() => selectCampaign(c.key)}
                >
                  <div className="package-workspace-item-body">
                    <div className="package-workspace-item-title">
                      {c.periodName}
                    </div>
                    <div className="package-workspace-item-meta">
                      {packageKindLabel(c.packageKind)}
                      {c.periodStart && c.periodEnd
                        ? ` · ${formatPeriod(c.periodStart, c.periodEnd)}`
                        : ""}
                    </div>
                    <div className="package-workspace-item-stats">
                      <StatusBadge
                        tone={
                          c.status === "closed"
                            ? "returned"
                            : c.status === "mixed"
                              ? "draft"
                              : "accepted"
                        }
                        label={
                          c.status === "closed"
                            ? "закрыт"
                            : c.status === "mixed"
                              ? "частично закрыт"
                              : "открыт"
                        }
                      />
                      <span className="table-sub">
                        {c.orgCount} орг.
                        {c.withoutForms ? ` · без форм: ${c.withoutForms}` : ""}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {!allCampaigns.length && (
              <p className="tools-hint">Периодов пока нет</p>
            )}
          </div>

          {canMutate && (
            <Button
              variant="secondary"
              size="sm"
              className="package-workspace-create-btn"
              onClick={() => setTab("open-period")}
            >
              Открыть период…
            </Button>
          )}
          {admin && canMutate && (
            <Button
              variant="secondary"
              size="sm"
              className="package-workspace-create-btn"
              onClick={() => setTab("setup")}
            >
              Настройка
            </Button>
          )}
        </aside>

        <div className="package-workspace-detail">
          {(selectedCampaign ||
            (selectedRow &&
              (tab === "overview" || tab === "forms" || tab === "bp")) ||
            tab === "open-period" ||
            tab === "setup" ||
            tab === "fill-forms" ||
            tab === "period-settings") && (
            <TabBar
              ariaLabel="Разделы"
              value={
                tab === "open-period" ||
                tab === "setup" ||
                tab === "fill-forms" ||
                tab === "period-settings"
                  ? tab
                  : tab === "overview" || tab === "forms" || tab === "bp"
                    ? tab
                    : "period"
              }
              onChange={(id) => {
                const next = id as WorkspaceTab;
                if (next === "period" || next === "period-settings") {
                  setZid("");
                  setEid("");
                  setDetail(null);
                }
                setTab(next);
              }}
              items={
                (
                  [
                    ...(selectedCampaign
                      ? ([
                          [
                            "period",
                            tab === "overview" ||
                            tab === "forms" ||
                            tab === "bp"
                              ? "← К периоду"
                              : "Комплекты периода",
                          ],
                          ["period-settings", "Настройки периода"],
                        ] as Array<[WorkspaceTab, string]>)
                      : []),
                    ...(selectedRow &&
                    (tab === "overview" || tab === "forms" || tab === "bp")
                      ? ([
                          ["overview", "Обзор"],
                          ["forms", "Формы"],
                          ["bp", "Бизнес-процесс"],
                        ] as Array<[WorkspaceTab, string]>)
                      : []),
                    ...(canMutate &&
                    tab !== "overview" &&
                    tab !== "forms" &&
                    tab !== "bp"
                      ? ([["open-period", "Открыть период"]] as Array<
                          [WorkspaceTab, string]
                        >)
                      : []),
                    ...(admin &&
                    canMutate &&
                    tab !== "overview" &&
                    tab !== "forms" &&
                    tab !== "bp"
                      ? ([["setup", "Настройка"]] as Array<
                          [WorkspaceTab, string]
                        >)
                      : []),
                  ] as Array<[WorkspaceTab, string]>
                ).map(([id, label]) => ({ id, label }))
              }
            />
          )}

          {tab === "open-period" && canMutate && (
            <section className="tools-section">
              <h2>
                {admin
                  ? "Открыть период для всех организаций"
                  : "Открыть период"}
              </h2>
              <p className="tools-hint">
                Период — верхний уровень. После открытия внутри периода создаются
                комплекты по организациям.
              </p>
              <div className="tools-grid">
                {!admin ? (
                  <label>
                    Организация
                    <select
                      value={periodsCreateZid}
                      onChange={(e) =>
                        setPeriodsCreateZid(
                          e.target.value === "" ? "" : Number(e.target.value)
                        )
                      }
                    >
                      <option value="">— выберите —</option>
                      {periodsCreateOrgs.map((o) => (
                        <option key={o.zid} value={o.zid}>
                          {orgOptionLabel(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  Квартал
                  <select
                    value={newPeriodQuarter}
                    onChange={(e) => setNewPeriodQuarter(Number(e.target.value))}
                  >
                    <option value={1}>1 квартал</option>
                    <option value={2}>2 квартал</option>
                    <option value={3}>3 квартал</option>
                    <option value={4}>4 квартал</option>
                  </select>
                </label>
                <label>
                  Год
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={newPeriodYear}
                    onChange={(e) => setNewPeriodYear(Number(e.target.value))}
                  />
                </label>
                <label>
                  Тип комплекта
                  <select
                    value={newPackageKind}
                    onChange={(e) =>
                      setNewPackageKind(e.target.value as PackageKind)
                    }
                  >
                    <option value="OKO">ОКО</option>
                    <option value="BALANCE">Баланс</option>
                  </select>
                </label>
              </div>
              <p className="tools-hint">
                Будет открыт{" "}
                <strong>
                  {quarterPeriodName(newPeriodQuarter, newPeriodYear)}
                </strong>
                {" · "}
                {formatPeriod(
                  quarterDateRange(newPeriodQuarter, newPeriodYear).periodStart,
                  quarterDateRange(newPeriodQuarter, newPeriodYear).periodEnd
                )}
                {admin ? ` · для ${orgs.length} организаций` : ""}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                disabled={busy || (!admin && typeof periodsCreateZid !== "number")}
                onClick={() => void handleCreatePeriod()}
              >
                Открыть период
              </button>
            </section>
          )}

          {tab === "fill-forms" && canMutate && fillTargets && fillTargets.length > 0 ? (
            <PackageFormsFillPanel
              targets={fillTargets}
              busy={busy}
              onCancel={() => {
                setFillTargets(null);
                setTab("period");
              }}
              onConfirm={(opts) => void handleFillFormsConfirm(opts)}
            />
          ) : null}

          {tab === "period-settings" && selectedCampaign && (
            <section className="tools-section package-workspace-card">
              <h2>
                Настройки периода · {selectedCampaign.periodName} ·{" "}
                {packageKindLabel(selectedCampaign.packageKind)}
              </h2>
              <p className="tools-hint">
                {selectedCampaign.periodStart && selectedCampaign.periodEnd
                  ? formatPeriod(
                      selectedCampaign.periodStart,
                      selectedCampaign.periodEnd
                    )
                  : ""}
                {" · статус "}
                <strong>
                  {selectedCampaign.status === "closed"
                    ? "закрыт"
                    : selectedCampaign.status === "mixed"
                      ? "частично закрыт"
                      : "открыт"}
                </strong>
              </p>

              <ul className="package-workspace-overview">
                <li>
                  Организаций: <strong>{selectedCampaign.orgCount}</strong>
                </li>
                <li>
                  Открыто: <strong>{selectedCampaign.openCount}</strong>
                  {" · закрыто: "}
                  <strong>{selectedCampaign.closedCount}</strong>
                </li>
                <li>
                  Готовы к закрытию (БП завершён):{" "}
                  <strong>{selectedCampaign.closableCount}</strong>
                </li>
                <li>
                  Ещё нельзя закрыть (БП не завершён):{" "}
                  <strong>{selectedCampaign.blockedCloseCount}</strong>
                </li>
                <li>
                  Без форм: <strong>{selectedCampaign.withoutForms}</strong>
                </li>
              </ul>

              {periodLocked ? (
                <p className="tools-hint" style={{ marginBottom: 16 }}>
                  Период закрыт — нельзя добавлять организации и заводить формы.
                  Можно только переоткрыть период.
                </p>
              ) : null}

              <h3>Добавить организации</h3>
              {periodLocked ? (
                <p className="tools-hint">
                  Справочник недоступен для дополнения: период закрыт.
                </p>
              ) : (
                <>
                  <p className="tools-hint">
                    Организации из справочника, у которых ещё нет комплекта в этом
                    периоде. После добавления заведите формы в списке комплектов.
                  </p>
                  {orgsMissingFromCampaign.length === 0 ? (
                    <p className="tools-hint">
                      {addOrgSearch.trim()
                        ? "По поиску ничего не найдено среди организаций вне периода."
                        : "Все организации справочника уже в периоде."}
                    </p>
                  ) : (
                    <>
                      <label style={{ display: "block", marginBottom: 8 }}>
                        Поиск
                        <input
                          type="search"
                          className="search-input"
                          value={addOrgSearch}
                          onChange={(e) => setAddOrgSearch(e.target.value)}
                          placeholder="Название, код, ZID…"
                          style={{ display: "block", marginTop: 4, minWidth: 240 }}
                        />
                      </label>
                      <div className="toolbar-actions" style={{ marginBottom: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            setAddOrgZids(
                              orgsMissingFromCampaign.map((o) => o.zid)
                            )
                          }
                        >
                          Выбрать все ({orgsMissingFromCampaign.length})
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setAddOrgZids([])}
                        >
                          Снять выбор
                        </button>
                        <span className="tools-hint">
                          Выбрано: {addOrgZids.length}
                        </span>
                      </div>
                      <div className="aggr-list package-constructor-org-list">
                        {orgsMissingFromCampaign.map((o) => (
                          <label
                            key={o.zid}
                            className="package-constructor-check-row"
                          >
                            <input
                              type="checkbox"
                              checked={addOrgZids.includes(o.zid)}
                              onChange={() => {
                                setAddOrgZids((prev) =>
                                  prev.includes(o.zid)
                                    ? prev.filter((z) => z !== o.zid)
                                    : [...prev, o.zid]
                                );
                              }}
                            />
                            <span>{orgOptionLabel(o)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="toolbar-actions" style={{ marginTop: 12 }}>
                        <Button
                          disabled={busy || addOrgZids.length === 0}
                          onClick={() => void handleAddOrgsToPeriod()}
                        >
                          Добавить в период
                          {addOrgZids.length ? ` (${addOrgZids.length})` : ""}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}

              <h3>Закрытие и переоткрытие</h3>
              <p className="tools-hint">
                Обычное закрытие доступно для комплектов с завершённым
                бизнес-процессом. После закрытия формы нельзя редактировать.
              </p>
              <div className="toolbar-actions">
                {canMutate && (
                  <Button
                    disabled={busy || selectedCampaign.closableCount === 0}
                    onClick={() => void handleCloseCampaign()}
                  >
                    Закрыть период
                    {selectedCampaign.closableCount > 0
                      ? ` (${selectedCampaign.closableCount})`
                      : ""}
                  </Button>
                )}
                {canMutate && admin && selectedCampaign.openCount > 0 && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleCloseCampaign({ force: true })}
                  >
                    Закрыть принудительно
                    {selectedCampaign.openCount > 0
                      ? ` (${selectedCampaign.openCount})`
                      : ""}
                  </Button>
                )}
                {canMutate && selectedCampaign.closedCount > 0 && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleReopenCampaign()}
                  >
                    Переоткрыть период
                    {selectedCampaign.closedCount > 0
                      ? ` (${selectedCampaign.closedCount})`
                      : ""}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => setTab("period")}
                >
                  К комплектам периода
                </Button>
              </div>
              {canMutate &&
              selectedCampaign.closableCount === 0 &&
              selectedCampaign.openCount > 0 ? (
                <p className="tools-hint" style={{ marginTop: 12 }}>
                  Сейчас закрыть обычным способом нельзя: ни у одного комплекта
                  БП не в статусе «Завершён».
                  {admin
                    ? " Администратор может закрыть принудительно."
                    : " Завершите бизнес-процесс по организациям или обратитесь к администратору."}
                </p>
              ) : null}
            </section>
          )}

          {(tab === "period" ||
            (!selectedRow &&
              tab !== "open-period" &&
              tab !== "setup" &&
              tab !== "fill-forms" &&
              tab !== "period-settings")) &&
          selectedCampaign ? (
            <section className="tools-section package-workspace-card">
              <div className="package-workspace-card-head">
                <div>
                  <h2>
                    {selectedCampaign.periodName}
                    {" · "}
                    {packageKindLabel(selectedCampaign.packageKind)}
                  </h2>
                  <p className="tools-hint package-workspace-card-meta">
                    {selectedCampaign.periodStart && selectedCampaign.periodEnd
                      ? formatPeriod(
                          selectedCampaign.periodStart,
                          selectedCampaign.periodEnd
                        )
                      : ""}
                    {" · "}
                    <strong>
                      {selectedCampaign.status === "closed"
                        ? "закрыт"
                        : selectedCampaign.status === "mixed"
                          ? "частично закрыт"
                          : "открыт"}
                    </strong>
                    {` · ${selectedCampaign.orgCount} организаций`}
                    {selectedCampaign.withoutForms
                      ? ` · без форм: ${selectedCampaign.withoutForms}`
                      : ""}
                  </p>
                </div>
                <div className="toolbar-actions">
                  {canMutate && (
                    <Button
                      variant="secondary"
                      onClick={() => setTab("period-settings")}
                    >
                      Настройки периода
                    </Button>
                  )}
                </div>
              </div>

              {periodLocked ? (
                <p className="tools-hint" style={{ marginBottom: 12 }}>
                  Период закрыт — заведение форм и добавление организаций
                  недоступны.
                </p>
              ) : null}

              <div className="package-workspace-filters" style={{ marginBottom: 12 }}>
                <div className="tools-grid package-workspace-filter-grid">
                  <label>
                    Статус БП
                    <select
                      value={filterBp}
                      onChange={(e) => setFilterBp(e.target.value)}
                    >
                      <option value="">Все</option>
                      {Object.entries(BP_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="package-workspace-checkboxes">
                  <label>
                    <input
                      type="checkbox"
                      checked={filterIncomplete}
                      onChange={(e) => setFilterIncomplete(e.target.checked)}
                    />{" "}
                    Неполный
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={filterBlockers}
                      onChange={(e) => setFilterBlockers(e.target.checked)}
                    />{" "}
                    Есть блокеры
                  </label>
                </div>
              </div>

              {canBulkSelect && (
                <div className="package-workspace-bulk-bar" style={{ marginBottom: 12 }}>
                  <label className="package-workspace-bulk-select-all">
                    <input
                      type="checkbox"
                      checked={
                        campaignPackages.length > 0 &&
                        campaignPackages.every((r) => checkedKeys.has(rowKey(r)))
                      }
                      disabled={busy || campaignPackages.length === 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCheckedKeys(
                            new Set(campaignPackages.map((r) => rowKey(r)))
                          );
                        } else {
                          clearSelection();
                        }
                      }}
                    />{" "}
                    Выбрать все ({campaignPackages.length})
                  </label>
                  {checkedRows.length > 0 ? (
                    <div className="package-workspace-bulk-actions">
                      {canMutate && !periodLocked && (
                        <Button
                          size="sm"
                          disabled={
                            busy ||
                            !checkedRows.some(
                              (r) =>
                                r.periodStatus !== "closed" &&
                                r.filled < r.total
                            )
                          }
                          onClick={() =>
                            openFillForms(
                              checkedRows.filter(
                                (r) =>
                                  r.periodStatus !== "closed" &&
                                  r.filled < r.total
                              )
                            )
                          }
                        >
                          Завести формы
                          {checkedRows.filter(
                            (r) =>
                              r.periodStatus !== "closed" && r.filled < r.total
                          ).length
                            ? ` (${
                                checkedRows.filter(
                                  (r) =>
                                    r.periodStatus !== "closed" &&
                                    r.filled < r.total
                                ).length
                              })`
                            : ""}
                        </Button>
                      )}
                      {canBulkStartCollection && (
                        <Button
                          size="sm"
                          disabled={busy || bpBusy}
                          onClick={() => void handleBulkStartCollection()}
                        >
                          {bpBusy ? "Запуск…" : "Запустить сбор"}
                        </Button>
                      )}
                      {canBulkRunChecks && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy || packageChecksBusy}
                          onClick={() => void handleBulkChecks()}
                        >
                          {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
                        </Button>
                      )}
                      {canBulkDelete && (
                        <Button
                          variant="danger-outline"
                          size="sm"
                          disabled={busy || checkedDeletableRows.length === 0}
                          onClick={() => void handleBulkDelete()}
                        >
                          Удалить
                          {checkedDeletableRows.length > 0
                            ? ` (${checkedDeletableRows.length})`
                            : ""}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={clearSelection}
                      >
                        Снять выбор
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {canBulkSelect ? <th /> : null}
                      <th>Организация</th>
                      <th>Формы</th>
                      <th>БП</th>
                      <th>Период</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignPackages.map((r) => {
                      const key = rowKey(r);
                      const closed = r.periodStatus === "closed";
                      const canClose = !closed && r.bpStatus === "completed";
                      const canCheck =
                        canBulkSelect && (orgZid == null || r.zid === orgZid);
                      return (
                        <tr key={key}>
                          {canBulkSelect ? (
                            <td>
                              <input
                                type="checkbox"
                                checked={checkedKeys.has(key)}
                                disabled={busy || !canCheck}
                                onChange={(e) =>
                                  toggleChecked(key, e.target.checked)
                                }
                                aria-label={`Выбрать ${r.organizationName}`}
                              />
                            </td>
                          ) : null}
                          <td>
                            {r.organizationName}
                            {r.organizationCode ? (
                              <div className="table-sub">{r.organizationCode}</div>
                            ) : null}
                          </td>
                          <td>
                            {r.filled}/{r.total}
                            <div className="table-sub">сдано {r.submitted}</div>
                          </td>
                          <td>
                            {r.bpStatus
                              ? bpStatusLabel(r.bpStatus)
                              : "—"}
                            {r.hasBlockers ? (
                              <div className="table-sub">блокеры</div>
                            ) : null}
                          </td>
                          <td>{closed ? "закрыт" : "открыт"}</td>
                          <td>
                            <div className="toolbar-actions">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={busy}
                                onClick={() => {
                                  void selectPackage(r.zid, r.eid, r.packageKind);
                                  setTab("overview");
                                }}
                              >
                                Открыть
                              </button>
                              {!periodLocked &&
                                !closed &&
                                r.filled < r.total &&
                                canMutate && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={busy}
                                  onClick={() => openFillForms([r])}
                                >
                                  {r.filled === 0
                                    ? "Завести формы"
                                    : "Дозавести формы"}
                                </button>
                              )}
                              {!periodLocked && canClose && canMutate && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleClosePeriodFor(r.zid, r.eid)
                                  }
                                >
                                  Закрыть
                                </button>
                              )}
                              {closed && canMutate && !periodLocked && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleReopenPeriodFor(r.zid, r.eid)
                                  }
                                >
                                  Переоткрыть
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!campaignPackages.length && (
                      <tr>
                        <td colSpan={canBulkSelect ? 6 : 5}>
                          В периоде нет комплектов по фильтру.
                          {canMutate
                            ? " Создайте комплекты кнопкой выше."
                            : ""}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {!selectedCampaign &&
          !selectedRow &&
          tab !== "open-period" &&
          tab !== "setup" &&
          tab !== "fill-forms" &&
          tab !== "period-settings" ? (
            <section className="tools-section">
              <h2>Период не выбран</h2>
              <p className="tools-hint">
                {allCampaigns.length === 0
                  ? admin
                    ? "Сначала откройте период для организаций, затем создайте комплекты внутри периода."
                    : "Нет доступных периодов. Обратитесь к сопровождению."
                  : "Выберите период в списке слева."}
              </p>
              {canMutate && (
                <Button onClick={() => setTab("open-period")}>
                  Открыть период…
                </Button>
              )}
            </section>
          ) : null}

          {selectedRow &&
          tab !== "open-period" &&
          tab !== "setup" &&
          tab !== "fill-forms" &&
          tab !== "period" &&
          tab !== "period-settings" ? (
            <>
              <section className="tools-section package-workspace-card">
                <div className="package-workspace-card-head">
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginBottom: 8 }}
                      onClick={() => {
                        setZid("");
                        setEid("");
                        setDetail(null);
                        setTab("period");
                      }}
                    >
                      ← К периоду
                    </button>
                    <h2>
                      {selectedRow.organizationName}
                      {" · "}
                      {selectedRow.periodName}
                      {" · "}
                      {packageKindLabel(selectedRow.packageKind)}
                    </h2>
                    <p className="tools-hint package-workspace-card-meta">
                      {formatPeriod(
                        selectedRow.periodStart ?? "",
                        selectedRow.periodEnd ?? ""
                      )}
                      {" · период "}
                      <strong>
                        {selectedRow.periodStatus === "closed" ? "закрыт" : "открыт"}
                      </strong>
                      {selectedRow.curatorName
                        ? ` · куратор: ${selectedRow.curatorName}`
                        : ""}
                      {selectedRow.bpLastChangedAt
                        ? ` · изменён ${formatDateTimeRu(selectedRow.bpLastChangedAt)}`
                        : ""}
                    </p>
                  </div>
                  {selectedRow.bpStatus && (
                    <StatusBadge
                      status={selectedRow.bpStatus}
                      label={bpStatusLabel(selectedRow.bpStatus)}
                    />
                  )}
                </div>

                <div className="package-workspace-card-progress">
                  <ProgressMeter percent={selectedRow.percent} />
                </div>
                <p className="tools-hint">
                  Формы: <strong>{selectedRow.filled}/{selectedRow.total}</strong>
                  {" · черновики "}
                  <strong>{selectedRow.draft}</strong>
                  {" · сдано "}
                  <strong>{selectedRow.submitted}</strong>
                  {detailLoading ? " · обновление…" : ""}
                </p>

                {bpBlockers?.blocked && (
                  <StatusBanner tone="error">
                    Согласование заблокировано — нет объяснений:{" "}
                    {bpBlockers.missingExplanations
                      .map((m) => `#${m.ruleNumber}`)
                      .join(", ")}
                    . <Link to={checkExplanationsLink}>Объяснения проверок</Link>
                  </StatusBanner>
                )}

                <div className="toolbar-actions">
                  {primaryCta && (
                    <Button
                      disabled={
                        busy ||
                        bpBusy ||
                        (primaryCta.kind !== "forms-tab" && !canMutate)
                      }
                      onClick={() => void runPrimaryCta()}
                    >
                      {busy || bpBusy ? "…" : primaryCta.label}
                    </Button>
                  )}
                  <Link to="/my" className="btn btn-secondary">
                    {formsLinkLabel}
                  </Link>
                  {backend && (
                    <Button
                      variant="secondary"
                      disabled={packageChecksBusy || !canMutate}
                      onClick={() => void handleRunPackageChecks()}
                    >
                      {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
                    </Button>
                  )}
                  <Link to="/bp" className="btn btn-secondary">
                    Мониторинг БП
                  </Link>
                </div>
              </section>

              {tab === "overview" && (
                <section className="tools-section">
                  <h2>Обзор</h2>
                  <ul className="package-workspace-overview">
                    <li>
                      Статус БП:{" "}
                      <strong>
                        {selectedRow.bpStatus
                          ? bpStatusLabel(selectedRow.bpStatus)
                          : "ещё не создан"}
                      </strong>
                      {selectedRow.bpIteration != null
                        ? ` · итерация ${selectedRow.bpIteration}`
                        : ""}
                    </li>
                    <li>
                      Прогресс форм: {selectedRow.filled} из {selectedRow.total} (
                      {selectedRow.percent}%)
                    </li>
                    <li>
                      Период:{" "}
                      {selectedRow.periodStatus === "closed" ? "закрыт" : "открыт"}
                    </li>
                    <li>
                      Блокеры согласования:{" "}
                      {bpBlockers?.blocked
                        ? `да (${bpBlockers.missingExplanations.length})`
                        : "нет"}
                    </li>
                  </ul>
                  <div className="toolbar-actions">
                    {selectedRow.filled < selectedRow.total && canMutate && !periodClosed && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => openFillForms([selectedRow])}
                      >
                        {selectedRow.filled === 0
                          ? "Завести формы"
                          : "Дозавести формы"}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setTab("forms")}>
                      Открыть список форм
                    </Button>
                    <Link to={checkExplanationsLink} className="btn btn-secondary">
                      Объяснения проверок
                    </Link>
                  </div>
                </section>
              )}

              {tab === "forms" && (
                <section className="tools-section">
                  <h2>
                    Формы{" "}
                    <span className="cat-count">
                      {completeness ? `${completeness.filled}/${completeness.total}` : "—"}
                    </span>
                  </h2>
                  <CollapsibleFilters
                    activeCount={countActiveFilters(
                      formSearch.trim().length > 0,
                      formFilter !== "all"
                    )}
                    bodyClassName="tools-grid"
                  >
                    <label>
                      Поиск
                      <input
                        type="search"
                        value={formSearch}
                        onChange={(e) => setFormSearch(e.target.value)}
                        placeholder="Код, название, категория…"
                      />
                    </label>
                    <label>
                      Фильтр
                      <select
                        value={formFilter}
                        onChange={(e) => setFormFilter(e.target.value as FormFilter)}
                      >
                        <option value="all">Все</option>
                        <option value="filled">Заведено</option>
                        <option value="draft">Черновики</option>
                        <option value="submitted">Сдано</option>
                        <option value="missing">Не заведено</option>
                      </select>
                    </label>
                  </CollapsibleFilters>
                  {canMutate && !periodClosed && selectedRow && (
                    <div className="toolbar-actions section-actions">
                      <Button
                        variant="secondary"
                        disabled={busy || selectedRow.filled >= selectedRow.total}
                        onClick={() => openFillForms([selectedRow])}
                      >
                        Завести / дозавести
                      </Button>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Форма</th>
                          <th>Категория</th>
                          <th>Статус</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {formItems.map((f) => (
                          <tr key={f.formId}>
                            <td>
                              <div>{f.title}</div>
                              <div className="table-sub">{f.formId}</div>
                            </td>
                            <td>{f.category || "—"}</td>
                            <td>
                              {f.filled ? (
                                <StatusBadge
                                  status={f.status ?? "draft"}
                                  label={formStatusLabel(f.status)}
                                />
                              ) : (
                                <StatusBadge tone="not_started" label="Не заведена" />
                              )}
                            </td>
                            <td>
                              {f.instanceId ? (
                                <Link
                                  to={`/my/${f.instanceId}`}
                                  className="btn btn-secondary btn-sm"
                                >
                                  Открыть
                                </Link>
                              ) : (
                                <Link to="/catalog" className="btn btn-secondary btn-sm">
                                  Каталог
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!formItems.length && (
                          <tr>
                            <td colSpan={4}>Нет форм по фильтру</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === "bp" && (
                <section className="tools-section">
                  <h2>Бизнес-процесс</h2>
                  {!backend && (
                    <p className="tools-hint">БП доступен только в backend-режиме.</p>
                  )}
                  {backend && bp && (
                    <>
                      <p className="tools-hint">
                        <StatusBadge status={bp.status} label={BP_STATUS_LABEL[bp.status]} />
                        {" · итерация "}
                        {bp.iteration}
                        {bp.curatorName ? ` · куратор: ${bp.curatorName}` : ""}
                        {bp.lastChangedAt
                          ? ` · ${formatDateTimeRu(bp.lastChangedAt)}${
                              bp.lastChangedBy ? ` (${bp.lastChangedBy})` : ""
                            }`
                          : ""}
                      </p>
                      {bpBlockers?.blocked && (
                        <p className="error">
                          Блокеры:{" "}
                          {bpBlockers.missingExplanations
                            .map((m) => `#${m.ruleNumber}`)
                            .join(", ")}
                          . <Link to={checkExplanationsLink}>Объяснения</Link>
                        </p>
                      )}
                      <div className="toolbar-actions">
                        {bpActions.map((a) => (
                          <button
                            key={a.action}
                            type="button"
                            className="btn btn-secondary"
                            disabled={bpBusy || !canMutate}
                            onClick={() => void handleBpAction(a.action)}
                          >
                            {a.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={packageChecksBusy || !canMutate}
                          onClick={() => void handleRunPackageChecks()}
                        >
                          {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
                        </button>
                        <Link to="/bp" className="btn btn-secondary">
                          Мониторинг БП
                        </Link>
                      </div>
                    </>
                  )}
                  {backend && !bp && (
                    <p className="tools-hint">БП не загружен для этого комплекта.</p>
                  )}
                </section>
              )}
            </>
          ) : null}

          {tab === "setup" && admin && (
                <section className="tools-section">
                  <h2>Настройка</h2>
                  {selectedRow && (
                  <div className="toolbar-actions" style={{ marginBottom: 16 }}>
                    {canMutate && !periodClosed && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy || typeof zid !== "number" || typeof eid !== "number"}
                        onClick={() => void handleDistribute()}
                      >
                        Раздать дочкам
                        {childOrgs.length || childOrgCount
                          ? ` (${childOrgs.length || childOrgCount})`
                          : ""}
                      </button>
                    )}
                    {canDeletePackage && canMutate && (
                      <button
                        type="button"
                        className="btn btn-danger-outline"
                        disabled={busy}
                        onClick={() => void handleDeletePackage()}
                      >
                        Удалить комплект
                      </button>
                    )}
                  </div>
                  )}

                  {canMutate && (
                    <>
                      <h3>Организации</h3>
                      <p className="tools-hint">
                        Создание и карточки организаций — в справочнике{" "}
                        <Link to="/admin/refs?kind=Организации">
                          Справочники → Организации
                        </Link>
                        .
                      </p>
                      <p className="tools-hint">
                        Период — в списке слева и «Открыть период». Комплекты
                        создаются внутри выбранного периода. Закрытие — на
                        карточке периода.
                      </p>
                    </>
                  )}
                </section>
          )}
        </div>
      </div>
    </div>
  );
}
