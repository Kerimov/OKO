import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { loadSchema } from "../api";
import {
  getCheckRuleCounts,
  runAllChecks,
  type CheckMode,
  type CheckRunResult,
} from "../engine/checkEngine";
import { getCompleteness, type CompletenessItem } from "../engine/completeness";
import { loadWorkPackageInstances } from "../engine/workPackageInstances";
import {
  loadWorkContext,
  listOrganizations,
} from "../packagesApi";
import { prepareRecalcPackage, type RecalcPackageItem } from "../engine/recalcEngine";
import {
  listInstances,
  loadGlobalMeta,
  saveInstancesAtomic,
  isBackendMode,
} from "../storage";
import type { InstanceSummary, OkoFormInstance } from "../types";
import { useAuth } from "../useAuth";
import { AdvancedTab } from "./tools/AdvancedTab";
import { AggregationTab } from "./tools/AggregationTab";
import { ExchangeTab } from "./tools/ExchangeTab";
import { OverviewTab } from "./tools/OverviewTab";
import { QualityTab } from "./tools/QualityTab";
import { ReferencesTab } from "./tools/ReferencesTab";
import { useReferencesTab } from "./tools/useReferencesTab";
import { SaldoTab } from "./tools/SaldoTab";
import { useSaldoTab } from "./tools/useSaldoTab";
import { useAggregationTab } from "./tools/useAggregationTab";
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



  const [periodInstances, setPeriodInstances] = useState<OkoFormInstance[]>([]);
  const [workZid, setWorkZid] = useState<number | null>(null);
  const [workEid, setWorkEid] = useState<number | null>(null);
  const [recalcReport, setRecalcReport] = useState<RecalcPackageItem[] | null>(null);
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


  const refresh = async () => setSummaries(await listInstances());

  useEffect(() => {
    refresh();
    getCheckRuleCounts().then(setRuleCounts);
  }, []);


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


  const scopedSummaries = useMemo(() => {
    if (workZid == null || workEid == null) return [];
    return summaries.filter((s) => s.zid === workZid && s.eid === workEid);
  }, [summaries, workZid, workEid]);

  const saldoTab = useSaldoTab({
    summaries: scopedSummaries,
    workZid,
    workEid,
    periodInstances,
    onStatus: setStatus,
    onRefresh: refresh,
  });

  const aggregation = useAggregationTab({
    backend,
    workZid,
    workEid,
    onStatus: setStatus,
    onRefresh: refresh,
  });

  const referencesTab = useReferencesTab({
    backend,
    busy,
    setBusy,
    onStatus: setStatus,
  });


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
          onStatus={setStatus}
          onImported={() => void refresh()}
          workZid={workZid}
          workEid={workEid}
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

      {activeTab === "saldo" && <SaldoTab {...saldoTab} />}

      {activeTab === "aggregation" && <AggregationTab {...aggregation.props} />}

      {activeTab === "references" && <ReferencesTab {...referencesTab} />}

      {activeTab === "advanced" && <AdvancedTab onNavigateTab={setActiveTab} />}
    </div>
  );
}
