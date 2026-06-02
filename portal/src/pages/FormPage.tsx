import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { loadSchema } from "../api";
import { FormTable } from "../components/FormTable";
import {
  deleteInstance,
  exportInstance,
  importInstanceFile,
  loadInstance,
  saveGlobalMeta,
  saveInstance,
} from "../storage";
import type { FormMeta, FormSchema, OkoFormInstance, RowData } from "../types";
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
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!instanceId) return;
    setError("");
    const inst = loadInstance(instanceId);
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
  }, [instanceId]);

  const persist = useCallback(
    (overrides?: Partial<Pick<OkoFormInstance, "displayName" | "rows" | "meta" | "signatures">>) => {
      if (!instance || !schema) return null;
      const updated: OkoFormInstance = {
        ...instance,
        displayName: overrides?.displayName ?? displayName,
        meta: overrides?.meta ?? meta,
        rows: overrides?.rows ?? rows,
        signatures: overrides?.signatures ?? signatures,
        updatedAt: new Date().toISOString(),
      };
      saveInstance(updated);
      saveGlobalMeta(updated.meta);
      setInstance(updated);
      return updated;
    },
    [instance, schema, displayName, meta, rows, signatures]
  );

  const handleSave = useCallback(() => {
    if (!instance) return;
    persist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, persist]);

  const handleReset = () => {
    if (!schema || !instance) return;
    if (!confirm("Сбросить все введённые данные к шаблону?")) return;
    const fresh = buildInitialRows(schema);
    const sigs: Record<string, string> = {};
    for (const name of schema.signatures) sigs[name] = "";
    setRows(fresh);
    setSignatures(sigs);
    persist({ rows: fresh, signatures: sigs });
    setStatus("Данные сброшены к шаблону");
  };

  const handleDelete = () => {
    if (!instance) return;
    if (!confirm(`Удалить форму «${instance.displayName}»?`)) return;
    deleteInstance(instance.instanceId);
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
      persist();
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
              onBlur={() => persist({ displayName })}
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
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleReset}>
            Сбросить данные
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={handleDelete}>
            Удалить
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Сохранить
          </button>
        </div>
      </div>
      {status && <div className="status-bar">{status}</div>}

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
        allowAddRows={schema.allowAddRows}
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
