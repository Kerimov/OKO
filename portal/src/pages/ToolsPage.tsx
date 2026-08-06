import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { loadSchema } from "../api";
import {
  checkAccountRelations,
  createCorrSet,
  fillBalanceFromAccounts,
  listAggEntries,
  listCorrSets,
  previewPackageAggregation,
  runPackageAggregation,
  validateAccountRows,
  type AggCorrSet,
  type AggrAccountValidationResult,
  type AggregationColorMode,
  type AggregationPreview,
  type AggListEntry,
  type FillBalanceApiResult,
  type RelationsAccRowsApiResult,
} from "../aggregationApi";
import {
  getCheckRuleCounts,
  reorgVariantsForRun,
  runAggregationChecks,
  runAllChecks,
  runReorgChecks,
  type CheckMode,
  type CheckRunResult,
} from "../engine/checkEngine";
import { getCompleteness, type CompletenessItem } from "../engine/completeness";
import { readReportPackageFile } from "../engine/packageExport";
import {
  downloadLoansNzsPackage,
  importLoansNzsPackage,
  KZS_GROUP,
  LOAN_NZS_GROUPS,
  loadEffectiveLoansNzs,
  NZS_GROUP,
  readLoansNzsPackageFile,
  type LoansNzsPackage,
} from "../engine/refsPackage";
import { clearRashRefsCache } from "../engine/rashRefs";
import { downloadN99Csv, listN99Changes } from "../engine/n99Report";
import { loadWorkPackageInstances } from "../engine/workPackageInstances";
import {
  latestInstancePerTemplate,
  loadInstancesForCheck,
} from "../engine/instanceIndex";
import {
  loadWorkContext,
  listOrganizations,
  listPeriods,
  listPackageInbox,
  receivePackageInbox,
  acceptPackageInbox,
  rejectPackageInbox,
  previewPackageInbox,
  getPackageInboxDetail,
  type PackageInboxItem,
} from "../packagesApi";
import {
  fetchActiveMethodology,
  listMethodologyHistory,
  rollbackMethodology,
  snapshotMethodology,
  dryRunMethodology,
  type MethodologyRelease,
} from "../engine/packageRules";
import { prepareRecalcPackage, type RecalcPackageItem } from "../engine/recalcEngine";
import {
  applySaldoToTarget,
  compareSaldoByColumns,
  compareSaldoDetailed,
  countSaldoRulesForForm,
  transferSaldoByColumns,
  transferSaldoDetailed,
  type SaldoCompareResult,
  type SaldoPhase,
  type SaldoTransferMode,
} from "../engine/saldoEngine";
import {
  listInstances,
  loadAllInstances,
  loadGlobalMeta,
  loadKontrAgents,
  renameKontrAgent,
  saveInstance,
  saveInstancesAtomic,
  isBackendMode,
} from "../storage";
import type { InstanceSummary, KontrAgent, OkoFormInstance } from "../types";
import { useAuth } from "../useAuth";
import { AdvancedTab } from "./tools/AdvancedTab";
import { AggregationTab } from "./tools/AggregationTab";
import { ExchangeTab } from "./tools/ExchangeTab";
import { OverviewTab } from "./tools/OverviewTab";
import { QualityTab } from "./tools/QualityTab";
import { ReferencesTab } from "./tools/ReferencesTab";
import { SaldoTab } from "./tools/SaldoTab";
import {
  parseExchangeMode,
  TOOLS_TABS,
  type ExchangeMode,
  type ToolsTabId,
} from "./tools/tabs";

function parseToolsTab(raw: string | null): ToolsTabId {
  // Legacy deep-links from when export/upload were top-level tabs
  if (raw === "export" || raw === "upload") return "exchange";
  if (raw && TOOLS_TABS.some((t) => t.id === raw)) return raw as ToolsTabId;
  return "overview";
}

