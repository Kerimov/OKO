import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadSchema } from "../api";
import { listAggEntries, runPackageAggregation } from "../aggregationApi";
import { CheckResultsPanel } from "../components/CheckResultsPanel";
import { aggregateInstances } from "../engine/aggregateEngine";
import {
  getCheckRuleCounts,
  runAggregationChecks,
  runAllChecks,
  type CheckMode,
  type CheckRunResult,
} from "../engine/checkEngine";
import { getCompleteness, type CompletenessItem } from "../engine/completeness";
import { exportPackageToExcel } from "../engine/exportExcel";
import {
  downloadReportPackage,
  filterInstancesByPeriod,
} from "../engine/packageExport";
import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import { recalcForm } from "../engine/recalcEngine";
import {
  applySaldoToTarget,
  countSaldoRulesForForm,
  transferSaldoByColumns,
  transferSaldoDetailed,
  type SaldoPhase,
  type SaldoTransferMode,
} from "../engine/saldoEngine";
import {
  listInstances,
  loadAllInstances,
  loadGlobalMeta,
  saveInstance,
  isBackendMode,
} from "../storage";
import type { InstanceSummary, OkoFormInstance } from "../types";

export function ToolsPage() {
  const navigate = useNavigate();
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

  const [aggrTemplate, setAggrTemplate] = useState("");
  const [aggrSelected, setAggrSelected] = useState<string[]>([]);

  const [pkgParentZid, setPkgParentZid] = useState<number | "">("");
  const [pkgEid, setPkgEid] = useState<number | "">("");
  const [pkgChildren, setPkgChildren] = useState<number[]>([]);
  const [pkgPeriods, setPkgPeriods] = useState<Array<{ eid: number; name: string }>>([]);
  const [pkgParents, setPkgParents] = useState<number[]>([]);
  const [aggrCheckResult, setAggrCheckResult] = useState<CheckRunResult | null>(null);

  const [periodInstances, setPeriodInstances] = useState<OkoFormInstance[]>([]);
  const backend = isBackendMode();

  useEffect(() => {
    if (saldoMode !== "detailed" || !saldoTarget) {
      setSaldoRuleCount(null);
      return;
    }
    const templateId = summaries.find((s) => s.instanceId === saldoTarget)?.templateId;
    if (!templateId) return;
    countSaldoRulesForForm(templateId, saldoDetailedType).then(setSaldoRuleCount);
  }, [saldoMode, saldoTarget, saldoDetailedType, summaries]);

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
      const meta = await loadGlobalMeta();
      const all = await loadAllInstances();
      setPeriodInstances(
        filterInstancesByPeriod(all, meta.periodStart, meta.periodEnd)
      );
    })();
  }, [summaries]);

  const byTemplate = useMemo(() => {
    const map = new Map<string, InstanceSummary[]>();
    for (const s of summaries) {
      const list = map.get(s.templateId) ?? [];
      list.push(s);
      map.set(s.templateId, list);
    }
    return map;
  }, [summaries]);

  const templates = useMemo(
    () => Array.from(byTemplate.keys()).sort(),
    [byTemplate]
  );

  const aggParentZids = pkgParents;

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
        setPkgParents(parentIds);
        const initialParent = ctx.zid && parentIds.includes(ctx.zid) ? ctx.zid : parentIds[0];
        if (initialParent != null) {
          setPkgParentZid(initialParent);
          const children = entries
            .filter((e) => e.parentZid === initialParent && e.included)
            .map((e) => e.childZid);
          setPkgChildren(children);
          const periods = await listPeriods(initialParent);
          setPkgPeriods(periods.map((p) => ({ eid: p.eid, name: p.name })));
          const initialEid =
            ctx.eid && periods.some((p) => p.eid === ctx.eid) ? ctx.eid : periods[0]?.eid;
          if (initialEid != null) setPkgEid(initialEid);
        } else if (orgs[0]) {
          setPkgParentZid(orgs[0].zid);
        }
      } catch {
        /* optional */
      }
    })();
  }, [backend]);

  const handlePkgParentChange = async (zid: number) => {
    setPkgParentZid(zid);
    setPkgEid("");
    try {
      const entries = await listAggEntries(zid);
      setPkgChildren(entries.filter((e) => e.included).map((e) => e.childZid));
      const periods = await listPeriods(zid);
      setPkgPeriods(periods.map((p) => ({ eid: p.eid, name: p.name })));
      if (periods[0]) setPkgEid(periods[0].eid);
      else setPkgEid("");
    } catch {
      setPkgChildren([]);
    }
  };

  const handlePackageAggregate = async () => {
    if (pkgParentZid === "" || pkgEid === "") {
      setStatus("Выберите сводную организацию и период");
      return;
    }
    setBusy(true);
    setStatus("");
    setAggrCheckResult(null);
    try {
      const result = await runPackageAggregation(pkgParentZid, pkgEid);
      await refresh();
      const checks = await runAggregationChecks();
      setAggrCheckResult(checks);
      setStatus(
        `Свод завершён: ${result.aggregated} форм, пропущено ${result.skipped}` +
          (result.missing.length ? `, нет данных: ${result.missing.length}` : "") +
          ` · увязки агрегации: ${checks.passed}/${checks.total} OK`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка агрегации комплекта");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckAll = async () => {
    setChecking(true);
    setStatus("");
    try {
      const meta = await loadGlobalMeta();
      const result = await runAllChecks(
        { start: meta.periodStart, end: meta.periodEnd },
        checkMode
      );
      setCheckResult(result);
      setStatus(
        result.failed === 0
          ? `Проверки пройдены (${result.total} правил)`
          : `Ошибок: ${result.failed} из ${result.total}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка проверки");
    } finally {
      setChecking(false);
    }
  };

  const handleRecalcAll = async () => {
    setBusy(true);
    try {
      let count = 0;
      for (const inst of periodInstances) {
        const schema = await loadSchema(inst.templateId);
        const rows = await recalcForm(schema, inst.rows);
        await saveInstance({ ...inst, rows });
        count++;
      }
      await refresh();
      setStatus(`Пересчитано форм: ${count}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка пересчёта");
    } finally {
      setBusy(false);
    }
  };

  const handlePackageJson = () => {
    if (periodInstances.length === 0) {
      setStatus("Нет форм за текущий период");
      return;
    }
    downloadReportPackage(periodInstances);
    setStatus(`Экспорт JSON: ${periodInstances.length} форм`);
  };

  const handlePackageExcel = async () => {
    if (periodInstances.length === 0) {
      setStatus("Нет форм за текущий период");
      return;
    }
    setBusy(true);
    try {
      const schemas = new Map(
        await Promise.all(
          [...new Set(periodInstances.map((i) => i.templateId))].map(
            async (id) => [id, await loadSchema(id)] as const
          )
        )
      );
      await exportPackageToExcel(periodInstances, schemas);
      setStatus(`Excel сохранён (${periodInstances.length} форм)`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка Excel");
    } finally {
      setBusy(false);
    }
  };

  const handleSaldo = async () => {
    const all = await loadAllInstances();
    const source = all.find((i) => i.instanceId === saldoSource);
    const target = all.find((i) => i.instanceId === saldoTarget);
    if (!source || !target) {
      setStatus("Выберите исходную и целевую формы");
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
        const result = await transferSaldoDetailed(source, target, saldoDetailedType);
        if (result.applied === 0) {
          setStatus(
            `Правила a_tblsaldo (${saldoDetailedType.toUpperCase()}): нет применимых ячеек для ${target.templateId}`
          );
          return;
        }
        await saveInstance(applySaldoToTarget(target, result.rows));
        await refresh();
        setStatus(
          `Сальdo (a_tblsaldo, ${saldoDetailedType.toUpperCase()}): применено ${result.applied} ячеек`
        );
        return;
      }
      const result = await transferSaldoByColumns({ source, target, phase: saldoPhase });
      await saveInstance(applySaldoToTarget(target, result.rows));
      await refresh();
      setStatus(
        `Сальdo (FormCorrespondence): ${result.rowsUpdated} строк, графы ${result.columnsCopied.join(", ")}`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка переноса сальdo");
    }
  };

  const handleAggregate = async () => {
    if (!aggrTemplate) {
      setStatus("Выберите шаблон формы");
      return;
    }
    if (aggrSelected.length < 2) {
      setStatus("Отметьте минимум 2 формы одного шаблона для агрегации");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const all = await loadAllInstances();
      const sources = all.filter((i) => aggrSelected.includes(i.instanceId));
      const { instance } = aggregateInstances({
        templateId: aggrTemplate,
        sources,
      });
      await saveInstance(instance);
      await refresh();
      setStatus(`Создана агрегированная форма: ${instance.displayName}`);
      navigate(`/my/${instance.instanceId}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка агрегации");
    } finally {
      setBusy(false);
    }
  };

  const aggrReady = !!aggrTemplate && aggrSelected.length >= 2;

  const missingForms = completeness?.items.filter((i) => !i.filled) ?? [];

  return (
    <div className="tools-page">
      <h1>Администрирование</h1>
      <p className="tools-intro">
        Проверка, пересчёт, сальdo, агрегация и выгрузка комплекта — по правилам{" "}
        <code>z261.mdb</code>. Комплект ZID/EID:{" "}
        <Link to="/package">завести пустые формы</Link>. Редактирование:{" "}
        <Link to="/admin/forms">Конструктор форм</Link>,{" "}
        <Link to="/admin/checks">Редактор увязок</Link>,{" "}
        <Link to="/admin/saldo">Сальдо</Link>,{" "}
        <Link to="/admin/excel">Excel-маппинг</Link>,{" "}
        <Link to="/admin/rash">Расшифровки</Link>,{" "}
        <Link to="/admin/aggregation">Агрегация</Link>.
      </p>
      {status && <div className="status-bar">{status}</div>}

      {completeness && (
        <section className="tools-section">
          <h2>
            Полнота комплекта{" "}
            <span className="cat-count">
              {completeness.filled}/{completeness.total}
            </span>
          </h2>
          <div className="completeness-bar">
            <div
              className="completeness-fill"
              style={{
                width: `${(completeness.filled / completeness.total) * 100}%`,
              }}
            />
          </div>
          {missingForms.length > 0 && (
            <details className="missing-forms">
              <summary>Не заполнено ({missingForms.length})</summary>
              <ul>
                {missingForms.map((f) => (
                  <li key={f.formId}>
                    <Link to="/catalog">{f.formId}</Link> — {f.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className="tools-section">
        <h2>Сохранить комплект на диск</h2>
        <p>Экспорт всех форм текущего периода (аналог «Сохранить на диск» в ОКО).</p>
        <div className="toolbar-actions" style={{ marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePackageJson}
            disabled={periodInstances.length === 0}
          >
            JSON ({periodInstances.length})
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePackageExcel}
            disabled={busy || periodInstances.length === 0}
          >
            Excel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRecalcAll}
            disabled={busy || periodInstances.length === 0}
          >
            Пересчитать все
          </button>
        </div>
      </section>

      <section className="tools-section">
        <h2>Проверка форм</h2>
        <div className="tools-grid">
          <label>
            Режим
            <select
              value={checkMode}
              onChange={(e) => setCheckMode(e.target.value as CheckMode)}
            >
              <option value="period">
                Период (pg_aktiv, {ruleCounts?.period ?? "…"})
              </option>
              <option value="active">
                Активные (aktiv, {ruleCounts?.active ?? "…"})
              </option>
              <option value="all">
                Все правила ({ruleCounts?.all ?? "…"}, без агрегации
                {ruleCounts ? ` −${ruleCounts.aggrExcluded}` : ""})
              </option>
            </select>
          </label>
        </div>
        {ruleCounts && (
          <p className="tools-hint">
            Исключено правил только для агрегации: {ruleCounts.aggrExcluded}. В
            файле MDB всего 3600 записей.
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCheckAll}
          disabled={checking || summaries.length === 0}
        >
          {checking ? "Проверка…" : "Проверить все формы"}
        </button>
        <CheckResultsPanel result={checkResult} loading={checking} />
      </section>

      <section className="tools-section">
        <h2>Перенос сальdo</h2>
        <p className="tools-hint">
          Как в ОКО: этап 1 — по колонкам FormCorrespondence (Yellow/Red); этап 2 — по
          правилам <code>a_tblsaldo</code> (T/S/G). Исходная и целевая формы — один шаблон.
        </p>
        <div className="tools-grid">
          <label>
            Способ
            <select
              value={saldoMode}
              onChange={(e) => setSaldoMode(e.target.value as SaldoTransferMode)}
            >
              <option value="columns">FormCorrespondence (Yellow / Red)</option>
              <option value="detailed">Правила a_tblsaldo (T / S / G)</option>
            </select>
          </label>
          <label>
            Исходная форма
            <select value={saldoSource} onChange={(e) => setSaldoSource(e.target.value)}>
              <option value="">— выберите —</option>
              {summaries.map((s) => (
                <option key={s.instanceId} value={s.instanceId}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Целевая форма
            <select value={saldoTarget} onChange={(e) => setSaldoTarget(e.target.value)}>
              <option value="">— выберите —</option>
              {summaries.map((s) => (
                <option key={s.instanceId} value={s.instanceId}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          {saldoMode === "columns" ? (
            <label>
              Этап
              <select
                value={saldoPhase}
                onChange={(e) => setSaldoPhase(e.target.value as SaldoPhase)}
              >
                <option value="previous_period">Предыдущий период (Yellow)</option>
                <option value="analog_period">Аналог. период прошлого года (Red)</option>
              </select>
            </label>
          ) : (
            <label>
              Тип (a_tblsaldo)
              <select
                value={saldoDetailedType}
                onChange={(e) => setSaldoDetailedType(e.target.value as "t" | "s" | "g")}
              >
                <option value="t">T — текущий период</option>
                <option value="s">S — сальдо / входящие</option>
                <option value="g">G — год / аналог</option>
              </select>
            </label>
          )}
        </div>
        {saldoMode === "detailed" && saldoTarget && saldoRuleCount !== null && (
          <p className="tools-hint">
            Правил для{" "}
            {summaries.find((s) => s.instanceId === saldoTarget)?.templateId}:{" "}
            <strong>{saldoRuleCount}</strong> (тип {saldoDetailedType.toUpperCase()})
          </p>
        )}
        <button type="button" className="btn btn-secondary" onClick={handleSaldo}>
          Перенести сальdo
        </button>
      </section>

      <section className="tools-section">
        <h2>Агрегация комплекта (a_tblAgg_List)</h2>
        <p className="tools-hint">
          Суммирование форм дочерних организаций в сводную по правилам{" "}
          <Link to="/admin/aggregation">конфигурации агрегации</Link>. Требуются заполненные
          комплекты участников за тот же период (EID).
        </p>
        {backend ? (
          <>
            <div className="tools-grid">
              <label>
                Сводная организация
                <select
                  value={pkgParentZid}
                  onChange={(e) => void handlePkgParentChange(Number(e.target.value))}
                >
                  <option value="">— выберите —</option>
                  {aggParentZids.map((z) => (
                    <option key={z} value={z}>
                      ZID={z}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Период (EID)
                <select
                  value={pkgEid}
                  disabled={pkgParentZid === ""}
                  onChange={(e) => setPkgEid(Number(e.target.value))}
                >
                  <option value="">— выберите —</option>
                  {pkgPeriods.map((p) => (
                    <option key={p.eid} value={p.eid}>
                      {p.name} (EID={p.eid})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {pkgParentZid !== "" && pkgChildren.length > 0 && (
              <p className="tools-hint">
                Участники свода ({pkgChildren.length}): zid {pkgChildren.join(", ")}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || pkgParentZid === "" || pkgEid === "" || pkgChildren.length === 0}
              onClick={() => void handlePackageAggregate()}
            >
              {busy ? "Свод…" : "Свести комплект"}
            </button>
            {aggrCheckResult && aggrCheckResult.failed > 0 && (
              <CheckResultsPanel result={aggrCheckResult} />
            )}
          </>
        ) : (
          <p className="tools-hint">Требуется API-сервер (SQLite).</p>
        )}
      </section>

      <section className="tools-section">
        <h2>Агрегация вручную (один шаблон)</h2>
        <p className="tools-hint">
          Суммирование числовых граф по строкам (как в ОКО при объединении форм филиалов).
          Нужны <strong>минимум 2 сохранённые формы одного шаблона</strong>.
        </p>
        <label>
          Шаблон
          <select
            value={aggrTemplate}
            onChange={(e) => {
              setAggrTemplate(e.target.value);
              setAggrSelected([]);
            }}
          >
            <option value="">— выберите —</option>
            {templates.map((t) => (
              <option key={t} value={t}>
                {t} ({byTemplate.get(t)?.length ?? 0})
              </option>
            ))}
          </select>
        </label>
        {aggrTemplate && (
          <ul className="aggr-list">
            {(byTemplate.get(aggrTemplate) ?? []).map((s) => (
              <li key={s.instanceId}>
                <label>
                  <input
                    type="checkbox"
                    checked={aggrSelected.includes(s.instanceId)}
                    onChange={() =>
                      setAggrSelected((p) =>
                        p.includes(s.instanceId)
                          ? p.filter((x) => x !== s.instanceId)
                          : [...p, s.instanceId]
                      )
                    }
                  />
                  {s.displayName}
                </label>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleAggregate()}
          disabled={busy}
          title={
            aggrReady
              ? "Суммировать выбранные формы"
              : "Выберите шаблон и отметьте 2+ формы"
          }
        >
          {busy ? "Агрегация…" : "Создать агрегированную форму"}
          {!aggrReady && aggrTemplate && (
            <span className="btn-hint"> ({aggrSelected.length}/2)</span>
          )}
        </button>
      </section>
    </div>
  );
}
