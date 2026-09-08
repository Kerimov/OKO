import { useEffect, useState } from "react";
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
} from "../../engine/saldoEngine";
import { loadAllInstances, saveInstance } from "../../storage";
import type { InstanceSummary, OkoFormInstance } from "../../types";
import type { SaldoTabProps } from "./SaldoTab";

type Opts = {
  summaries: InstanceSummary[];
  workZid: number | null;
  workEid: number | null;
  periodInstances: OkoFormInstance[];
  onStatus: (message: string) => void;
  onRefresh: () => Promise<void>;
};

/** Saldo transfer UI state + handlers for Tools → Saldo tab. */
export function useSaldoTab({
  summaries,
  workZid,
  workEid,
  periodInstances,
  onStatus,
  onRefresh,
}: Opts): SaldoTabProps {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [phase, setPhase] = useState<SaldoPhase>("previous_period");
  const [mode, setMode] = useState<SaldoTransferMode>("columns");
  const [detailedType, setDetailedType] = useState<"t" | "s" | "g">("t");
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [compare, setCompare] = useState<SaldoCompareResult | null>(null);

  useEffect(() => {
    if (mode !== "detailed" || !targetId) {
      setRuleCount(null);
      return;
    }
    const templateId = summaries.find(
      (s) =>
        s.instanceId === targetId &&
        (workZid == null || s.zid === workZid) &&
        (workEid == null || s.eid === workEid)
    )?.templateId;
    if (!templateId) return;
    void countSaldoRulesForForm(templateId, detailedType).then(setRuleCount);
  }, [mode, targetId, detailedType, summaries, workZid, workEid]);

  const onTransfer = async () => {
    if (workZid == null || workEid == null) {
      onStatus("Сначала выберите организацию и период в комплекте");
      return;
    }
    const scoped =
      periodInstances.length > 0
        ? periodInstances
        : (await loadAllInstances()).filter((i) => i.zid === workZid && i.eid === workEid);
    const source = scoped.find((i) => i.instanceId === sourceId);
    const target = scoped.find((i) => i.instanceId === targetId);
    if (!source || !target) {
      onStatus("Выберите исходную и целевую формы рабочего комплекта");
      return;
    }
    if (source.templateId !== target.templateId) {
      onStatus(`Шаблоны должны совпадать: ${source.templateId} ≠ ${target.templateId}`);
      return;
    }
    try {
      if (mode === "detailed") {
        if (dryRun) {
          const cmp = await compareSaldoDetailed(source, target, detailedType, scoped);
          setCompare(cmp);
          onStatus(
            cmp.diffs.length === 0
              ? `Сверка сальдо (детальные ${detailedType.toUpperCase()}): расхождений нет`
              : `Сверка сальдо (детальные): ${cmp.diffs.length} ячеек в ${cmp.wouldUpdateRows} строках (данные не изменены)`
          );
          return;
        }
        const result = await transferSaldoDetailed(source, target, detailedType, scoped);
        if (result.applied === 0) {
          onStatus(
            `Правила сальдо (${detailedType.toUpperCase()}): нет применимых ячеек для ${target.templateId}`
          );
          return;
        }
        await saveInstance(applySaldoToTarget(target, result.rows));
        await onRefresh();
        setCompare(null);
        onStatus(
          `Сальдо (детальные правила, ${detailedType.toUpperCase()}): применено ${result.applied} ячеек` +
            (result.warning ? ` · ${result.warning}` : "")
        );
        return;
      }
      if (dryRun) {
        const cmp = await compareSaldoByColumns({ source, target, phase });
        setCompare(cmp);
        onStatus(
          cmp.diffs.length === 0
            ? `Сверка сальдо: расхождений нет (графы ${cmp.columns.join(", ") || "—"})`
            : `Сверка сальдо: ${cmp.diffs.length} ячеек в ${cmp.wouldUpdateRows} строках отличаются (данные не изменены)`
        );
        return;
      }
      const result = await transferSaldoByColumns({ source, target, phase });
      await saveInstance(applySaldoToTarget(target, result.rows));
      await onRefresh();
      setCompare(null);
      onStatus(
        `Сальдо (соответствие форм): ${result.rowsUpdated} строк, графы ${result.columnsCopied.join(", ")}` +
          (result.warning ? ` · ${result.warning}` : "")
      );
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Ошибка переноса сальдо");
    }
  };

  return {
    summaries,
    sourceId,
    onSourceChange: setSourceId,
    targetId,
    onTargetChange: setTargetId,
    mode,
    onModeChange: setMode,
    phase,
    onPhaseChange: setPhase,
    detailedType,
    onDetailedTypeChange: setDetailedType,
    ruleCount,
    dryRun,
    onDryRunChange: setDryRun,
    compare,
    onClearCompare: () => setCompare(null),
    onTransfer: () => void onTransfer(),
  };
}
