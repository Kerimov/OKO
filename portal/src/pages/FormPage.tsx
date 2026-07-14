import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../apiClient";
import { loadSchema } from "../api";
import { CheckResultsPanel } from "../components/CheckResultsPanel";
import { FormTable } from "../components/FormTable";
import { RashEditorModal } from "../components/RashEditorModal";
import { hasRashRules, isKontrForm } from "../constants";
import { runFormChecks, type CheckRunResult } from "../engine/checkEngine";
import { failedCellsForForm } from "../engine/cellErrors";
import { exportFormToExcel } from "../engine/exportExcel";
import {
  buildRashCellSlots,
  countRashRulesForForm,
  entriesForRash,
  effectiveRashFormula,
  evaluateTotalFormula,
  getRashData,
  getRashRulesForForm,
  numVal,
  rashColumnsForRule,
  rashSlotKey,
  syncAllRashToRows,
  syncRashToParentRow,
  validateAllRash,
  type RashCellSlot,
  type RashEditorContext,
  type RashValidationIssue,
} from "../engine/rashEngine";
import { loadRowRashIndex, type RowRashIndexData } from "../engine/rowRashIndex";
import { loadRashRefs, type RashRefsData } from "../engine/rashRefs";
import { recalcForm, countRecalcRules } from "../engine/recalcEngine";
import {
  deleteInstance,
  exportInstance,
  importInstanceFile,
  loadAllInstances,
  loadInstance,
  loadKontrAgents,
  loadRashEntries,
  saveInstance,
  saveRashEntries,
  setInstanceStatus,
  runInstanceChecks,
} from "../storage";
import type {
  FormInstanceStatus,
  FormMeta,
  FormRashEntry,
  FormSchema,
  KontrAgent,
  OkoFormInstance,
  RashRulesData,
  RowData,
} from "../types";
import { buildInitialRows, formatPeriod, formStatusLabel } from "../utils";
import { useAuth } from "../useAuth";
import { formsListBackLabel } from "../formsListLabels";

