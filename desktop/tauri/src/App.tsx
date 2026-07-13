import { useCallback, useEffect, useState } from "react";
import { FormTable } from "@portal/components/FormTable";
import type { FormSchema, OkoFormInstance, RowData } from "@portal/types";
import {
  closePackage,
  demoEngineCheck,
  listSummaries,
  loadInstance,
  loadSchema,
  openPackage,
  pickPackageFolder,
  runtimeInfo,
  saveInstance,
  type InstanceSummary,
  type OpenPackageResult,
} from "./tauriApi";

export function App() {
  const [pkg, setPkg] = useState<OpenPackageResult | null>(null);
  const [summaries, setSummaries] = useState<InstanceSummary[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [instance, setInstance] = useState<OkoFormInstance | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    setSummaries(await listSummaries());
  }, []);

  const handleOpen = async () => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const folder = await pickPackageFolder();
      if (!folder) {
        setStatus("Папка не выбрана");
        return;
      }
      const opened = await openPackage(folder);
      setPkg(opened);
      setInstance(null);
      setSchema(null);
      setRows([]);
      await refreshList();
      setStatus(`Открыт комплект: ${opened.meta.organization}`);
    } catch (e) {
      setPkg(null);
      setSummaries([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      await closePackage();
      setPkg(null);
      setSummaries([]);
      setInstance(null);
      setSchema(null);
      setRows([]);
      setStatus("Комплект закрыт");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSelect = async (summary: InstanceSummary) => {
    setError("");
    setBusy(true);
    try {
      const inst = await loadInstance(summary.instanceId);
      const sch = await loadSchema(inst.templateId);
      setInstance(inst);
      setSchema(sch);
      setRows(inst.rows.map((r) => ({ ...r })));
      setStatus(`${inst.templateId} — ${inst.displayName}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!instance) return;
    setBusy(true);
    setError("");
    try {
      const payload: OkoFormInstance = {
        ...instance,
        rows,
        updatedAt: new Date().toISOString(),
      };
      const saved = await saveInstance(payload);
      setInstance(saved);
      setRows(saved.rows.map((r) => ({ ...r })));
      await refreshList();
      setStatus(`Сохранено ${new Date().toLocaleTimeString("ru-RU")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEngine = () => {
    if (!instance) {
      setStatus("Сначала откройте форму");
      return;
    }
    const result = demoEngineCheck(rows, instance.templateId);
    setStatus(
      `Engine: total=${result.total} passed=${result.passed} failed=${result.failed}`
    );
  };

  useEffect(() => {
    void runtimeInfo()
      .then((info) => setStatus(`${info.runtime} ${info.version}`))
      .catch(() => setStatus("UI mode (без Tauri runtime)"));
  }, []);

  return (
    <div className="app">
      <h1 className="brand">ОКО Заполнение</h1>
      <p className="lead">
        Tauri 2 M2: открытие комплекта, список форм, редактирование и сохранение ячеек через
        native SQLite (<code>rusqlite</code>). Electron-пилот — <code>desktop/filler</code>.
      </p>

      <div className="row">
        <button type="button" disabled={busy} onClick={() => void handleOpen()}>
          Открыть комплект…
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !pkg}
          onClick={() => void handleClose()}
        >
          Закрыть
        </button>
        <button type="button" className="secondary" disabled={busy || !instance} onClick={() => void handleSave()}>
          Сохранить форму
        </button>
        <button type="button" className="secondary" disabled={busy || !instance} onClick={handleEngine}>
          Smoke @oko/engine
        </button>
      </div>

      {status ? <p className="muted">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {pkg ? (
        <div className="layout">
          <aside className="panel sidebar">
            <h2>
              Формы ({summaries.length}) — {pkg.meta.organization}
            </h2>
            <ul className="form-list">
              {summaries.map((s) => (
                <li key={s.instanceId}>
                  <button
                    type="button"
                    className={
                      instance?.instanceId === s.instanceId ? "form-item active" : "form-item"
                    }
                    disabled={busy}
                    onClick={() => void handleSelect(s)}
                  >
                    <span className="id">{s.templateId}</span>
                    <span className="st">{s.status === "submitted" ? "сдано" : "черновик"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="panel editor">
            {schema && instance ? (
              <>
                <h2>
                  {schema.id} — {schema.title}
                </h2>
                <FormTable
                  columns={schema.columns}
                  rows={rows}
                  onChange={setRows}
                  allowAddRows={schema.allowAddRows}
                  kontrMode={schema.kontrForm}
                  readOnly={instance.status === "submitted"}
                />
              </>
            ) : (
              <p className="muted">Выберите форму слева</p>
            )}
          </main>
        </div>
      ) : (
        <p className="muted">
          Нужны Rust + toolchain. Затем: <code>cd desktop/tauri && npm run dev:tauri</code>
        </p>
      )}
    </div>
  );
}
