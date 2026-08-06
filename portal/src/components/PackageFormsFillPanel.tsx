import { useEffect, useMemo, useState } from "react";
import { loadCatalog } from "../api";
import type { FormCatalog, PackageWorkspaceRow } from "../types";
import { CollapsibleFilters, countActiveFilters } from "./CollapsibleFilters";

type FormsMode = "all" | "selected";

type Props = {
  targets: PackageWorkspaceRow[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    formsMode: FormsMode;
    formIds: string[];
  }) => void | Promise<void>;
};

/**
 * Choose full package or a subset of templates before creating form instances.
 */
export function PackageFormsFillPanel({
  targets,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [formsMode, setFormsMode] = useState<FormsMode>("all");
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogForms = useMemo(
    () => (catalog?.forms ?? []).filter((f) => !f.archived),
    [catalog]
  );

  const categories = useMemo(() => {
    const set = new Set(catalogForms.map((f) => f.category).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [catalogForms]);

  const visibleForms = useMemo(() => {
    const q = formSearch.trim().toLowerCase();
    return catalogForms.filter((f) => {
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
      );
    });
  }, [catalogForms, categoryFilter, formSearch]);

  const toggleForm = (formId: string) => {
    setSelectedFormIds((prev) =>
      prev.includes(formId)
        ? prev.filter((x) => x !== formId)
        : [...prev, formId]
    );
  };

  const handleConfirm = () => {
    if (formsMode === "selected" && selectedFormIds.length === 0) {
      setError("Выберите хотя бы одну форму");
      return;
    }
    setError("");
    void onConfirm({
      formsMode,
      formIds: formsMode === "selected" ? selectedFormIds : [],
    });
  };

  return (
    <section className="tools-section package-forms-fill-panel">
      <h2>Завести формы</h2>
      <p className="tools-hint">
        Организаций: <strong>{targets.length}</strong>
        {targets.length <= 5
          ? ` — ${targets.map((t) => t.organizationName).join(", ")}`
          : ""}
        . Можно завести полный комплект или только выбранные формы.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="tools-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={formsMode === "all" ? "active" : undefined}
          onClick={() => setFormsMode("all")}
        >
          Полный комплект ({catalogForms.length})
        </button>
        <button
          type="button"
          className={formsMode === "selected" ? "active" : undefined}
          onClick={() => setFormsMode("selected")}
        >
          Выбранные формы
        </button>
      </div>

      {formsMode === "selected" ? (
        <>
          <CollapsibleFilters
            title="Фильтр форм"
            activeCount={countActiveFilters(
              categoryFilter !== "",
              formSearch.trim().length > 0
            )}
            bodyClassName="tools-grid"
          >
            <label>
              Категория
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Все</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {catalog?.categories?.[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поиск
              <input
                type="search"
                value={formSearch}
                onChange={(e) => setFormSearch(e.target.value)}
                placeholder="Код или название…"
              />
            </label>
          </CollapsibleFilters>
          <div className="toolbar-actions" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedFormIds(visibleForms.map((f) => f.id))}
            >
              Выбрать видимые
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedFormIds([])}
            >
              Снять выбор
            </button>
            <span className="tools-hint">Выбрано: {selectedFormIds.length}</span>
          </div>
          <div className="aggr-list package-constructor-form-list">
            {visibleForms.map((f) => (
              <label key={f.id} className="package-constructor-check-row">
                <input
                  type="checkbox"
                  checked={selectedFormIds.includes(f.id)}
                  onChange={() => toggleForm(f.id)}
                />
                <span>
                  <strong>{f.id}</strong> — {f.title}
                  <span className="table-sub"> · {f.category}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}

      <div className="toolbar-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={handleConfirm}
        >
          {busy
            ? "Создание…"
            : `Завести формы (${targets.length})`}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </section>
  );
}
