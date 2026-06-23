import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { loadCatalog } from "@portal/api";
import type { InstanceSummary } from "@portal/types";
import { categoryLabel, formStatusLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";

export function PackagePage() {
  const { session, refreshSession } = usePackage();
  const location = useLocation();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [exportMsg, setExportMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reloadInstances = useCallback(() => {
    if (!window.oko) return;
    void window.oko
      .listInstances()
      .then(setInstances)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, []);

  useEffect(() => {
    void loadCatalog()
      .then((c) => setCategories(c.categories))
      .catch(() => setCategories({}));
  }, []);

  useEffect(() => {
    reloadInstances();
    void refreshSession();
  }, [session?.folderPath, location.pathname, reloadInstances, refreshSession]);

  const grouped = useMemo(() => {
    const map = new Map<string, InstanceSummary[]>();
    for (const inst of instances) {
      const cat = inst.templateId.split("_")[0] ?? "Прочее";
      const list = map.get(cat) ?? [];
      list.push(inst);
      map.set(cat, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [instances]);

  const handleSeed = async () => {
    setBusy(true);
    setError("");
    try {
      await window.oko.seedPackage();
      const list = await window.oko.listInstances();
      setInstances(list);
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    setExportMsg("");
    setError("");
    try {
      const result = await window.oko.exportJson();
      setExportMsg(`Сохранено: ${result.filePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта");
    } finally {
      setBusy(false);
    }
  };

  const total = instances.length;
  const draft = instances.filter((i) => i.status !== "submitted").length;
  const rulesSync = session?.rulesSync;
  const rulesLabel = rulesSync?.fromPackage
    ? `Правила с ЦО: ${rulesSync.exportedAt ? new Date(rulesSync.exportedAt).toLocaleString("ru-RU") : "импортированы"}`
    : "Правила: встроенные в программу (импортируйте JSON с ЦО для актуальных)";

  return (
    <div className="content">
      <div className="toolbar">
        <div className="stats">
          <span>
            Форм: <strong>{total}</strong>
          </span>
          <span>
            Черновики: <strong>{draft}</strong>
          </span>
          <span className="muted rules-hint">{rulesLabel}</span>
        </div>
        <div className="toolbar-actions">
          <button type="button" disabled={busy} onClick={() => void handleSeed()}>
            Завести пустые формы
          </button>
          <button type="button" className="primary" disabled={busy || total === 0} onClick={() => void handleExport()}>
            Экспорт JSON для ЦО
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {exportMsg && <p className="success">{exportMsg}</p>}

      {total === 0 ? (
        <p className="muted">Комплект пуст. Нажмите «Завести пустые формы» или импортируйте JSON.</p>
      ) : (
        <div className="form-groups">
          {grouped.map(([cat, items]) => (
            <section key={cat} className="form-group">
              <h2>{categoryLabel(categories, cat)}</h2>
              <ul className="instance-list">
                {items.map((inst) => (
                  <li key={inst.instanceId}>
                    <Link to={`/form/${inst.instanceId}`} className="instance-card">
                      <span className="instance-id">{inst.templateId}</span>
                      <span className="instance-title">{inst.templateTitle}</span>
                      <span className={`badge status-${inst.status ?? "draft"}`}>
                        {formStatusLabel(inst.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
