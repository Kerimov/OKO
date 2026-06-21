import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadSchema } from "../api";
import { CheckResultsPanel } from "../components/CheckResultsPanel";
import { aggregateInstances } from "../engine/aggregateEngine";
import {
  getCheckRuleCounts,
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
import { recalcForm } from "../engine/recalcEngine";
import {
  applySaldoToTarget,
  transferSaldoByColumns,
  type SaldoPhase,
} from "../engine/saldoEngine";
import {
  listInstances,
  loadAllInstances,
  loadGlobalMeta,
  saveInstance,
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

  const [aggrTemplate, setAggrTemplate] = useState("");
  const [aggrSelected, setAggrSelected] = useState<string[]>([]);

  const [periodInstances, setPeriodInstances] = useState<OkoFormInstance[]>([]);

  const refresh = async () => setSummaries(await listInstances());

  useEffect(() => {
    refresh();
    getCheckRuleCounts().then(setRuleCounts);
  }, []);

  useEffect(() => {
    loadGlobalMeta().then((meta) => {
      getCompleteness(summaries, {
        start: meta.periodStart,
        end: meta.periodEnd,
      }).then(setCompleteness);
    });
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
    try {
      const result = await transferSaldoByColumns({ source, target, phase: saldoPhase });
      await saveInstance(applySaldoToTarget(target, result.rows));
      await refresh();
      setStatus(
        `Сальdo: ${result.rowsUpdated} строк, графы ${result.columnsCopied.join(", ")}`
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
        <code>z261.mdb</code>.
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
                    <Link to="/">{f.formId}</Link> — {f.title}
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
        <div className="tools-grid">
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
        </div>
        <button type="button" className="btn btn-secondary" onClick={handleSaldo}>
          Перенести сальdo
        </button>
      </section>

      <section className="tools-section">
        <h2>Агрегация</h2>
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
