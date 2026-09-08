import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  canMutateData,
  hasPsdPermission,
  isAuditorReadonly,
} from "../auth";
import { PackageFormsFillPanel } from "../components/PackageFormsFillPanel";
import {
  Button,
  PageHeader,
  StatusBanner,
  TabBar,
} from "../components/ui";
import { useVirtualRows } from "../hooks/useVirtualRows";
import {
  constructPackages,
  constructPackagesAsync,
  createPeriod,
  createPeriodsBulk,
  createReportPackageAsync,
  closePeriod,
  reopenPeriod,
  distributePackagesToChildren,
  deleteReportPackage,
  deleteReportPackagesBulkAsync,
  fetchPackageCampaigns,
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
  type BusinessProcessDto,
  type PackageKind,
} from "../psdApi";
import { isBackendMode } from "../storage";
import {
  packageKindLabel,
  BP_STATUS_LABEL,
} from "../uiLabels";
import type {
  Organization,
  PackageCompleteness,
  PackageWorkspaceDetail,
  PackageWorkspaceRow,
} from "../types";
import {
  currentReportingQuarter,
  quarterDateRange,
  quarterPeriodName,
} from "../utils";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";
import { PackageSelectedPackageCard } from "./package/PackageSelectedPackageCard";
import { PackagePeriodsSidebar } from "./package/PackagePeriodsSidebar";
import {
  PACKAGE_ROW_HEIGHT,
  PackageCampaignPackagesPanel,
} from "./package/PackageCampaignPackagesPanel";
import { PackageOpenPeriodPanel } from "./package/PackageOpenPeriodPanel";
import { PackagePeriodSettingsPanel } from "./package/PackagePeriodSettingsPanel";
import { PackageOverviewPanel } from "./package/PackageOverviewPanel";
import { PackageFormsTabPanel } from "./package/PackageFormsTabPanel";
import { PackageBpPanel } from "./package/PackageBpPanel";
import { PackageSetupPanel } from "./package/PackageSetupPanel";
import {
  BP_ACTIONS,
  campaignKeyOf,
  quarterYearFromCampaign,
  rowKey,
  type FormFilter,
  type PeriodCampaign,
  type WorkspaceTab,
} from "./package/packageWorkspaceModel";

