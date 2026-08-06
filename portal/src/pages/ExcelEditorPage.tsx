import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteExcelMapping,
  fetchExcelPage,
  fetchExcelStats,
  loadCatalog,
  reimportExcelFromJson,
  saveExcelMapping,
  type ExcelMapping,
} from "../api";
import {
  FormCellGrid,
  formCellKey,
  type FormCellPick,
} from "../components/FormCellGrid";
import { EditorWizardNav, EditorWizardSteps } from "../components/EditorWizard";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";

type WizardStep = 1 | 2 | 3;

const WIZARD_STEPS = ["Основное", "Ячейка формы", "Проверка"];

const EMPTY_MAPPING: ExcelMapping = {
  formName: "",
  sheetName: null,
  excelRow: null,
  excelColumn: null,
  formColumn: null,
  formRow: null,
  period: false,
  addText: null,
};

function cellLabel(
  form: string | null | undefined,
  column: string | null | undefined,
  row: number | null | undefined
): string {
  if (!form) return "—";
  return `${form} · ${column ?? "?"} · ${row ?? "?"}`;
}

function applyFormPick(draft: ExcelMapping, pick: FormCellPick): ExcelMapping {
  const row = Number(pick.rowNo);
  return {
    ...draft,
    formName: pick.formId,
    formColumn: pick.columnKey,
    formRow: Number.isFinite(row) ? row : null,
  };
}