export function FormPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [rashIssues, setRashIssues] = useState<RashValidationIssue[] | null>(null);
  const [rashRuleCount, setRashRuleCount] = useState<number | null>(null);
  const [rashData, setRashData] = useState<RashRulesData | null>(null);
  const [rowRashIndex, setRowRashIndex] = useState<RowRashIndexData | null>(null);
  const [rashRefs, setRashRefs] = useState<RashRefsData | null>(null);
  const [rashEntries, setRashEntries] = useState<FormRashEntry[]>([]);
  const [rashModal, setRashModal] = useState<RashEditorContext | null>(null);
  const [checkingRash, setCheckingRash] = useState(false);
  const [autoRecalc, setAutoRecalc] = useState(
    () => localStorage.getItem("oko-auto-recalc") !== "0"
  );
  const [recalcRuleCount, setRecalcRuleCount] = useState<number | null>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kontrMode = schema ? isKontrForm(schema.id) : false;
  const rashMode = hasRashRules(rashRuleCount ?? 0);
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const formsBackLabel = formsListBackLabel(auth);
  const instanceStatus: FormInstanceStatus = instance?.status ?? "draft";
  const isLocked = instanceStatus === "submitted" && !admin;

  useEffect(() => {
    if (!instanceId) return;
    setError("");
    loadInstance(instanceId).then((inst) => {
      if (!inst) {
        setError("Форма не найдена. Возможно, она была удалена.");
        return;
      }
      setInstance(inst);
      setDisplayName(inst.displayName);
      setMeta(inst.meta);
      setRows(inst.rows);
      setSignatures(inst.signatures ?? {});

      loadSchema(inst.templateId)
        .then(setSchema)
        .catch((e) => setError(e.message));

      void loadRashEntries(inst.instanceId, inst.templateId)
        .then((loaded) => {
          setRashEntries(loaded);
        })
        .catch(() => setRashEntries(inst.rashEntries ?? []));
    });
  }, [instanceId]);

  useEffect(() => {
    if (!schema) return;
    getRashData()
      .then((data) => {
        setRashData(data);
        setRashRuleCount(countRashRulesForForm(schema.id, data.rules));
      })
      .catch(() => {
        setRashData(null);
        setRashRuleCount(null);
      });
    loadRowRashIndex()
      .then(setRowRashIndex)
      .catch(() => setRowRashIndex(null));
    loadRashRefs()
      .then(setRashRefs)
      .catch(() => setRashRefs(null));
  }, [schema]);

  useEffect(() => {
    if (!rashMode || !schema) return;
    loadKontrAgents().then(setKontrAgents).catch(() => setKontrAgents([]));
  }, [rashMode, schema]);

  useEffect(() => {
    if (!schema) return;
    countRecalcRules(schema.id)
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
        rashEntries,
        updatedAt: new Date().toISOString(),
      };
      await saveInstance(updated);
      setInstance(updated);
      return updated;
    },
    [instance, schema, displayName, meta, rows, signatures, rashEntries]
  );

  useEffect(() => {
    if (!schema || !rashData || kontrMode || rashEntries.length === 0) return;
    setRows((prev) => syncAllRashToRows(schema.id, prev, rashEntries, rashData.rules));
  }, [schema?.id, rashData, kontrMode, rashEntries]);

  const kontrRefA1Name = useMemo(() => {
    if (!schema || !rashData) return null;
    const rules = getRashRulesForForm(rashData.rules, schema.id);
    return rules.find((r) => r.refA1Name)?.refA1Name ?? null;
  }, [schema, rashData]);

  const rashSlots = useMemo(() => {
    if (!schema || !rashData || kontrMode) return [];
    return buildRashCellSlots(
      schema.id,
      rows,
      schema.columns,
      rashData.rules,
      rashData.thresholds,
      rowRashIndex ?? undefined
    );
  }, [schema, rows, rashData, rowRashIndex, kontrMode]);

  const rashEntryCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!schema) return map;
    for (const e of rashEntries) {
      if (e.formId !== schema.id) continue;
      const col = e.columnKey ?? "";
      const key = rashSlotKey(String(e.parentRowNo), col, e.rashKod);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rashEntries, schema]);

  const rashReadonlyCells = useMemo(() => {
    const set = new Set<string>();
    if (kontrMode) return set;
    for (const slot of rashSlots) {
      const cols = effectiveRashFormula(slot.rule)
        ? rashColumnsForRule(slot.rule)
        : [slot.columnKey];
      for (const col of cols) {
        set.add(`${slot.rowNum}:${col}`);
      }
    }
    return set;
  }, [rashSlots, kontrMode]);

  const openRashModal = useCallback(
    (slot: RashCellSlot, rowIndex: number) => {
      if (!schema || isLocked) return;
      const row = rows[rowIndex];
      setRashModal({
        formId: schema.id,
        parentRowNo: parseInt(slot.rowNum, 10),
        parentRowIndex: rowIndex,
        columnKey: slot.columnKey,
        rashKod: slot.rashKod,
        rule: slot.rule,
        parentLabel: String(row.name ?? slot.rowNum),
        parentValue:
          slot.pattern === "total" && effectiveRashFormula(slot.rule)
            ? evaluateTotalFormula(effectiveRashFormula(slot.rule)!, row)
            : numVal(row[slot.columnKey]),
      });
    },
    [schema, rows, isLocked]
  );

  const handleRashSave = useCallback(
    async (newLines: FormRashEntry[]) => {
      if (!rashModal || !schema || !instance) return;
      const { formId, parentRowNo, rashKod, columnKey, parentRowIndex } = rashModal;
      const rest = rashEntries.filter(
        (e) =>
          !(
            e.formId === formId &&
            e.parentRowNo === parentRowNo &&
            e.rashKod === rashKod &&
            (e.columnKey == null || e.columnKey === columnKey)
          )
      );
      const tagged = newLines.map((e, i) => ({
        ...e,
        formId,
        parentRowNo,
        rashKod,
        columnKey,
        lineNo: i,
      }));
      const nextEntries = [...rest, ...tagged];
      setRashEntries(nextEntries);
      await saveRashEntries(instance.instanceId, schema.id, nextEntries);

      let nextRows = rows;
      if (!kontrMode) {
        nextRows = syncRashToParentRow(
          rows,
          parentRowIndex,
          nextEntries,
          formId,
          rashKod,
          rashModal.rule
        );
        setRows(nextRows);
        await persist({ rows: nextRows });
      } else {
        await persist();
      }
      setRashModal(null);
      setStatus("Расшифровка сохранена");
      setTimeout(() => setStatus(""), 3000);
    },
    [rashModal, schema, instance, rashEntries, rows, kontrMode, persist]
  );

  const rashModalEntries = useMemo(() => {
    if (!rashModal || !schema) return [];
    return entriesForRash(
      rashEntries,
      schema.id,
      rashModal.parentRowNo,
      rashModal.rashKod,
      rashModal.columnKey
    );
  }, [rashEntries, rashModal, schema]);

  const handleSave = useCallback(async () => {
    if (!instance || isLocked) return;
    await persist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, isLocked, persist]);

  const handleSubmitForm = async () => {
    if (!instance || instanceStatus === "submitted") return;
    if (!confirm("Сдать форму? После сдачи редактирование будет недоступно (только администратор сможет вернуть в черновик).")) {
      return;
    }
    await persist();
    try {
      const updated = await setInstanceStatus(instance.instanceId, "submitted");
      setInstance(updated);
      setStatus("Форма сдана");
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as {
          error?: string;
          result?: CheckRunResult;
          message?: { error?: string; result?: CheckRunResult };
        };
        const result = body?.result ?? body?.message?.result;
        if (result) setCheckResult(result);
        setStatus(e.message);
        return;
      }
      setStatus(e instanceof Error ? e.message : "Не удалось сдать форму");
    }
  };

  const handleReopenForm = async () => {
    if (!instance || !admin) return;
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
    setRashEntries([]);
    if (instance) {
      await saveRashEntries(instance.instanceId, schema.id, []);
    }
    await persist({ rows: fresh, signatures: sigs });
    setCheckResult(null);
    setStatus("Данные сброшены к шаблону");
  };

  const handleDelete = async () => {
    if (!instance) return;
    if (!confirm(`Удалить форму «${instance.displayName}»?`)) return;
    await deleteInstance(instance.instanceId);
    navigate("/my");
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

  const handleExportPdf = async () => {
    if (!schema || !instance) return;
    setExportingPdf(true);
    try {
      await persist();
      const { exportFormToPdf } = await import("../exportPdf");
      exportFormToPdf({
        schema,
        displayName,
        meta,
        rows,
        signatures,
      });
      setStatus("PDF сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать PDF");
    } finally {
      setExportingPdf(false);
    }
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
      setStatus("Файл Excel сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать Excel");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleCheckRash = async () => {
    if (!schema || !rashMode || !rashData) return;
    setCheckingRash(true);
    setRashIssues(null);
    try {
      const issues = validateAllRash(
        schema.id,
        rows,
        schema.columns,
        rashEntries,
        rashData,
        rowRashIndex ?? undefined,
        kontrAgents
      );
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
      const serverResult = await runInstanceChecks(instance.instanceId, "period");
      if (serverResult) {
        setCheckResult(serverResult);
        setStatus(
          serverResult.failed === 0 && serverResult.skipped === 0
            ? "Проверка пройдена (сервер)"
            : `Ошибок увязок: ${serverResult.failed}` +
              (serverResult.skipped ? `, не разобрано: ${serverResult.skipped}` : "")
        );
      } else {
        const all = await loadAllInstances();
        const result = await runFormChecks(schema.id, all);
        setCheckResult(result);
        setStatus(
          result.failed === 0
            ? "Проверка пройдена"
            : `Ошибок увязок: ${result.failed}`
        );
      }
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось выполнить проверку");
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !instance) return;
    try {
      const imported = await importInstanceFile(file);
      navigate(`/my/${imported.instanceId}`);
    } catch {
      setError("Ошибка импорта файла");
    }
    e.target.value = "";
  };

  if (error) {
    return (
      <div className="form-page">
        <div className="error-box">{error}</div>
        <Link to="/my" className="btn btn-primary" style={{ marginTop: "1rem" }}>
          {formsBackLabel}
        </Link>
      </div>
    );
  }

  if (!schema || !instance) {
    return <div className="loading">Загрузка формы…</div>;
  }

  const pdfUrl = schema.pdfFile ? `/pdf/${schema.pdfFile}` : null;

  return (
    <div className="form-page">
      <div className="form-toolbar">
        <div className="toolbar-breadcrumb">
          <Link to="/my" className="back-link">
            {formsBackLabel}
          </Link>
          <Link to="/catalog" className="back-link muted">
            Каталог
          </Link>
        </div>
        <div className="form-title-block form-title-block-wide">
          <label className="display-name-label">
            Название сохранённой формы
            <input
              className="display-name-input"
              value={displayName}
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
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn btn-outline">
              Образец PDF
            </a>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
          >
            Импорт
          </button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={handleImport} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExportPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? "PDF…" : "Сохранить PDF"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRecalc}
            disabled={recalcing}
            title={
              recalcRuleCount != null
                ? `Правил пересчёта: ${recalcRuleCount}`
                : undefined
            }
          >
            {recalcing ? "…" : "Пересчёт"}
          </button>
          {(recalcRuleCount ?? 0) > 0 && (
            <label className="auto-recalc-toggle" title="Пересчёт итоговых строк и граф">
              <input
                type="checkbox"
                checked={autoRecalc}
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
            onClick={handleExportExcel}
            disabled={exportingExcel}
          >
            {exportingExcel ? "Выгрузка…" : "Выгрузить в Excel"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCheck} disabled={checking}>
            {checking ? "Проверка…" : "Проверить форму"}
          </button>
          {rashMode && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleCheckRash()}
              disabled={checkingRash}
              title={
                rashRuleCount != null
                  ? `Правил расшифровки для ${schema.id}: ${rashRuleCount}`
                  : undefined
              }
            >
              {checkingRash ? "Расшифровка…" : "Проверить расшифровки"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт формы
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void handleReset()}>
            Сбросить данные
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={() => void handleDelete()}>
            Удалить
          </button>
          {instanceStatus === "draft" && !isLocked && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSubmitForm()}
            >
              Сдать форму
            </button>
          )}
          {instanceStatus === "submitted" && admin && (
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
      {isLocked && (
        <div className="status-bar status-locked">
          Форма сдана и доступна только для просмотра. Для правок обратитесь к администратору.
        </div>
      )}
      <CheckResultsPanel result={checkResult} loading={checking} />

      {rashMode && rashRuleCount != null && rashRuleCount > 0 && (
        <p className="tools-hint" style={{ margin: "0.5rem 0" }}>
          {kontrMode ? (
            <>
              Форма с расшифровкой контрагентов в строках
            </>
          ) : (
            <>
              Суммы на форме формируются из расшифровки. Ввод в графах B–M вручную
              недоступен — нажмите кнопку <strong>«…»</strong> справа в ячейке, чтобы
              открыть окно контрагентов
            </>
          )}
          : правил расшифровки — <strong>{rashRuleCount}</strong>. Пороги: 1 тыс. /
          5 млн / 50 млн руб. (
          <Link to="/admin/rash">настройки</Link>).
        </p>
      )}

      {rashIssues && rashIssues.length > 0 && (
        <section className="rash-results" style={{ marginBottom: "1rem" }}>
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
            />
          </label>
          <label className="meta-wide">
            Организация
            <input
              value={meta.organization}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
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
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              value={meta.periodEnd}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
            />
          </label>
          <label>
            Ед. изм.
            <input
              value={meta.unit}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
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
        kontrRefA1Name={kontrRefA1Name}
        rashThresholds={rashData?.thresholds}
        cellErrors={cellErrors}
        readOnly={isLocked}
        rashSlots={rashSlots}
        rashEntryCounts={rashEntryCounts}
        rashReadonlyCells={rashReadonlyCells}
        onRashOpen={rashMode && !isLocked ? openRashModal : undefined}
      />

      {rashData && (
        <RashEditorModal
          open={!!rashModal}
          onClose={() => setRashModal(null)}
          onSave={(entries) => void handleRashSave(entries)}
          context={
            rashModal
              ? {
                  formId: rashModal.formId,
                  parentRowNo: rashModal.parentRowNo,
                  columnKey: rashModal.columnKey,
                  rashKod: rashModal.rashKod,
                  rule: rashModal.rule,
                  parentLabel: rashModal.parentLabel,
                  parentValue: rashModal.parentValue,
                }
              : null
          }
          entries={rashModalEntries}
          formColumns={schema.columns}
          addsum={rashData.addsum}
          kontrAgents={kontrAgents}
          rashRefs={rashRefs}
          readOnly={isLocked}
        />
      )}

      {schema.signatures.length > 0 && (
        <section className="signatures">
          <h3>Подписи</h3>
          <div className="sig-grid">
            {schema.signatures.map((name) => (
              <label key={name}>
                {name}
                <input
                  value={signatures[name] ?? ""}
                  onChange={(e) =>
                    setSignatures((s) => ({ ...s, [name]: e.target.value }))
                  }
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