export function PackagePage() {
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const canMutate = canMutateData();
  const auditorRo = isAuditorReadonly();
  const orgZid = auth.user?.role === "org" ? auth.user.zid ?? null : null;
  const formsLinkLabel = formsListNavLabel(auth);
  const backend = isBackendMode();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<PackageWorkspaceRow[]>([]);
  const [campaigns, setCampaigns] = useState<PeriodCampaign[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [zid, setZid] = useState<number | "">("");
  const [eid, setEid] = useState<number | "">("");
  const [detail, setDetail] = useState<PackageWorkspaceDetail | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("period");
  const packageTableScrollRef = useRef<HTMLDivElement | null>(null);

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

  /** Periods (campaigns) — from server aggregates (not derived from all package rows). */
  const allCampaigns = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return campaigns
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
  }, [campaigns, listSearch, filterKind, filterPeriod]);

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

  /** Directory search for orgs not yet in this period (server-side q/limit). */
  const [orgsMissingFromCampaign, setOrgsMissingFromCampaign] = useState<
    Organization[]
  >([]);

  useEffect(() => {
    if (!selectedCampaign || periodLocked) {
      setOrgsMissingFromCampaign([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listOrganizations({
        q: addOrgSearch.trim() || undefined,
        limit: 150,
      })
        .then((list) => {
          if (cancelled) return;
          const inPeriod = new Set(rows.map((r) => r.zid));
          setOrgsMissingFromCampaign(
            list
              .filter((o) => !inPeriod.has(o.zid))
              .filter((o) => (orgZid == null ? true : o.zid === orgZid))
              .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          );
        })
        .catch(() => {
          if (!cancelled) setOrgsMissingFromCampaign([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedCampaign,
    periodLocked,
    addOrgSearch,
    rows,
    orgZid,
  ]);

  const packageVirt = useVirtualRows(
    packageTableScrollRef,
    campaignPackages.length,
    PACKAGE_ROW_HEIGHT,
    { threshold: 40 }
  );
  const visibleCampaignPackages = useMemo(
    () =>
      packageVirt.enabled
        ? campaignPackages.slice(packageVirt.startIndex, packageVirt.endIndex)
        : campaignPackages,
    [campaignPackages, packageVirt.enabled, packageVirt.startIndex, packageVirt.endIndex]
  );

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
    backend && canMutate && !auditorRo && hasPsdPermission("bp.start");
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

  const loadCampaigns = useCallback(async () => {
    const list = await fetchPackageCampaigns({
      zid: orgZid ?? undefined,
    });
    setCampaigns(list);
    return list;
  }, [orgZid]);

  const loadCampaignPackages = useCallback(
    async (campaign: PeriodCampaign | null) => {
      if (!campaign) {
        setRows([]);
        return [] as PackageWorkspaceRow[];
      }
      const list = await fetchPackageWorkspace({
        zid: orgZid ?? undefined,
        periodName: campaign.periodName,
        packageKind: campaign.packageKind,
      });
      setRows(list);
      return list;
    },
    [orgZid]
  );

  const loadList = useCallback(async () => {
    const [campList, orgList] = await Promise.all([
      loadCampaigns(),
      // Cap directory load — pickers use search; avoid pulling the full tree.
      listOrganizations({ limit: orgZid != null ? 50 : 500 }),
    ]);
    setOrgs(orgList);
    return campList;
  }, [loadCampaigns, orgZid]);

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
        const campList = await loadList();
        const paramZid = Number(searchParams.get("zid"));
        const paramEid = Number(searchParams.get("eid"));
        const hasUrlPackage =
          Number.isFinite(paramZid) &&
          paramZid > 0 &&
          Number.isFinite(paramEid) &&
          paramEid > 0;

        if (hasUrlPackage) {
          const detailRow = await fetchPackageWorkspaceDetail(
            paramZid,
            paramEid
          ).catch(() => null);
          if (detailRow?.row) {
            const key = campaignKeyOf(detailRow.row);
            setSelectedCampaignKey(key);
            setZid(detailRow.row.zid);
            setEid(detailRow.row.eid);
            syncUrl(detailRow.row.zid, detailRow.row.eid);
            await saveWorkContext({
              zid: detailRow.row.zid,
              eid: detailRow.row.eid,
            });
            setDetail(detailRow);
            const camp =
              campList.find((c) => c.key === key) ??
              ({
                key,
                periodName: detailRow.row.periodName,
                packageKind: detailRow.row.packageKind,
                periodStart: detailRow.row.periodStart,
                periodEnd: detailRow.row.periodEnd,
                orgCount: 1,
                withoutForms: 0,
                openCount: 1,
                closedCount: 0,
                status: "open" as const,
                closableCount: 0,
                blockedCloseCount: 0,
              } satisfies PeriodCampaign);
            await loadCampaignPackages(camp);
            setTab("overview");
            return;
          }
        }

        if (campList[0]) {
          setSelectedCampaignKey(campList[0].key);
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

  // Load packages only for the selected campaign (not all 1000 orgs at once).
  useEffect(() => {
    if (!selectedCampaignKey || loading) return;
    const camp =
      campaigns.find((c) => c.key === selectedCampaignKey) ??
      allCampaigns.find((c) => c.key === selectedCampaignKey) ??
      null;
    if (!camp) return;
    void loadCampaignPackages(camp).catch((e) => {
      setStatus(
        e instanceof Error ? e.message : "Не удалось загрузить комплекты периода"
      );
    });
  }, [selectedCampaignKey, campaigns, loading, loadCampaignPackages, allCampaigns]);

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
      (a) => a.from.includes(bp.status) && hasPsdPermission(a.permission)
    );
  }, [bp, auth.user?.permissions, auth.role]);

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
      await loadCampaigns();
      const camp =
        campaigns.find((c) => c.key === selectedCampaignKey) ??
        allCampaigns.find((c) => c.key === selectedCampaignKey) ??
        null;
      const list = await loadCampaignPackages(camp);
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

      const res = await constructPackagesAsync(
        {
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
        },
        {
          onProgress: (job: BackgroundJobStatusDto) => {
            const msg = job.message || job.status;
            setStatus(
              job.status === "queued" || job.status === "running"
                ? `Заведение форм… ${job.progress}% — ${msg}`
                : msg
            );
          },
        }
      );
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

  const handleDeletePackage = async (target?: PackageWorkspaceRow) => {
    const row = target ?? selectedRow;
    if (!row) return;
    const targetZid = row.zid;
    const targetEid = row.eid;
    const filled =
      target && target !== selectedRow
        ? row.filled
        : (completeness?.filled ?? row.filled);
    if (
      !confirm(
        `Удалить комплект «${row.organizationName} — ${row.periodName}»?\n\n` +
          (filled > 0 ? `Будут удалены все формы (${filled}).\n` : "Форм нет.\n") +
          "Комплект исчезнет из списка периода (не останется пустой строки).\n" +
          "БП, проверки, своды и обмен будут сняты.\n" +
          "Действие необратимо."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await deleteReportPackage(targetZid, targetEid);
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        next.delete(rowKey({ zid: targetZid, eid: targetEid }));
        return next;
      });
      if (zid === targetZid && eid === targetEid) {
        setZid("");
        setEid("");
        setDetail(null);
        setTab("period");
      }
      await loadList();
      setStatus(
        `Комплект удалён` +
          (result.deletedInstances
            ? ` (форм: ${result.deletedInstances})`
            : "") +
          "."
      );
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
          "Комплекты исчезнут из списка периода (пустых строк не останется).\n" +
          (closedOrDone > 0
            ? `Среди них закрытых/завершённых: ${closedOrDone}.\n`
            : "") +
          (toDelete.length > 200
            ? `Большая выборка — удаление пойдёт пакетами (~${Math.ceil(toDelete.length / 100)} запросов).\n`
            : "") +
          "Действие необратимо."
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus(
      toDelete.length > 20
        ? `Удаление комплектов: 0/${toDelete.length}…`
        : ""
    );
    try {
      const result = await deleteReportPackagesBulkAsync(
        toDelete.map((r) => ({ zid: r.zid, eid: r.eid })),
        {
          onProgress: (job) => {
            const msg = job.message || job.status;
            if (job.status === "queued" || job.status === "running") {
              setStatus(`Удаление… ${job.progress}% — ${msg}`);
            }
          },
        }
      );
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        for (const r of result.results.filter((x) => x.ok)) {
          next.delete(`${r.zid}:${r.eid}`);
        }
        return next;
      });
      await loadCampaigns();
      const camp =
        campaigns.find((c) => c.key === selectedCampaignKey) ??
        allCampaigns.find((c) => c.key === selectedCampaignKey) ??
        null;
      const list = await loadCampaignPackages(camp);
      const stillHere =
        typeof zid === "number" &&
        typeof eid === "number" &&
        list.some((r) => r.zid === zid && r.eid === eid);
      if (!stillHere) {
        setZid("");
        setEid("");
        setDetail(null);
        setTab("period");
      } else if (typeof zid === "number" && typeof eid === "number") {
        const hit = list.find((r) => r.zid === zid && r.eid === eid);
        if (hit) await loadDetail(zid, eid, hit.packageKind);
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
        `Удалено комплектов: ${result.deleted}` +
          (result.deletedInstances ? ` (форм ${result.deletedInstances})` : "") +
          failHint
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
        <PackagePeriodsSidebar
          campaigns={allCampaigns}
          selectedCampaignKey={selectedCampaignKey}
          listSearch={listSearch}
          filterKind={filterKind}
          filterPeriod={filterPeriod}
          canMutate={canMutate}
          admin={admin}
          onListSearchChange={setListSearch}
          onFilterKindChange={setFilterKind}
          onFilterPeriodChange={setFilterPeriod}
          onSelectCampaign={selectCampaign}
          onOpenPeriod={() => setTab("open-period")}
          onOpenSetup={() => setTab("setup")}
        />

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
            <PackageOpenPeriodPanel
              admin={admin}
              busy={busy}
              orgsCount={orgs.length}
              periodsCreateOrgs={periodsCreateOrgs}
              periodsCreateZid={periodsCreateZid}
              newPeriodQuarter={newPeriodQuarter}
              newPeriodYear={newPeriodYear}
              newPackageKind={newPackageKind}
              onPeriodsCreateZidChange={setPeriodsCreateZid}
              onQuarterChange={setNewPeriodQuarter}
              onYearChange={setNewPeriodYear}
              onPackageKindChange={setNewPackageKind}
              onCreatePeriod={() => void handleCreatePeriod()}
            />
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
            <PackagePeriodSettingsPanel
              campaign={selectedCampaign}
              periodLocked={periodLocked}
              admin={admin}
              canMutate={canMutate}
              busy={busy}
              orgsMissingFromCampaign={orgsMissingFromCampaign}
              addOrgSearch={addOrgSearch}
              addOrgZids={addOrgZids}
              onAddOrgSearchChange={setAddOrgSearch}
              onAddOrgZidsChange={setAddOrgZids}
              onAddOrgsToPeriod={() => void handleAddOrgsToPeriod()}
              onCloseCampaign={(opts) => void handleCloseCampaign(opts)}
              onReopenCampaign={() => void handleReopenCampaign()}
              onBackToPackages={() => setTab("period")}
            />
          )}

          {(tab === "period" ||
            (!selectedRow &&
              tab !== "open-period" &&
              tab !== "setup" &&
              tab !== "fill-forms" &&
              tab !== "period-settings")) &&
          selectedCampaign ? (
            <PackageCampaignPackagesPanel
              campaign={selectedCampaign}
              campaignPackages={campaignPackages}
              visiblePackages={visibleCampaignPackages}
              periodLocked={periodLocked}
              canMutate={canMutate}
              admin={admin}
              orgZid={orgZid}
              busy={busy}
              bpBusy={bpBusy}
              packageChecksBusy={packageChecksBusy}
              canBulkSelect={canBulkSelect}
              canBulkStartCollection={canBulkStartCollection}
              canBulkRunChecks={canBulkRunChecks}
              canBulkDelete={canBulkDelete}
              filterBp={filterBp}
              filterIncomplete={filterIncomplete}
              filterBlockers={filterBlockers}
              checkedKeys={checkedKeys}
              checkedRows={checkedRows}
              checkedDeletableRows={checkedDeletableRows}
              packageVirt={packageVirt}
              scrollRef={packageTableScrollRef}
              onOpenSettings={() => setTab("period-settings")}
              onFilterBpChange={setFilterBp}
              onFilterIncompleteChange={setFilterIncomplete}
              onFilterBlockersChange={setFilterBlockers}
              onToggleChecked={toggleChecked}
              onClearSelection={clearSelection}
              onSelectAll={() =>
                setCheckedKeys(new Set(campaignPackages.map((r) => rowKey(r))))
              }
              onFillForms={openFillForms}
              onBulkStartCollection={() => void handleBulkStartCollection()}
              onBulkChecks={() => void handleBulkChecks()}
              onBulkDelete={() => void handleBulkDelete()}
              onOpenPackage={(z, e, kind) => {
                void selectPackage(z, e, kind);
                setTab("overview");
              }}
              onClosePeriodFor={(z, e) => void handleClosePeriodFor(z, e)}
              onReopenPeriodFor={(z, e) => void handleReopenPeriodFor(z, e)}
              onDeletePackage={(r) => void handleDeletePackage(r)}
            />
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
              <PackageSelectedPackageCard
                selectedRow={selectedRow}
                detailLoading={detailLoading}
                bpBlockers={bpBlockers}
                primaryCta={primaryCta}
                canMutate={canMutate}
                busy={busy}
                bpBusy={bpBusy}
                packageChecksBusy={packageChecksBusy}
                backend={backend}
                formsLinkLabel={formsLinkLabel}
                checkExplanationsLink={checkExplanationsLink}
                onBackToPeriod={() => {
                  setZid("");
                  setEid("");
                  setDetail(null);
                  setTab("period");
                }}
                onPrimaryCta={() => void runPrimaryCta()}
                onRunPackageChecks={() => void handleRunPackageChecks()}
              />

              {tab === "overview" && selectedRow && (
                <PackageOverviewPanel
                  selectedRow={selectedRow}
                  bpBlockers={bpBlockers}
                  canMutate={canMutate}
                  periodClosed={periodClosed}
                  busy={busy}
                  checkExplanationsLink={checkExplanationsLink}
                  onFillForms={() => openFillForms([selectedRow])}
                  onOpenFormsTab={() => setTab("forms")}
                />
              )}

              {tab === "forms" && (
                <PackageFormsTabPanel
                  completeness={completeness}
                  formItems={formItems}
                  formSearch={formSearch}
                  formFilter={formFilter}
                  canMutate={canMutate}
                  periodClosed={periodClosed}
                  busy={busy}
                  selectedRow={selectedRow}
                  onFormSearchChange={setFormSearch}
                  onFormFilterChange={setFormFilter}
                  onFillForms={() => selectedRow && openFillForms([selectedRow])}
                />
              )}

              {tab === "bp" && (
                <PackageBpPanel
                  backend={backend}
                  bp={bp}
                  bpBlockers={bpBlockers}
                  bpActions={bpActions}
                  bpBusy={bpBusy}
                  packageChecksBusy={packageChecksBusy}
                  canMutate={canMutate}
                  checkExplanationsLink={checkExplanationsLink}
                  onBpAction={(action) => void handleBpAction(action)}
                  onRunPackageChecks={() => void handleRunPackageChecks()}
                />
              )}
            </>
          ) : null}

          {tab === "setup" && admin && (
            <PackageSetupPanel
              selectedRow={selectedRow}
              canMutate={canMutate}
              periodClosed={periodClosed}
              busy={busy}
              zid={zid}
              eid={eid}
              childOrgs={childOrgs}
              childOrgCount={childOrgCount}
              canDeletePackage={canDeletePackage}
              onDistribute={() => void handleDistribute()}
              onDeletePackage={() => void handleDeletePackage()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
