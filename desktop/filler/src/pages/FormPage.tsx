import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckResultsPanel } from "@portal/components/CheckResultsPanel";
import { FormTable } from "@portal/components/FormTable";
import { isKontrForm } from "@portal/constants";
import { runFormChecks, type CheckRunResult } from "@portal/engine/checkEngine";
import { failedCellsForForm } from "@portal/engine/cellErrors";
import { exportFormToExcel } from "@portal/engine/exportExcel";
import {
  countRashRulesForForm,
  getRashData,
  validateKontrRash,
  type RashValidationIssue,
} from "@portal/engine/rashEngine";
import { recalcForm, countRecalcRules } from "@portal/engine/recalcEngine";
import {
  exportInstance,
  loadAllInstances,
  loadInstance,
  loadKontrAgents,
  saveGlobalMeta,
  saveInstance,
  setInstanceStatus,
} from "@portal/storage";
import { setDesktopActor } from "../desktopStorage";
import type {
  FormInstanceStatus,
  FormMeta,
  FormSchema,
  KontrAgent,
  OkoFormInstance,
  RowData,
} from "@portal/types";
import { buildInitialRows, formatPeriod, formStatusLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";

export function FormPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const { userName } = usePackage();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [instance, setInstance] = useState<OkoFormInstance | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [meta, setMeta] = useState<FormMeta>({
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  });
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [kontrAgents, setKontrAgents] = useState<KontrAgent[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportingExcel, setExportingExcel] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [rashIssues, setRashIssues] = useState<RashValidationIssue[] | null>(null);
  const [rashRuleCount, setRashRuleCount] = useState<number | null>(null);
  const [checkingRash, setCheckingRash] = useState(false);
  const [autoRecalc, setAutoRecalc] = useState(
    () => localStorage.getItem("oko-auto-recalc") !== "0"
  );
  const [recalcRuleCount, setRecalcRuleCount] = useState<number | null>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kontrMode = schema ? isKontrForm(schema.id) : false;
  const instanceStatus: FormInstanceStatus = instance?.status ?? "draft";
  const isLocked = instanceStatus === "submitted";

  useEffect(() => {
    setDesktopActor(userName);
  }, [userName]);

  useEffect(() => {
    if (!instanceId) return;
    setError("");
    setCheckResult(null);
    setRashIssues(null);
    void loadInstance(instanceId).then((inst) => {
      if (!inst) {
        setError("Форма не найдена");
        return;
      }
      setInstance(inst);
      setDisplayName(inst.displayName);
      setMeta(inst.meta);
      setRows(inst.rows);
      setSignatures(inst.signatures ?? {});

      void window.oko
        .loadSchema(inst.templateId)
        .then(setSchema)
        .catch((e: Error) => setError(e.message));
    });
  }, [instanceId]);

  useEffect(() => {
    if (!kontrMode || !schema) return;
    void loadKontrAgents()
      .then(setKontrAgents)
      .catch(() => setKontrAgents([]));
    void getRashData()
      .then((data) => setRashRuleCount(countRashRulesForForm(schema.id, data.rules)))
      .catch(() => setRashRuleCount(null));
  }, [kontrMode, schema]);

  useEffect(() => {
    if (!schema) return;
    void countRecalcRules(schema.id)
      .then(setRecalcRuleCount)
      .catch(() => setRecalcRuleCount(null));
  }, [schema]);

  const handleRowsChange = useCallback(
    (next: RowData[]) => {
      setRows(next);
      if (!autoRecalc || !schema || !(recalcRuleCount && recalcRuleCount > 0)) return;
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      recalcTimer.current = setTimeout(() => {
        void recalcForm(schema, next).then(setRows);
      }, 450);
    },
    [autoRecalc, schema, recalcRuleCount]
  );

  useEffect(() => {
    return () => {
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
    };
  }, []);

  const cellErrors = useMemo(() => {
    if (!schema) return undefined;
    return failedCellsForForm(schema.id, checkResult);
  }, [schema, checkResult]);

  const persist = useCallback(
    async (
      overrides?: Partial<Pick<OkoFormInstance, "displayName" | "rows" | "meta" | "signatures">>
    ) => {
      if (!instance || !schema) return null;
      const updated: OkoFormInstance = {
        ...instance,
        displayName: overrides?.displayName ?? displayName,
        meta: overrides?.meta ?? meta,
        rows: overrides?.rows ?? rows,
        signatures: overrides?.signatures ?? signatures,
        updatedAt: new Date().toISOString(),
      };
      const saved = await saveInstance(updated);
      await saveGlobalMeta(updated.meta);
      setInstance(saved);
      return saved;
    },
    [instance, schema, displayName, meta, rows, signatures]
  );

  const handleSave = useCallback(async () => {
    if (!instance || isLocked) return;
    await persist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, isLocked, persist]);

  const handleSubmitForm = async () => {
    if (!instance || instanceStatus === "submitted") return;
    if (
      !confirm(
        "Отметить форму готовой? После этого редактирование будет недоступно (координатор может вернуть в черновик)."
      )
    ) {
      return;
    }
    await persist();
    const updated = await setInstanceStatus(instance.instanceId, "submitted");
    setInstance(updated);
    setStatus("Форма отмечена готовой");
  };

  const handleReopenForm = async () => {
    if (!instance) return;
    if (!confirm("Вернуть форму в черновик?")) return;
    const updated = await setInstanceStatus(instance.instanceId, "draft");
    setInstance(updated);
    setStatus("Форма возвращена в черновик");
  };

  const handleReset = async () => {
    if (!schema || !instance) return;
    if (!confirm("Сбросить все введённые данные к шаблону?")) return;
    const fresh = buildInitialRows(schema);
    const sigs: Record<string, string> = {};
    for (const name of schema.signatures) sigs[name] = "";
    setRows(fresh);
    setSignatures(sigs);
    await persist({ rows: fresh, signatures: sigs });
    setCheckResult(null);
    setRashIssues(null);
    setStatus("Данные сброшены к шаблону");
  };

  const handleExport = () => {
    if (!instance) return;
    exportInstance({
      ...instance,
      displayName,
      meta,
      rows,
      signatures,
    });
  };

  const handleRecalc = async () => {
    if (!schema) return;
    setRecalcing(true);
    try {
      const next = await recalcForm(schema, rows);
      setRows(next);
      await persist({ rows: next });
      setStatus("Строки пересчитаны");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Ошибка пересчёта");
    } finally {
      setRecalcing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!schema || !instance) return;
    setExportingExcel(true);
    try {
      await persist();
      await exportFormToExcel({
        schema,
        displayName,
        meta,
        rows,
      });
      setStatus("Excel сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать Excel");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleCheckRash = async () => {
    if (!schema || !kontrMode) return;
    setCheckingRash(true);
    setRashIssues(null);
    try {
      const data = await getRashData();
      const numericColumns = schema.columns
        .filter((c) => c.type === "number")
        .map((c) => c.key);
      const issues = validateKontrRash(schema.id, rows, numericColumns, data);
      setRashIssues(issues);
      setStatus(
        issues.length === 0
          ? "Расшифровки: замечаний нет"
          : `Расшифровки: ${issues.filter((i) => i.severity === "error").length} ошибок, ${issues.filter((i) => i.severity === "warning").length} предупреждений`
      );
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось проверить расшифровки");
    } finally {
      setCheckingRash(false);
    }
  };

  const handleCheck = async () => {
    if (!schema || !instance) return;
    setChecking(true);
    setCheckResult(null);
    try {
      await persist();
      const all = await loadAllInstances();
      const result = await runFormChecks(schema.id, all);
      setCheckResult(result);
      setStatus(
        result.failed === 0 ? "Проверка пройдена" : `Ошибок увязок: ${result.failed}`
      );
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось выполнить проверку");
    } finally {
      setChecking(false);
    }
  };

  if (error && !schema) {
    return (
      <div className="content form-page">
        <p className="error">{error}</p>
        <Link to="/package">← К комплекту</Link>
      </div>
    );
  }

  if (!schema || !instance) {
    return <div className="content muted loading">Загрузка формы…</div>;
  }

  return (
    <div className="content form-page">
      <div className="form-toolbar">
        <div className="toolbar-breadcrumb">
          <Link to="/package" className="back-link">
            ← К комплекту
          </Link>
        </div>
        <div className="form-title-block form-title-block-wide">
          <label className="display-name-label">
            Название формы
            <input
              className="display-name-input"
              value={displayName}
              disabled={isLocked}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => void persist({ displayName })}
            />
          </label>
          <div className="form-subtitle">
            <span className="form-code">{schema.id}</span>
            <span>{schema.title}</span>
            <span className={`status-badge ${instanceStatus}`}>
              {formStatusLabel(instanceStatus)}
            </span>
          </div>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRecalc()}
            disabled={recalcing || isLocked}
            title={
              recalcRuleCount != null ? `Правил пересчёта: ${recalcRuleCount}` : undefined
            }
          >
            {recalcing ? "…" : "Пересчёт"}
          </button>
          {(recalcRuleCount ?? 0) > 0 && (
            <label className="auto-recalc-toggle" title="Пересчёт итоговых строк и граф">
              <input
                type="checkbox"
                checked={autoRecalc}
                disabled={isLocked}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAutoRecalc(on);
                  localStorage.setItem("oko-auto-recalc", on ? "1" : "0");
                }}
              />
              Автопересчёт
            </label>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExportExcel()}
            disabled={exportingExcel}
          >
            {exportingExcel ? "Excel…" : "Excel"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleCheck()}
            disabled={checking}
          >
            {checking ? "Проверка…" : "Проверить увязки"}
          </button>
          {kontrMode && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleCheckRash()}
              disabled={checkingRash}
              title={
                rashRuleCount != null
                  ? `Правил sp_rash для ${schema.id}: ${rashRuleCount}`
                  : undefined
              }
            >
              {checkingRash ? "Расшифровка…" : "Проверить расшифровки"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт JSON
          </button>
          {!isLocked && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleReset()}>
              Сбросить данные
            </button>
          )}
          {instanceStatus === "draft" && !isLocked && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSubmitForm()}
            >
              Отметить готовой
            </button>
          )}
          {instanceStatus === "submitted" && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReopenForm()}
            >
              Вернуть в черновик
            </button>
          )}
          {!isLocked && (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
              Сохранить
            </button>
          )}
        </div>
      </div>

      {status && <div className="status-bar">{status}</div>}
      {error && <p className="error">{error}</p>}
      {isLocked && (
        <div className="status-bar status-locked">
          Форма отмечена готовой и доступна только для просмотра. Координатор может вернуть её в
          черновик.
        </div>
      )}

      <CheckResultsPanel result={checkResult} loading={checking} />

      {kontrMode && rashRuleCount != null && rashRuleCount > 0 && (
        <p className="tools-hint">
          Форма с расшифровкой контрагентов: правил <code>sp_rash</code> —{" "}
          <strong>{rashRuleCount}</strong>. Пороги: 1 тыс. / 5 млн / 50 млн руб.
        </p>
      )}

      {rashIssues && rashIssues.length > 0 && (
        <section className="rash-results">
          <div className="rash-summary">
            <span className="rash-stat fail">
              Ошибок: {rashIssues.filter((i) => i.severity === "error").length}
            </span>
            <span className="rash-stat warn">
              Предупреждений: {rashIssues.filter((i) => i.severity === "warning").length}
            </span>
          </div>
          <ul className="rash-issues-list">
            {rashIssues.map((issue, idx) => (
              <li key={idx} className={issue.severity === "error" ? "rash-error" : "rash-warn"}>
                Строка {issue.rowIndex + 1} ({issue.rowLabel}), гр. {issue.column}: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="form-meta-panel">
        <div className="meta-grid">
          <label>
            Код предприятия
            <input
              value={meta.enterpriseCode}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
              onBlur={() => void persist({ meta })}
            />
          </label>
          <label className="meta-wide">
            Организация
            <input
              value={meta.organization}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
              onBlur={() => void persist({ meta })}
              placeholder="Наименование организации"
            />
          </label>
          <label>
            Начало периода
            <input
              type="date"
              value={meta.periodStart}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
              onBlur={() => void persist({ meta })}
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              value={meta.periodEnd}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
              onBlur={() => void persist({ meta })}
            />
          </label>
          <label>
            Ед. изм.
            <input
              value={meta.unit}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
              onBlur={() => void persist({ meta })}
            />
          </label>
        </div>
        <p className="period-hint">
          Отчётный период: {formatPeriod(meta.periodStart, meta.periodEnd)} · {meta.unit}
        </p>
      </section>

      <FormTable
        columns={schema.columns}
        rows={rows}
        onChange={handleRowsChange}
        allowAddRows={schema.allowAddRows || kontrMode}
        kontrMode={kontrMode}
        kontrAgents={kontrAgents}
        cellErrors={cellErrors}
        readOnly={isLocked}
      />

      {schema.signatures.length > 0 && (
        <section className="signatures">
          <h3>Подписи</h3>
          <div className="sig-grid">
            {schema.signatures.map((name) => (
              <label key={name}>
                {name}
                <input
                  value={signatures[name] ?? ""}
                  disabled={isLocked}
                  onChange={(e) => setSignatures((s) => ({ ...s, [name]: e.target.value }))}
                  onBlur={() => void persist({ signatures })}
                  placeholder="ФИО"
                />
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