export function ToolsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const activeTab = parseToolsTab(searchParams.get("tab"));
  const exchangeMode = parseExchangeMode(
    searchParams.get("mode") ??
      (searchParams.get("tab") === "upload" ? "upload" : null)
  );

  const setActiveTab = (id: ToolsTabId, opts?: { exchangeMode?: ExchangeMode }) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "overview") {
          next.delete("tab");
          next.delete("mode");
        } else {
          next.set("tab", id);
          if (id === "exchange") {
            const mode = opts?.exchangeMode ?? "export";
            if (mode === "upload") next.set("mode", "upload");
            else next.delete("mode");
          } else {
            next.delete("mode");
          }
        }
        return next;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    const raw = searchParams.get("tab");
    if (raw !== "export" && raw !== "upload") return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "exchange");
        if (raw === "upload") next.set("mode", "upload");
        else next.delete("mode");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);
  const [summaries, setSummaries] = useState<InstanceSummary[]>([]);
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMode, setCheckMode] = useState<CheckMode>("period");
  const [ruleCounts, setRuleCounts] = useState<{
    period: number;
    active: number;
    all: number;
    aggrExcluded: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [completeness, setCompleteness] = useState<{
    total: number;
    filled: number;
    items: CompletenessItem[];
  } | null>(null);

  const [saldoSource, setSaldoSource] = useState("");
  const [saldoTarget, setSaldoTarget] = useState("");
  const [saldoPhase, setSaldoPhase] = useState<SaldoPhase>("previous_period");
  const [saldoMode, setSaldoMode] = useState<SaldoTransferMode>("columns");
  const [saldoDetailedType, setSaldoDetailedType] = useState<"t" | "s" | "g">("t");
  const [saldoRuleCount, setSaldoRuleCount] = useState<number | null>(null);
  const [saldoDryRun, setSaldoDryRun] = useState(false);
  const [saldoCompare, setSaldoCompare] = useState<SaldoCompareResult | null>(null);

  const [pkgParentZid, setPkgParentZid] = useState<number | "">("");
  const [pkgEid, setPkgEid] = useState<number | "">("");
  const [pkgChildEntries, setPkgChildEntries] = useState<AggListEntry[]>([]);
  const [pkgSelectedChildren, setPkgSelectedChildren] = useState<number[]>([]);
  const [pkgRequireAll, setPkgRequireAll] = useState(false);
  const [pkgRecalc, setPkgRecalc] = useState(true);
  const [pkgColorMode, setPkgColorMode] = useState<AggregationColorMode>("full");
  const [pkgReorg, setPkgReorg] = useState(false);
  const [pkgUpdateCorr, setPkgUpdateCorr] = useState(false);
  const [pkgIncludeDraftSources, setPkgIncludeDraftSources] = useState(false);
  const [pkgOverwriteSubmitted, setPkgOverwriteSubmitted] = useState(false);
  const [pkgTargetZid, setPkgTargetZid] = useState<number | "">("");
  const [pkgCorrSets, setPkgCorrSets] = useState<AggCorrSet[]>([]);
  const [pkgPreview, setPkgPreview] = useState<AggregationPreview | null>(null);
  const [pkgPeriods, setPkgPeriods] = useState<Array<{ eid: number; name: string }>>([]);
  const [pkgParents, setPkgParents] = useState<
    Array<{ zid: number; name: string; code?: string | null }>
  >([]);
  const [aggrCheckResult, setAggrCheckResult] = useState<CheckRunResult | null>(null);
  const [reorgCheckResult, setReorgCheckResult] = useState<CheckRunResult | null>(null);
  const [accountRowResult, setAccountRowResult] = useState<AggrAccountValidationResult | null>(
    null
  );
  const [relationsResult, setRelationsResult] = useState<RelationsAccRowsApiResult | null>(null);
  const [fillBalanceResult, setFillBalanceResult] = useState<FillBalanceApiResult | null>(null);
  const [fillBalanceMode, setFillBalanceMode] = useState<"ifEmpty" | "overwrite">("ifEmpty");

  const [periodInstances, setPeriodInstances] = useState<OkoFormInstance[]>([]);
  const [workZid, setWorkZid] = useState<number | null>(null);
  const [workEid, setWorkEid] = useState<number | null>(null);
  const [recalcReport, setRecalcReport] = useState<RecalcPackageItem[] | null>(null);
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [n99RenameId, setN99RenameId] = useState<number | "">("");
  const [n99RenameTo, setN99RenameTo] = useState("");
  const [loansPkg, setLoansPkg] = useState<LoansNzsPackage | null>(null);
  const [loansMerge, setLoansMerge] = useState<"merge" | "replace">("merge");
  const [n99Rows, setN99Rows] = useState<KontrAgent[]>([]);
  const [kontrAll, setKontrAll] = useState<KontrAgent[]>([]);
  const [inboxItems, setInboxItems] = useState<PackageInboxItem[]>([]);
  const [methodologyVersion, setMethodologyVersion] = useState<string | null>(null);
  const [methodologyActivatedAt, setMethodologyActivatedAt] = useState<string | null>(
    null
  );
  const [methodologyHistory, setMethodologyHistory] = useState<MethodologyRelease[]>([]);
  const [methodologyChecksums, setMethodologyChecksums] = useState<
    MethodologyRelease["checksums"] | null
  >(null);
  const [orgNameByZid, setOrgNameByZid] = useState<Map<number, string>>(new Map());
  const backend = isBackendMode();

  useEffect(() => {
    void listOrganizations()
      .then((orgs) => {
        const map = new Map<number, string>();
        for (const o of orgs) map.set(o.zid, o.name);
        setOrgNameByZid(map);
      })
      .catch(() => setOrgNameByZid(new Map()));
  }, []);

  const refreshMethodology = async () => {
    const [m, hist] = await Promise.all([
      fetchActiveMethodology(),
      listMethodologyHistory().catch(() => [] as MethodologyRelease[]),
    ]);
    setMethodologyVersion(m?.version ?? null);
    setMethodologyActivatedAt(m?.activatedAt ?? null);
    setMethodologyChecksums(m?.checksums ?? null);
    setMethodologyHistory(hist);
  };

  useEffect(() => {
    if (saldoMode !== "detailed" || !saldoTarget) {
      setSaldoRuleCount(null);
      return;
    }
    const templateId = summaries.find(
      (s) =>
        s.instanceId === saldoTarget &&
        (workZid == null || s.zid === workZid) &&
        (workEid == null || s.eid === workEid)
    )?.templateId;
    if (!templateId) return;
    countSaldoRulesForForm(templateId, saldoDetailedType).then(setSaldoRuleCount);
  }, [saldoMode, saldoTarget, saldoDetailedType, summaries, workZid, workEid]);

  const refresh = async () => setSummaries(await listInstances());

  useEffect(() => {
    refresh();
    getCheckRuleCounts().then(setRuleCounts);
  }, []);

  useEffect(() => {
    if (!backend) return;
    void listPackageInbox().then(setInboxItems).catch(() => setInboxItems([]));
    void refreshMethodology().catch(() => {
      setMethodologyVersion(null);
      setMethodologyActivatedAt(null);
      setMethodologyHistory([]);
    });
  }, [backend]);

  useEffect(() => {
    (async () => {
      const [meta, work] = await Promise.all([loadGlobalMeta(), loadWorkContext()]);
      const filter =
        work.zid != null && work.eid != null
          ? { zid: work.zid, eid: work.eid }
          : { start: meta.periodStart, end: meta.periodEnd };
      getCompleteness(summaries, filter).then(setCompleteness);
    })();
  }, [summaries]);

  useEffect(() => {
    (async () => {
      const { instances, zid, eid } = await loadWorkPackageInstances();
      setWorkZid(zid);
      setWorkEid(eid);
      setPeriodInstances(instances);
    })();
  }, [summaries, location.pathname]);

  useEffect(() => {
    loadEffectiveLoansNzs()
      .then(setLoansPkg)
      .catch(() => setLoansPkg(null));
    loadKontrAgents()
      .then((agents) => {
        setKontrAll(agents);
        setN99Rows(listN99Changes(agents));
      })
      .catch(() => {
        setKontrAll([]);
        setN99Rows([]);
      });
  }, []);

  const scopedSummaries = useMemo(() => {
    if (workZid == null || workEid == null) return [];
    return summaries.filter((s) => s.zid === workZid && s.eid === workEid);
  }, [summaries, workZid, workEid]);

  const aggParentZids = pkgParents;

  const applyParentSelection = async (zid: number, preferredEid?: number) => {
    setPkgParentZid(zid);
    setPkgEid("");
    setPkgTargetZid("");
    setPkgPreview(null);
    try {
      const entries = await listAggEntries(zid);
      setPkgChildEntries(entries);
      setPkgSelectedChildren(entries.filter((e) => e.included).map((e) => e.childZid));
      const periods = await listPeriods(zid);
      setPkgPeriods(periods.map((p) => ({ eid: p.eid, name: p.name })));
      const initialEid =
        preferredEid && periods.some((p) => p.eid === preferredEid)
          ? preferredEid
          : periods[0]?.eid;
      if (initialEid != null) setPkgEid(initialEid);
      else setPkgEid("");
      try {
        setPkgCorrSets(await listCorrSets(zid));
      } catch {
        setPkgCorrSets([]);
      }
    } catch {
      setPkgChildEntries([]);
      setPkgSelectedChildren([]);
      setPkgCorrSets([]);
    }
  };

  const refreshCorrSets = async () => {
    if (pkgParentZid === "") return;
    try {
      setPkgCorrSets(await listCorrSets(pkgParentZid));
    } catch {
      setPkgCorrSets([]);
    }
  };

  const handleCreateCorrSet = async (kind: "correct" | "mirror") => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    const label = kind === "mirror" ? "зеркало" : "корректирующий набор";
    if (
      !window.confirm(
        `Создать ${label} для орг. ${pkgParentZid}, период ${pkgEid}? Будут созданы новые формы в целевом комплекте.`
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await createCorrSet({
        parentZid: pkgParentZid,
        eid: pkgEid,
        kind,
      });
      await refreshCorrSets();
      setPkgTargetZid(result.set.corrZid);
      setStatus(
        `${kind === "mirror" ? "Зеркало" : "Корректирующий набор"} создан (ZID ${result.set.corrZid}): ` +
          `форм ${result.formsCreated + result.formsMirrored}` +
          (result.formsMirrored ? ` (зеркало: ${result.formsMirrored})` : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка создания набора");
    } finally {
      setBusy(false);
    }
  };

  const handleFillBalance = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    if (fillBalanceMode === "overwrite") {
      if (
        !window.confirm(
          "Перезаписать колонку H баланса из N01_02? Существующие значения будут заменены."
        )
      ) {
        return;
      }
    }
    setBusy(true);
    try {
      const targetZid = pkgTargetZid === "" ? undefined : pkgTargetZid;
      const filled = await fillBalanceFromAccounts({
        parentZid: pkgParentZid,
        eid: pkgEid,
        targetZid,
        mode: fillBalanceMode,
        overwriteSubmitted: pkgOverwriteSubmitted,
      });
      setFillBalanceResult(filled);
      if (filled.ok) {
        const rel = await checkAccountRelations({
          parentZid: pkgParentZid,
          eid: pkgEid,
          targetZid,
        });
        setRelationsResult(rel);
        await refresh();
        setStatus(
          `Заполнение баланса: обновлено ${filled.updated} строк H` +
            (filled.skippedNonEmpty ? `, пропущено непустых ${filled.skippedNonEmpty}` : "") +
            ` · сверка: ${rel.mismatched}/${rel.compared} расхождений`
        );
      } else {
        setStatus(filled.message ?? "Не удалось заполнить баланс");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка заполнения баланса");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckRelations = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    setBusy(true);
    try {
      const rel = await checkAccountRelations({
        parentZid: pkgParentZid,
        eid: pkgEid,
        targetZid: pkgTargetZid === "" ? undefined : pkgTargetZid,
      });
      setRelationsResult(rel);
      setStatus(
        rel.message
          ? `RelCheck: ${rel.message}`
          : `RelCheck: ${rel.mismatched}/${rel.compared} расхождений (пропуск итогов ${rel.skipped})`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка CheckRelationsAccRows");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!backend) return;
    (async () => {
      try {
        const [entries, ctx, orgs] = await Promise.all([
          listAggEntries(),
          loadWorkContext(),
          listOrganizations(),
        ]);
        const parentIds = [...new Set(entries.map((e) => e.parentZid))];
        const parents = parentIds.map((zid) => {
          const org = orgs.find((o) => o.zid === zid);
          const sample = entries.find((e) => e.parentZid === zid);
          return {
            zid,
            name: org?.name ?? sample?.parentName ?? `Организация ${zid}`,
            code: org?.code ?? sample?.parentCode,
          };
        });
        setPkgParents(parents);
        const initialParent = ctx.zid && parentIds.includes(ctx.zid) ? ctx.zid : parentIds[0];
        if (initialParent != null) {
          await applyParentSelection(initialParent, ctx.eid ?? undefined);
        } else if (orgs[0]) {
          setPkgParentZid(orgs[0].zid);
        }
      } catch {
        /* optional */
      }
    })();
  }, [backend]);

  const handlePkgParentChange = async (zid: number) => {
    await applyParentSelection(zid);
  };

  const handleAggPreview = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    if (pkgSelectedChildren.length === 0) {
      setStatus("Отметьте хотя бы одного участника свода");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const preview = await previewPackageAggregation({
        parentZid: pkgParentZid,
        eid: pkgEid,
        childZids: pkgSelectedChildren,
        requireAllChildren: pkgRequireAll,
        colorMode: pkgColorMode,
        reorg: pkgReorg,
        updateCorrSet: pkgUpdateCorr,
        targetZid: pkgTargetZid === "" ? undefined : pkgTargetZid,
        includeDraftSources: pkgIncludeDraftSources,
        overwriteSubmitted: pkgOverwriteSubmitted,
      });
      setPkgPreview(preview);
      setStatus(
        `Превью: будет сведено ${preview.willAggregate} форм, пропущено ${preview.willSkip}` +
          (preview.targetZid && preview.targetZid !== preview.parentZid
            ? ` → ZID ${preview.targetZid}`
            : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка превью свода");
    } finally {
      setBusy(false);
    }
  };

  const handlePackageAggregate = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    if (pkgSelectedChildren.length === 0) {
      setStatus("Отметьте хотя бы одного участника свода");
      return;
    }
    const destZid = pkgTargetZid === "" ? pkgParentZid : pkgTargetZid;
    const warnings: string[] = [];
    if (pkgIncludeDraftSources) warnings.push("включая черновики участников");
    if (pkgOverwriteSubmitted) warnings.push("с перезаписью сданных целевых форм");
    const confirmMsg =
      `Выполнить свод орг. ${pkgParentZid} → ${destZid}, период ${pkgEid}` +
      ` (${pkgSelectedChildren.length} участников` +
      (warnings.length ? `; ${warnings.join("; ")}` : "") +
      ")?\n\nОперация перезапишет формы целевого комплекта.";
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setStatus("");
    setAggrCheckResult(null);
    setReorgCheckResult(null);
    setAccountRowResult(null);
    setRelationsResult(null);
    setFillBalanceResult(null);
    try {
      const result = await runPackageAggregation({
        parentZid: pkgParentZid,
        eid: pkgEid,
        childZids: pkgSelectedChildren,
        requireAllChildren: pkgRequireAll,
        recalc: pkgRecalc,
        colorMode: pkgColorMode,
        reorg: pkgReorg,
        updateCorrSet: pkgUpdateCorr,
        targetZid: pkgTargetZid === "" ? undefined : pkgTargetZid,
        includeDraftSources: pkgIncludeDraftSources,
        overwriteSubmitted: pkgOverwriteSubmitted,
      });
      await refresh();
      const targetZid =
        result.targetZid ??
        (pkgTargetZid === "" ? Number(pkgParentZid) : Number(pkgTargetZid));
      const targetEid = Number(pkgEid);
      const targetInstances = latestInstancePerTemplate(
        await loadInstancesForCheck({ zid: targetZid, eid: targetEid })
      );
      const checks = await runAggregationChecks(undefined, targetInstances, "all");
      setAggrCheckResult(checks);

      const reorgVariants = reorgVariantsForRun({
        colorMode: pkgColorMode,
        reorg: pkgReorg || pkgUpdateCorr,
      });
      let reorgChecks: CheckRunResult | null = null;
      if (reorgVariants) {
        const parentName =
          pkgParents.find((p) => p.zid === pkgParentZid)?.name ?? null;
        reorgChecks = await runReorgChecks({
          variants: reorgVariants,
          reorgOrg: pkgReorg || pkgUpdateCorr ? parentName : null,
          instances: targetInstances,
        });
        setReorgCheckResult(reorgChecks);
      }

      const destTargetZid =
        result.targetZid ?? (pkgTargetZid === "" ? undefined : pkgTargetZid);

      let acct: AggrAccountValidationResult | null = null;
      try {
        acct = await validateAccountRows({
          parentZid: pkgParentZid,
          eid: pkgEid,
          targetZid: destTargetZid,
        });
        setAccountRowResult(acct);
      } catch {
        setAccountRowResult(null);
      }

      let rel: RelationsAccRowsApiResult | null = null;
      try {
        rel = await checkAccountRelations({
          parentZid: pkgParentZid,
          eid: pkgEid,
          targetZid: destTargetZid,
        });
        setRelationsResult(rel);
      } catch {
        setRelationsResult(null);
      }

      const preview = await previewPackageAggregation({
        parentZid: pkgParentZid,
        eid: pkgEid,
        childZids: pkgSelectedChildren,
        requireAllChildren: pkgRequireAll,
        colorMode: pkgColorMode,
        reorg: pkgReorg,
        updateCorrSet: pkgUpdateCorr,
        targetZid: pkgTargetZid === "" ? undefined : pkgTargetZid,
        includeDraftSources: pkgIncludeDraftSources,
        overwriteSubmitted: pkgOverwriteSubmitted,
      });
      setPkgPreview(preview);
      const dest =
        result.targetZid && result.targetZid !== result.parentZid
          ? ` → корр. ZID ${result.targetZid}`
          : "";
      const modeHint =
        pkgColorMode === "full"
          ? ""
          : pkgUpdateCorr
            ? ` · обновление корр. набора (${pkgColorMode})`
            : ` · ${pkgReorg ? "создание корр. набора" : "свод"} ${pkgColorMode}`;
      const reorgHint = reorgChecks
        ? ` · увязки реорг.: ${reorgChecks.passed}/${reorgChecks.total}`
        : "";
      const acctHint = acct
        ? acct.message
          ? ` · счета: ${acct.message}`
          : ` · счета: пар ${acct.totals.tempRows}, замечаний ${
              acct.totals.unusedAccounts +
              acct.totals.missingRowMappings +
              acct.totals.blankAccountCells +
              acct.totals.orphanAmounts
            }`
        : "";
      const relHint = rel
        ? rel.message
          ? ` · сверка: ${rel.message}`
          : ` · сверка: ${rel.mismatched}/${rel.compared} расхождений`
        : "";
      setStatus(
        `Свод завершён: ${result.aggregated} форм, пропущено ${result.skipped}` +
          dest +
          (result.missing.length ? `, нет данных: ${result.missing.length}` : "") +
          modeHint +
          ` · увязки агрегации (ZID ${targetZid}): ${checks.passed}/${checks.total} пройдено` +
          reorgHint +
          acctHint +
          relHint
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка агрегации комплекта");
    } finally {
      setBusy(false);
    }
  };

  const handleSyncAggWithWorkContext = () => {
    if (workZid == null) {
      setStatus("Сначала выберите организацию в комплекте");
      return;
    }
    void applyParentSelection(workZid, workEid ?? undefined);
    setStatus(`Свод синхронизирован с комплектом: орг. ${workZid}, период ${workEid ?? "—"}`);
  };

  const handleCheckAll = async () => {
    setChecking(true);
    setStatus("");
    try {
      const meta = await loadGlobalMeta();
      const periodStart =
        periodInstances[0]?.meta.periodStart || meta.periodStart;
      const periodEnd = periodInstances[0]?.meta.periodEnd || meta.periodEnd;
      const result = await runAllChecks(
        {
          start: periodStart,
          end: periodEnd,
          zid: workZid,
          eid: workEid,
        },
        checkMode
      );
      setCheckResult(result);
      const scopeHint =
        workZid != null && workEid != null
          ? ` (орг. ${workZid}, период ${workEid})`
          : " (по датам периода; ZID/EID не заданы)";
      setStatus(
        result.failed === 0
          ? `Проверки пройдены (${result.total} правил)${scopeHint}`
          : `Ошибок: ${result.failed} из ${result.total}${scopeHint}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка проверки");
    } finally {
      setChecking(false);
    }
  };

  const handleRecalcAll = async () => {
    setBusy(true);
    setRecalcReport(null);
    try {
      const prepared = await prepareRecalcPackage(periodInstances, loadSchema);
      setRecalcReport(prepared.items);
      if (!prepared.ok) {
        const first = prepared.items.find((i) => !i.ok);
        setStatus(
          `Пересчёт отменён — ничего не сохранено. Ошибка на «${first?.displayName ?? first?.templateId}»: ${first?.error ?? "неизвестно"}`
        );
        return;
      }
      if (prepared.changedCount === 0) {
        setStatus(`Пересчёт: изменений нет (${prepared.items.length} форм проверено)`);
        return;
      }
      const { saved } = await saveInstancesAtomic(prepared.computed);
      await refresh();
      setStatus(
        `Пересчёт сохранён атомарно: ${saved} форм, изменилось ${prepared.changedCount}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка пересчёта");
    } finally {
      setBusy(false);
    }
  };

  const handleExportLoansNzs = async () => {
    try {
      const out = await downloadLoansNzsPackage(loansPkg ?? undefined);
      setStatus(
        `Справочники займов/НЗС выгружены: ${KZS_GROUP} ${out.counts?.[KZS_GROUP] ?? 0}, ${NZS_GROUP} ${out.counts?.[NZS_GROUP] ?? 0}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка выгрузки справочников");
    }
  };

  const handleImportLoansNzs = async (file: File) => {
    setBusy(true);
    try {
      const incoming = await readLoansNzsPackageFile(file);
      const current = loansPkg ?? (await loadEffectiveLoansNzs());
      const { previewLoansNzsImport } = await import("../engine/refsValidation");
      const preview = previewLoansNzsImport(current, incoming, loansMerge);
      const lines = [
        `Режим: ${loansMerge === "merge" ? "слияние" : "замена"}`,
        ...LOAN_NZS_GROUPS.map(
          (g) =>
            `${g}: ${preview.currentCounts[g]} → ${preview.resultCounts[g]} (в файле ${preview.incomingCounts[g]})`
        ),
        preview.added ? `Прирост (оценка): +${preview.added}` : null,
        preview.removed ? `Удаление (оценка): −${preview.removed}` : null,
        ...preview.warnings,
        "Применить импорт?",
      ].filter(Boolean);
      if (!confirm(lines.join("\n"))) {
        setStatus("Импорт справочников отменён");
        return;
      }
      const { package: pkg, added, total } = await importLoansNzsPackage(
        incoming,
        loansMerge
      );
      setLoansPkg(pkg);
      clearRashRefsCache();
      setStatus(
        `Справочники займов/НЗС приняты (${loansMerge === "merge" ? "слияние" : "замена"}): всего ${total}, прирост ${added}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка импорта справочников");
    } finally {
      setBusy(false);
    }
  };

  const handleN99Csv = () => {
    const n = downloadN99Csv(n99Rows);
    setStatus(
      n === 0
        ? "N99: изменений нет — лист не формируем (как в Access)"
        : `N99: выгружено ${n} записей (CSV)`
    );
  };

  const handleRefreshN99 = () => {
    loadKontrAgents()
      .then((agents) => {
        const rows = listN99Changes(agents);
        setN99Rows(rows);
        setStatus(
          rows.length === 0
            ? "N99: изменений нет"
            : `N99: ${rows.length} записей с «Другим наименованием»`
        );
      })
      .catch((e) =>
        setStatus(e instanceof Error ? e.message : "Ошибка загрузки контрагентов")
      );
  };

  const handleRenameN99 = () => {
    if (n99RenameId === "") return;
    void renameKontrAgent(n99RenameId, n99RenameTo.trim())
      .then(() => loadKontrAgents())
      .then((agents) => {
        setKontrAll(agents);
        setN99Rows(listN99Changes(agents));
        setN99RenameTo("");
        setStatus("Переименовано: старое имя сохранено в oldName");
      })
      .catch((e) =>
        setStatus(e instanceof Error ? e.message : "Ошибка переименования")
      );
  };

  const handleSaldo = async () => {
    if (workZid == null || workEid == null) {
      setStatus("Сначала выберите организацию и период в комплекте");
      return;
    }
    const scoped =
      periodInstances.length > 0
        ? periodInstances
        : (await loadAllInstances()).filter((i) => i.zid === workZid && i.eid === workEid);
    const source = scoped.find((i) => i.instanceId === saldoSource);
    const target = scoped.find((i) => i.instanceId === saldoTarget);
    if (!source || !target) {
      setStatus("Выберите исходную и целевую формы рабочего комплекта");
      return;
    }
    if (source.templateId !== target.templateId) {
      setStatus(
        `Шаблоны должны совпадать: ${source.templateId} ≠ ${target.templateId}`
      );
      return;
    }
    try {
      if (saldoMode === "detailed") {
        if (saldoDryRun) {
          const cmp = await compareSaldoDetailed(
            source,
            target,
            saldoDetailedType,
            scoped
          );
          setSaldoCompare(cmp);
          setStatus(
            cmp.diffs.length === 0
              ? `Сверка сальдо (детальные ${saldoDetailedType.toUpperCase()}): расхождений нет`
              : `Сверка сальдо (детальные): ${cmp.diffs.length} ячеек в ${cmp.wouldUpdateRows} строках (данные не изменены)`
          );
          return;
        }
        const result = await transferSaldoDetailed(
          source,
          target,
          saldoDetailedType,
          scoped
        );
        if (result.applied === 0) {
          setStatus(
            `Правила сальдо (${saldoDetailedType.toUpperCase()}): нет применимых ячеек для ${target.templateId}`
          );
          return;
        }
        await saveInstance(applySaldoToTarget(target, result.rows));
        await refresh();
        setSaldoCompare(null);
        setStatus(
          `Сальдо (детальные правила, ${saldoDetailedType.toUpperCase()}): применено ${result.applied} ячеек` +
            (result.warning ? ` · ${result.warning}` : "")
        );
        return;
      }
      if (saldoDryRun) {
        const cmp = await compareSaldoByColumns({
          source,
          target,
          phase: saldoPhase,
        });
        setSaldoCompare(cmp);
        setStatus(
          cmp.diffs.length === 0
            ? `Сверка сальдо: расхождений нет (графы ${cmp.columns.join(", ") || "—"})`
            : `Сверка сальдо: ${cmp.diffs.length} ячеек в ${cmp.wouldUpdateRows} строках отличаются (данные не изменены)`
        );
        return;
      }
      const result = await transferSaldoByColumns({ source, target, phase: saldoPhase });
      await saveInstance(applySaldoToTarget(target, result.rows));
      await refresh();
      setSaldoCompare(null);
      setStatus(
        `Сальдо (соответствие форм): ${result.rowsUpdated} строк, графы ${result.columnsCopied.join(", ")}` +
          (result.warning ? ` · ${result.warning}` : "")
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка переноса сальдо");
    }
  };

  const missingForms = completeness?.items.filter((i) => !i.filled) ?? [];
  const activeTabMeta = TOOLS_TABS.find((t) => t.id === activeTab);

  if (isBackendMode() && auth.authRequired && auth.user?.role === "org") {
    return <Navigate to="/my" replace />;
  }

  return (
    <div className="tools-page">
      <h1>Обмен и операции</h1>
      <p className="tools-intro">
        Выгрузка и приём комплектов, контроль качества, сальдо и свод. Рабочий
        комплект для одиночных операций задаётся в{" "}
        <Link to="/package">Комплектах</Link>. Массовая выгрузка для дочек не зависит
        от текущего выбора. Редакторы методологии:{" "}
        <Link to="/admin/forms">формы</Link>,{" "}
        <Link to="/admin/checks">увязки</Link>,{" "}
        <Link to="/admin/saldo">сальдо</Link>,{" "}
        <Link to="/admin/rash">расшифровки</Link>,{" "}
        <Link to="/admin/aggregation">агрегация</Link>.
      </p>

      <div className="tools-context-bar">
        <span>
          Организация:{" "}
          <strong>
            {workZid == null
              ? "не выбрана"
              : orgNameByZid.get(workZid)
                ? `${workZid} — ${orgNameByZid.get(workZid)}`
                : String(workZid)}
          </strong>
        </span>
        <span>
          Период: <strong>{workEid ?? "не выбран"}</strong>
        </span>
        <span>
          Форм в комплекте: <strong>{periodInstances.length}</strong>
        </span>
        {completeness && (
          <span>
            Полнота:{" "}
            <strong>
              {completeness.filled}/{completeness.total}
            </strong>
          </span>
        )}
        <Link to="/package" className="tools-context-link">
          Сменить комплект
        </Link>
      </div>
      <p className="tools-hint" style={{ marginTop: "-0.25rem" }}>
        Панель выше — контекст для «Текущий комплект», контроля и сальдо. Массовая
        выгрузка и приём файлов — вкладка «Обмен» (Выгрузить / Загрузить).
      </p>

      <nav className="tools-tabs" role="tablist" aria-label="Разделы обмена и операций">
        {TOOLS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : undefined}
            onClick={() => setActiveTab(tab.id)}
            title={tab.hint}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTabMeta && <p className="tools-tab-hint">{activeTabMeta.hint}</p>}

      {status && (
        <div className="status-bar" role="status" aria-live="polite">
          {status}
        </div>
      )}

      {activeTab === "overview" && (
        <OverviewTab
          work={{
            zid: workZid,
            eid: workEid,
            formCount: periodInstances.length,
          }}
          completeness={completeness}
          missingForms={missingForms}
          onNavigateTab={setActiveTab}
        />
      )}

      {activeTab === "exchange" && (
        <ExchangeTab
          mode={exchangeMode}
          onModeChange={(mode) => setActiveTab("exchange", { exchangeMode: mode })}
          importOverwrite={importOverwrite}
          onImportOverwriteChange={setImportOverwrite}
          onStatus={setStatus}
          onImported={() => void refresh()}
          inbox={
            backend
              ? {
                  backend,
                  items: inboxItems,
                  onRefresh: () => {
                    void listPackageInbox()
                      .then(setInboxItems)
                      .catch(() => setInboxItems([]));
                  },
                  onQuarantineFile: (file) => {
                    void (async () => {
                      try {
                        const pkg = await readReportPackageFile(file);
                        const rawJson = JSON.stringify(pkg);
                        await receivePackageInbox({
                          rawJson,
                          filename: file.name,
                          targetZid: pkg.zid ?? workZid,
                          targetEid: pkg.eid ?? workEid,
                        });
                        setInboxItems(await listPackageInbox());
                        setStatus(`В очередь: ${file.name}`);
                      } catch (e) {
                        setStatus(
                          e instanceof Error ? e.message : "Ошибка загрузки в очередь"
                        );
                      }
                    })();
                  },
                  onPreview: (id) => {
                    void (async () => {
                      try {
                        const detail = await getPackageInboxDetail(id);
                        const zid =
                          Number(detail.packageJson.zid ?? detail.pkgZid ?? workZid) ||
                          null;
                        const eid =
                          Number(detail.packageJson.eid ?? detail.pkgEid ?? workEid) ||
                          null;
                        if (zid == null || eid == null) {
                          setStatus(
                            "В файле очереди нет zid/eid — выберите комплект в «Комплектах»"
                          );
                          return;
                        }
                        const preview = await previewPackageInbox(id, { zid, eid });
                        setStatus(
                          `Очередь превью → орг. ${zid}, период ${eid}: +${preview.summary.new} новых, ~${preview.summary.changed} изменённых`
                        );
                      } catch (e) {
                        setStatus(
                          e instanceof Error ? e.message : "Ошибка превью очереди"
                        );
                      }
                    })();
                  },
                  onAccept: (id) => {
                    void (async () => {
                      try {
                        const detail = await getPackageInboxDetail(id);
                        const zid =
                          Number(detail.packageJson.zid ?? detail.pkgZid ?? workZid) ||
                          null;
                        const eid =
                          Number(detail.packageJson.eid ?? detail.pkgEid ?? workEid) ||
                          null;
                        if (zid == null || eid == null) {
                          setStatus(
                            "В файле очереди нет zid/eid — выберите комплект в «Комплектах»"
                          );
                          return;
                        }
                        const r = await acceptPackageInbox(id, {
                          zid,
                          eid,
                          overwrite: importOverwrite,
                        });
                        setInboxItems(await listPackageInbox());
                        await refresh();
                        setStatus(
                          `Очередь принята → ${zid}/${eid}: +${r.result.created} / ≈${r.result.updated}`
                        );
                      } catch (e) {
                        setStatus(
                          e instanceof Error ? e.message : "Ошибка приёма из очереди"
                        );
                      }
                    })();
                  },
                  onReject: (id) => {
                    void (async () => {
                      try {
                        await rejectPackageInbox(id, "Отклонено оператором");
                        setInboxItems(await listPackageInbox());
                        setStatus("Очередь: отклонено");
                      } catch (e) {
                        setStatus(
                          e instanceof Error ? e.message : "Ошибка отклонения"
                        );
                      }
                    })();
                  },
                }
              : undefined
          }
        />
      )}

      {activeTab === "quality" && (
        <QualityTab
          work={{
            zid: workZid,
            eid: workEid,
            formCount: periodInstances.length,
          }}
          busy={busy}
          checking={checking}
          checkMode={checkMode}
          onCheckModeChange={setCheckMode}
          ruleCounts={ruleCounts}
          checkResult={checkResult}
          recalcReport={recalcReport}
          onRecalcAll={handleRecalcAll}
          onCheckAll={handleCheckAll}
        />
      )}

      {activeTab === "saldo" && (
        <SaldoTab
          summaries={scopedSummaries}
          sourceId={saldoSource}
          onSourceChange={setSaldoSource}
          targetId={saldoTarget}
          onTargetChange={setSaldoTarget}
          mode={saldoMode}
          onModeChange={setSaldoMode}
          phase={saldoPhase}
          onPhaseChange={setSaldoPhase}
          detailedType={saldoDetailedType}
          onDetailedTypeChange={setSaldoDetailedType}
          ruleCount={saldoRuleCount}
          dryRun={saldoDryRun}
          onDryRunChange={setSaldoDryRun}
          compare={saldoCompare}
          onClearCompare={() => setSaldoCompare(null)}
          onTransfer={handleSaldo}
        />
      )}

      {activeTab === "aggregation" && (
        <AggregationTab
          backend={backend}
          busy={busy}
          selection={{
            parentZid: pkgParentZid,
            eid: pkgEid,
            targetZid: pkgTargetZid,
            parents: aggParentZids,
            periods: pkgPeriods,
            corrSets: pkgCorrSets,
            childEntries: pkgChildEntries,
            selectedChildren: pkgSelectedChildren,
          }}
          options={{
            colorMode: pkgColorMode,
            requireAll: pkgRequireAll,
            recalc: pkgRecalc,
            reorg: pkgReorg,
            updateCorr: pkgUpdateCorr,
            fillBalanceMode,
            includeDraftSources: pkgIncludeDraftSources,
            overwriteSubmitted: pkgOverwriteSubmitted,
          }}
          results={{
            preview: pkgPreview,
            aggrChecks: aggrCheckResult,
            reorgChecks: reorgCheckResult,
            accountRows: accountRowResult,
            relations: relationsResult,
            fillBalance: fillBalanceResult,
          }}
          onParentChange={handlePkgParentChange}
          onEidChange={setPkgEid}
          onTargetZidChange={setPkgTargetZid}
          onToggleChild={(childZid) => {
            setPkgPreview(null);
            setPkgSelectedChildren((prev) =>
              prev.includes(childZid)
                ? prev.filter((z) => z !== childZid)
                : [...prev, childZid]
            );
          }}
          onSelectAllChildren={() => {
            setPkgSelectedChildren(pkgChildEntries.map((e) => e.childZid));
            setPkgPreview(null);
          }}
          onSelectIncludedChildren={() => {
            setPkgSelectedChildren(
              pkgChildEntries.filter((e) => e.included).map((e) => e.childZid)
            );
            setPkgPreview(null);
          }}
          onClearChildren={() => {
            setPkgSelectedChildren([]);
            setPkgPreview(null);
          }}
          onColorModeChange={(next) => {
            setPkgColorMode(next);
            if (next === "full") {
              setPkgReorg(false);
              setPkgUpdateCorr(false);
            }
            setPkgPreview(null);
          }}
          onRequireAllChange={(value) => {
            setPkgRequireAll(value);
            setPkgPreview(null);
          }}
          onRecalcChange={setPkgRecalc}
          onReorgChange={(value) => {
            setPkgReorg(value);
            setPkgPreview(null);
          }}
          onUpdateCorrChange={(on) => {
            setPkgUpdateCorr(on);
            if (on) setPkgReorg(false);
            setPkgPreview(null);
          }}
          onFillBalanceModeChange={setFillBalanceMode}
          onIncludeDraftSourcesChange={(value) => {
            setPkgIncludeDraftSources(value);
            setPkgPreview(null);
          }}
          onOverwriteSubmittedChange={(value) => {
            setPkgOverwriteSubmitted(value);
            setPkgPreview(null);
          }}
          onCreateCorrSet={handleCreateCorrSet}
          onPreview={handleAggPreview}
          onAggregate={handlePackageAggregate}
          onCheckRelations={handleCheckRelations}
          onFillBalance={handleFillBalance}
          onClearPreview={() => setPkgPreview(null)}
          workContext={{ zid: workZid, eid: workEid }}
          onSyncWithWorkContext={handleSyncAggWithWorkContext}
        />
      )}

      {activeTab === "references" && (
        <ReferencesTab
          loans={{
            pkg: loansPkg,
            mergeMode: loansMerge,
            onMergeModeChange: setLoansMerge,
          }}
          n99={{
            rows: n99Rows,
            allAgents: kontrAll,
            renameId: n99RenameId,
            renameTo: n99RenameTo,
            onRenameIdChange: setN99RenameId,
            onRenameToChange: setN99RenameTo,
          }}
          backend={backend}
          busy={busy}
          onExportLoans={handleExportLoansNzs}
          onImportLoans={handleImportLoansNzs}
          onN99Csv={handleN99Csv}
          onRefreshN99={handleRefreshN99}
          onRenameN99={handleRenameN99}
          methodology={{
            version: methodologyVersion,
            activatedAt: methodologyActivatedAt,
            checksums: methodologyChecksums,
            history: methodologyHistory,
            onSnapshot: () => {
              void (async () => {
                try {
                  const m = await snapshotMethodology();
                  await refreshMethodology();
                  setStatus(`Методология активирована: ${m.version}`);
                } catch (e) {
                  setStatus(
                    e instanceof Error ? e.message : "Ошибка снапшота методологии"
                  );
                }
              })();
            },
            onDryRun: () => {
              void (async () => {
                try {
                  const r = await dryRunMethodology({});
                  const changed = r.diff.filter((d) => !d.same).map((d) => d.key);
                  setStatus(
                    r.wouldChange
                      ? `Dry-run: изменятся ${changed.join(", ") || "ключи"}`
                      : "Dry-run: checksums совпадают с активным релизом"
                  );
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : "Ошибка dry-run");
                }
              })();
            },
            onRollback: (id) => {
              void (async () => {
                try {
                  const m = await rollbackMethodology(id);
                  await refreshMethodology();
                  setStatus(`Откат методологии: ${m.version}`);
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : "Ошибка отката");
                }
              })();
            },
          }}
        />
      )}

      {activeTab === "advanced" && <AdvancedTab onNavigateTab={setActiveTab} />}
    </div>
  );
}
