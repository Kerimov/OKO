import { useEffect, useState } from "react";
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
} from "../../aggregationApi";
import {
  reorgVariantsForRun,
  runAggregationChecks,
  runReorgChecks,
  type CheckRunResult,
} from "../../engine/checkEngine";
import { loadInstancesForCheck, latestInstancePerTemplate } from "../../engine/instanceIndex";
import { listOrganizations, listPeriods, loadWorkContext } from "../../packagesApi";
import type { AggregationTabProps } from "./AggregationTab";

type Opts = {
  backend: boolean;
  workZid: number | null;
  workEid: number | null;
  onStatus: (message: string) => void;
  onRefresh: () => Promise<void>;
};

/** Package aggregation UI state + handlers for Tools → Aggregation tab. */
export function useAggregationTab({
  backend,
  workZid,
  workEid,
  onStatus,
  onRefresh,
}: Opts): { busy: boolean; props: AggregationTabProps } {
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (!backend) return;
    void (async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const handleCreateCorrSet = async (kind: "correct" | "mirror") => {
    if (pkgParentZid === "" || pkgEid === "") {
      onStatus("Выберите сводную организацию и период");
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
    onStatus("");
    try {
      const result = await createCorrSet({
        parentZid: pkgParentZid,
        eid: pkgEid,
        kind,
      });
      await refreshCorrSets();
      setPkgTargetZid(result.set.corrZid);
      onStatus(
        `${kind === "mirror" ? "Зеркало" : "Корректирующий набор"} создан (ZID ${result.set.corrZid}): ` +
          `форм ${result.formsCreated + result.formsMirrored}` +
          (result.formsMirrored ? ` (зеркало: ${result.formsMirrored})` : "")
      );
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Ошибка создания набора");
    } finally {
      setBusy(false);
    }
  };

  const handleFillBalance = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      onStatus("Выберите сводную организацию и период");
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
        await onRefresh();
        onStatus(
          `Заполнение баланса: обновлено ${filled.updated} строк H` +
            (filled.skippedNonEmpty ? `, пропущено непустых ${filled.skippedNonEmpty}` : "") +
            ` · сверка: ${rel.mismatched}/${rel.compared} расхождений`
        );
      } else {
        onStatus(filled.message ?? "Не удалось заполнить баланс");
      }
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Ошибка заполнения баланса");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckRelations = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      onStatus("Выберите сводную организацию и период");
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
      onStatus(
        rel.message
          ? `RelCheck: ${rel.message}`
          : `RelCheck: ${rel.mismatched}/${rel.compared} расхождений (пропуск итогов ${rel.skipped})`
      );
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Ошибка CheckRelationsAccRows");
    } finally {
      setBusy(false);
    }
  };

  const handleAggPreview = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      onStatus("Выберите сводную организацию и период");
      return;
    }
    if (pkgSelectedChildren.length === 0) {
      onStatus("Отметьте хотя бы одного участника свода");
      return;
    }
    setBusy(true);
    onStatus("");
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
      onStatus(
        `Превью: будет сведено ${preview.willAggregate} форм, пропущено ${preview.willSkip}` +
          (preview.targetZid && preview.targetZid !== preview.parentZid
            ? ` → ZID ${preview.targetZid}`
            : "")
      );
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Ошибка превью свода");
    } finally {
      setBusy(false);
    }
  };

  const handlePackageAggregate = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      onStatus("Выберите сводную организацию и период");
      return;
    }
    if (pkgSelectedChildren.length === 0) {
      onStatus("Отметьте хотя бы одного участника свода");
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
    onStatus("");
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
      await onRefresh();
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
        const parentName = pkgParents.find((p) => p.zid === pkgParentZid)?.name ?? null;
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
      onStatus(
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
      onStatus(e instanceof Error ? e.message : "Ошибка агрегации комплекта");
    } finally {
      setBusy(false);
    }
  };

  const handleSyncAggWithWorkContext = () => {
    if (workZid == null) {
      onStatus("Сначала выберите организацию в комплекте");
      return;
    }
    void applyParentSelection(workZid, workEid ?? undefined);
    onStatus(`Свод синхронизирован с комплектом: орг. ${workZid}, период ${workEid ?? "—"}`);
  };

  const props: AggregationTabProps = {
    backend,
    busy,
    selection: {
      parentZid: pkgParentZid,
      eid: pkgEid,
      targetZid: pkgTargetZid,
      parents: pkgParents,
      periods: pkgPeriods,
      corrSets: pkgCorrSets,
      childEntries: pkgChildEntries,
      selectedChildren: pkgSelectedChildren,
    },
    options: {
      colorMode: pkgColorMode,
      requireAll: pkgRequireAll,
      recalc: pkgRecalc,
      reorg: pkgReorg,
      updateCorr: pkgUpdateCorr,
      fillBalanceMode,
      includeDraftSources: pkgIncludeDraftSources,
      overwriteSubmitted: pkgOverwriteSubmitted,
    },
    results: {
      preview: pkgPreview,
      aggrChecks: aggrCheckResult,
      reorgChecks: reorgCheckResult,
      accountRows: accountRowResult,
      relations: relationsResult,
      fillBalance: fillBalanceResult,
    },
    onParentChange: (zid) => void applyParentSelection(zid),
    onEidChange: setPkgEid,
    onTargetZidChange: setPkgTargetZid,
    onToggleChild: (childZid) => {
      setPkgPreview(null);
      setPkgSelectedChildren((prev) =>
        prev.includes(childZid) ? prev.filter((z) => z !== childZid) : [...prev, childZid]
      );
    },
    onSelectAllChildren: () => {
      setPkgSelectedChildren(pkgChildEntries.map((e) => e.childZid));
      setPkgPreview(null);
    },
    onSelectIncludedChildren: () => {
      setPkgSelectedChildren(pkgChildEntries.filter((e) => e.included).map((e) => e.childZid));
      setPkgPreview(null);
    },
    onClearChildren: () => {
      setPkgSelectedChildren([]);
      setPkgPreview(null);
    },
    onColorModeChange: (next) => {
      setPkgColorMode(next);
      if (next === "full") {
        setPkgReorg(false);
        setPkgUpdateCorr(false);
      }
      setPkgPreview(null);
    },
    onRequireAllChange: (value) => {
      setPkgRequireAll(value);
      setPkgPreview(null);
    },
    onRecalcChange: setPkgRecalc,
    onReorgChange: (value) => {
      setPkgReorg(value);
      setPkgPreview(null);
    },
    onUpdateCorrChange: (on) => {
      setPkgUpdateCorr(on);
      if (on) setPkgReorg(false);
      setPkgPreview(null);
    },
    onFillBalanceModeChange: setFillBalanceMode,
    onIncludeDraftSourcesChange: (value) => {
      setPkgIncludeDraftSources(value);
      setPkgPreview(null);
    },
    onOverwriteSubmittedChange: (value) => {
      setPkgOverwriteSubmitted(value);
      setPkgPreview(null);
    },
    onCreateCorrSet: (kind) => void handleCreateCorrSet(kind),
    onPreview: () => void handleAggPreview(),
    onAggregate: () => void handlePackageAggregate(),
    onCheckRelations: () => void handleCheckRelations(),
    onFillBalance: () => void handleFillBalance(),
    onClearPreview: () => setPkgPreview(null),
    workContext: { zid: workZid, eid: workEid },
    onSyncWithWorkContext: handleSyncAggWithWorkContext,
  };

  return { busy, props };
}