export function ExcelEditorPage() {
  const backend = isBackendMode();
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState<{ total: number; formsCount: number } | null>(
    null
  );
  const [items, setItems] = useState<ExcelMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );

  const [selected, setSelected] = useState<ExcelMapping | null>(null);
  const [draft, setDraft] = useState<ExcelMapping>(EMPTY_MAPPING);
  const [creating, setCreating] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [gridFormId, setGridFormId] = useState("");

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 80;

  const editing = creating || selected != null;

  const activeCellKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!gridFormId || !editing) return keys;
    if (draft.formName === gridFormId && draft.formColumn) {
      keys.add(formCellKey(draft.formRow ?? "", draft.formColumn));
    }
    return keys;
  }, [draft, gridFormId, editing]);

  const cellOwners = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!gridFormId) return map;
    for (const m of items) {
      if (m.formName !== gridFormId || !m.formColumn || m.id == null) continue;
      const key = formCellKey(m.formRow ?? "", m.formColumn);
      const label = `#${m.id}`;
      const list = map.get(key) ?? [];
      if (!list.includes(label)) list.push(label);
      map.set(key, list);
    }
    return map;
  }, [items, gridFormId]);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setFormOptions(
          catalog.forms
            .map((f) => ({
              id: f.id,
              label: f.title ? `${f.id} — ${f.title}` : f.id,
            }))
            .sort((a, b) => a.id.localeCompare(b.id))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchExcelPage({
          q: search || undefined,
          formName: formFilter || undefined,
          limit,
          offset,
        }),
        fetchExcelStats(),
      ]);
      setItems(page.items);
      setTotal(page.total);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, offset]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const selectItem = (item: ExcelMapping) => {
    setSelected(item);
    setDraft({ ...item });
    setCreating(false);
    setWizardStep(1);
    setGridFormId(item.formName || formFilter || "");
  };

  const handleNew = () => {
    setSelected(null);
    setDraft({
      ...EMPTY_MAPPING,
      formName: formFilter || "",
      sheetName: formFilter || "",
    });
    setCreating(true);
    setWizardStep(1);
    setGridFormId(formFilter || "");
  };

  const handleDiscard = () => {
    if (selected) selectItem(selected);
    else {
      setCreating(false);
      setDraft(EMPTY_MAPPING);
    }
  };

  const handlePick = (pick: FormCellPick) => {
    setDraft((prev) => applyFormPick(prev, pick));
  };

  const handleSave = async () => {
    if (!draft.formName.trim()) {
      setError("Выберите ячейку формы в таблице");
      return;
    }
    try {
      const saved = await saveExcelMapping(draft);
      setStatus(selected ? `Запись #${saved.id} сохранена` : "Запись создана");
      setSelected(saved);
      setDraft({ ...saved });
      setCreating(false);
      setError("");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDelete = async () => {
    if (!selected?.id) return;
    if (!confirm(`Удалить маппинг #${selected.id}?`)) return;
    try {
      await deleteExcelMapping(selected.id);
      setSelected(null);
      setDraft(EMPTY_MAPPING);
      setCreating(false);
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (!confirm("Перезаписать все маппинги из excel-export.json?")) return;
    try {
      const r = await reimportExcelFromJson();
      setStatus(`Импортировано ${r.reimported} записей`);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const access = useAdminAccess();

  const stepBlocked = useMemo(() => {
    if (wizardStep === 2) return !draft.formName || !draft.formColumn;
    return false;
  }, [wizardStep, draft]);

  const canSave = !!draft.formName.trim();

  if (!access.ok) {
    return <AdminAccessGate title="Маппинг Excel" />;
  }

  return (
    <div className="admin-editor-page rash-constructor-page">
      <h1>Конструктор маппинга Excel</h1>
      <p className="tools-intro">
        Соответствие ячеек выгрузки Excel и граф форм: лист/строка/колонка Excel →
        ячейка формы.
      </p>

      {!backend && (
        <div className="status-bar">Режим только чтения. Подключите API для редактирования.</div>
      )}
      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      {stats && (
        <p className="tools-hint">
          Всего: <strong>{stats.total}</strong>, форм: <strong>{stats.formsCount}</strong>
        </p>
      )}

      <div className="editor-list-toolbar">
        <CollapsibleFilters
          activeCount={countActiveFilters(
            searchInput.trim().length > 0,
            formFilter !== ""
          )}
          bodyClassName="checks-filters"
        >
          <input
            placeholder="Поиск по листу, ячейке…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="search-input"
          />
          <select
            value={formFilter}
            onChange={(e) => {
              setFormFilter(e.target.value);
              setOffset(0);
            }}
            className="category-select"
          >
            <option value="">Все формы</option>
            {formOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </CollapsibleFilters>
        {backend && (
          <div className="checks-filters-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReimport()}
            >
              Импорт
            </button>
            <button type="button" className="btn btn-primary" onClick={handleNew}>
              + Новая
            </button>
          </div>
        )}
      </div>

      <div className="checks-layout rash-constructor-layout">
        <div className="checks-list-panel">
          {loading ? (
            <div className="loading">Загрузка…</div>
          ) : items.length === 0 ? (
            <p className="tools-hint">Нет маппингов по фильтру.</p>
          ) : (
            <div className="rash-rule-catalog">
              {items.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`rash-rule-card${selected?.id === r.id ? " selected" : ""}`}
                  onClick={() => selectItem(r)}
                >
                  <span className="rash-rule-card-title">
                    <strong>#{r.id}</strong> {r.sheetName ?? "—"}
                  </span>
                  <span className="rash-rule-card-meta">
                    <span>
                      Excel: {r.excelRow ?? "?"}, {r.excelColumn ?? "?"}
                    </span>
                    <span>
                      Форма: {r.formName} {r.formColumn ?? ""}
                      {r.formRow != null ? ` R${r.formRow}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="toolbar-actions" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ←
            </button>
            <span className="muted">
              {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} / {total}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              →
            </button>
          </div>
        </div>

        <div className="checks-detail-panel">
          {editing ? (
            <>
              <header className="rash-constructor-header">
                <div>
                  <h2>
                    {selected
                      ? `Запись #${selected.id}: ${draft.sheetName || "—"}`
                      : "Новая запись"}
                  </h2>
                  <span className={`status-badge ${draft.formColumn ? "accepted" : "returned"}`}>
                    {draft.formColumn ? "Ячейка формы выбрана" : "Ячейка формы не выбрана"}
                  </span>
                </div>
              </header>

              <EditorWizardSteps
                steps={WIZARD_STEPS}
                value={wizardStep}
                onChange={(step) => setWizardStep(step as WizardStep)}
              />

              {wizardStep === 1 && (
                <section className="tools-section">
                  <h2>1. Основное</h2>
                  <div className="checks-form-grid">
                    <label>
                      Имя листа
                      <input
                        value={draft.sheetName ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, sheetName: e.target.value || null })
                        }
                      />
                    </label>
                    <label>
                      Строка Excel
                      <input
                        type="number"
                        value={draft.excelRow ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            excelRow: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Колонка Excel
                      <input
                        value={draft.excelColumn ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraft({
                            ...draft,
                            excelColumn: v === "" ? null : /^\d+$/.test(v) ? Number(v) : v,
                          });
                        }}
                      />
                    </label>
                    <label>
                      Дополнительный текст
                      <input
                        value={draft.addText ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, addText: e.target.value || null })
                        }
                      />
                    </label>
                    <div className="checks-flags full-width">
                      <label className="check-flag">
                        <input
                          type="checkbox"
                          checked={!!draft.period}
                          onChange={(e) =>
                            setDraft({ ...draft, period: e.target.checked })
                          }
                        />
                        Привязка к периоду
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {wizardStep === 2 && (
                <section className="tools-section">
                  <h2>2. Ячейка формы</h2>
                  <p className="tools-hint">
                    Текущая ячейка: <strong>{cellLabel(draft.formName, draft.formColumn, draft.formRow)}</strong>
                  </p>
                  <FormCellGrid
                    workspaceFormId={draft.formName}
                    gridFormId={gridFormId}
                    onGridFormIdChange={setGridFormId}
                    activeCellKeys={activeCellKeys}
                    cellOwners={cellOwners}
                    currentOwnerId={
                      selected?.id != null ? `#${selected.id}` : undefined
                    }
                    pickHint="Отметьте ячейку формы. Если занята другим маппингом — откройте его по ссылке."
                    onPick={handlePick}
                    onClear={() =>
                      setDraft((prev) => ({
                        ...prev,
                        formColumn: null,
                        formRow: null,
                      }))
                    }
                    onOpenOwner={(ownerId) => {
                      const id = Number(String(ownerId).replace(/^#/, ""));
                      const item = items.find((r) => r.id === id);
                      if (item) selectItem(item);
                    }}
                  />
                </section>
              )}

              {wizardStep === 3 && (
                <section className="tools-section">
                  <h2>3. Проверка перед сохранением</h2>
                  {canSave ? (
                    <p className="status-ok">Запись заполнена корректно и готова к сохранению.</p>
                  ) : (
                    <ul className="rash-validation">
                      <li className="err">Выберите ячейку формы в таблице.</li>
                    </ul>
                  )}
                  <div className="rash-rule-summary">
                    <p>
                      Лист Excel: <strong>{draft.sheetName || "—"}</strong>, ячейка{" "}
                      <strong>
                        {draft.excelRow ?? "?"}, {draft.excelColumn ?? "?"}
                      </strong>
                    </p>
                    <p>
                      Ячейка формы:{" "}
                      <strong>{cellLabel(draft.formName, draft.formColumn, draft.formRow)}</strong>
                    </p>
                    {draft.addText ? (
                      <p>
                        Доп. текст: <strong>{draft.addText}</strong>
                      </p>
                    ) : null}
                    <p>Привязка к периоду: <strong>{draft.period ? "да" : "нет"}</strong></p>
                  </div>
                </section>
              )}

              <EditorWizardNav
                step={wizardStep}
                maxStep={3}
                onBack={() => setWizardStep((wizardStep - 1) as WizardStep)}
                onNext={() => setWizardStep((wizardStep + 1) as WizardStep)}
                nextDisabled={stepBlocked}
              >
                {backend && (
                  <>
                    <span>{selected ? "Изменения" : "Новая запись"}</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!canSave}
                      onClick={() => void handleSave()}
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleDiscard}
                    >
                      Отменить
                    </button>
                    {selected?.id && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void handleDelete()}
                      >
                        Удалить
                      </button>
                    )}
                  </>
                )}
              </EditorWizardNav>
            </>
          ) : (
            <p className="tools-hint">
              Выберите запись слева или «+ Новая», затем задайте ячейку Excel и ячейку
              формы.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
