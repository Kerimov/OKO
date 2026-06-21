import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadSchema } from "../api";
import { CheckResultsPanel } from "../components/CheckResultsPanel";
import { FormTable } from "../components/FormTable";
import { isKontrForm } from "../constants";
import { runFormChecks, type CheckRunResult } from "../engine/checkEngine";
import { failedCellsForForm } from "../engine/cellErrors";
import { exportFormToExcel } from "../engine/exportExcel";
import { recalcForm } from "../engine/recalcEngine";
import {
  deleteInstance,
  exportInstance,
  importInstanceFile,
  loadAllInstances,
  loadInstance,
  loadKontrAgents,
  saveGlobalMeta,
  saveInstance,
} from "../storage";
import type { FormMeta, FormSchema, KontrAgent, OkoFormInstance, RowData } from "../types";
import { buildInitialRows, formatPeriod } from "../utils";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const kontrMode = schema ? isKontrForm(schema.id) : false;

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
    });
  }, [instanceId]);

  useEffect(() => {
    if (!kontrMode) return;
    loadKontrAgents().then(setKontrAgents).catch(() => setKontrAgents([]));
  }, [kontrMode]);

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
      await saveInstance(updated);
      await saveGlobalMeta(updated.meta);
      setInstance(updated);
      return updated;
    },
    [instance, schema, displayName, meta, rows, signatures]
  );

  const handleSave = useCallback(async () => {
    if (!instance) return;
    await persist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, persist]);

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
      setStatus("Excel сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать Excel");
    } finally {
      setExportingExcel(false);
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
        result.failed === 0
          ? "Проверка пройдена"
          : `Ошибок увязок: ${result.failed}`
      );
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
          ← Мои формы ОКО
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
            ← Мои формы ОКО
          </Link>
          <Link to="/" className="back-link muted">
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
          >
            {recalcing ? "…" : "Пересчёт"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportExcel}
            disabled={exportingExcel}
          >
            {exportingExcel ? "Excel…" : "Excel"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCheck} disabled={checking}>
            {checking ? "Проверка…" : "Проверить форму"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void handleReset()}>
            Сбросить данные
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={() => void handleDelete()}>
            Удалить
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
            Сохранить
          </button>
        </div>
      </div>
      {status && <div className="status-bar">{status}</div>}
      <CheckResultsPanel result={checkResult} loading={checking} />

      <section className="form-meta-panel">
        <div className="meta-grid">
          <label>
            Код предприятия
            <input
              value={meta.enterpriseCode}
              onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
            />
          </label>
          <label className="meta-wide">
            Организация
            <input
              value={meta.organization}
              onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
              placeholder="Наименование организации"
            />
          </label>
          <label>
            Начало периода
            <input
              type="date"
              value={meta.periodStart}
              onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              value={meta.periodEnd}
              onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
            />
          </label>
          <label>
            Ед. изм.
            <input
              value={meta.unit}
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
        onChange={setRows}
        allowAddRows={schema.allowAddRows || kontrMode}
        kontrMode={kontrMode}
        kontrAgents={kontrAgents}
        cellErrors={cellErrors}
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
