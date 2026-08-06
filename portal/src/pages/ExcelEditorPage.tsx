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
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";

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
  const [search, setSearch] = useState("");
  const [workspaceFormId, setWorkspaceFormId] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [gridFormId, setGridFormId] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );
  const [selected, setSelected] = useState<ExcelMapping | null>(null);
  const [draft, setDraft] = useState<ExcelMapping>(EMPTY_MAPPING);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 80;

  const editing = creating || selected != null;

  const usedCellKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!gridFormId) return keys;
    for (const m of items) {
      if (m.formName !== gridFormId || !m.formColumn) continue;
      keys.add(formCellKey(m.formRow ?? "", m.formColumn));
    }
    return keys;
  }, [items, gridFormId]);

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
          catalog.forms.map((f) => ({
            id: f.id,
            label: f.title ? `${f.id} — ${f.title}` : f.id,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(async () => {
    if (!backend) return;
    if (!workspaceFormId) {
      setItems([]);
      setTotal(0);
      setStats(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchExcelPage({
          q: search || undefined,
          formName: workspaceFormId,
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
  }, [backend, search, workspaceFormId, offset]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const selectWorkspaceForm = (formId: string) => {
    setWorkspaceFormId(formId);
    setGridFormId(formId);
    setOffset(0);
    setSelected(null);
    setDraft(EMPTY_MAPPING);
    setCreating(false);
    setStatus("");
  };

  const selectItem = (item: ExcelMapping) => {
    setSelected(item);
    setDraft({ ...item });
    setCreating(false);
    if (item.formName) setGridFormId(item.formName);
  };

  const handleNew = () => {
    if (!workspaceFormId) return;
    setSelected(null);
    setDraft({
      ...EMPTY_MAPPING,
      formName: workspaceFormId,
      sheetName: workspaceFormId,
    });
    setCreating(true);
    setGridFormId(workspaceFormId);
  };

  const handlePick = (pick: FormCellPick) => {
    if (!editing) {
      setCreating(true);
      setSelected(null);
      setDraft(
        applyFormPick(
          {
            ...EMPTY_MAPPING,
            formName: workspaceFormId || pick.formId,
            sheetName: workspaceFormId || pick.formId,
          },
          pick
        )
      );
      return;
    }
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
  if (!access.ok) {
    return <AdminAccessGate title="Маппинг Excel" />;
  }

  const formCellLabel =
    draft.formName && draft.formColumn
      ? `${draft.formName} · ${draft.formColumn} · ${draft.formRow ?? "?"}`
      : "— не выбрана —";

  return (
    <div className="admin-page checks-editor excel-editor">
      <header className="admin-header">
        <div>
          <h1>Маппинг Excel</h1>
          <p className="admin-desc">
            Выберите форму — список маппингов и таблица ячеек. Клик по ячейке задаёт
            поле формы; координаты листа Excel — справа.
          </p>
        </div>
        {stats && (
          <div className="admin-stats">
            <span>Всего: {stats.total}</span>
            <span>Форм: {stats.formsCount}</span>
          </div>
        )}
      </header>

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      <section className="checks-workspace-formbar">
        <label className="checks-workspace-form-select">
          Форма
          <select
            value={workspaceFormId}
            onChange={(e) => selectWorkspaceForm(e.target.value)}
          >
            <option value="">— выберите форму —</option>
            {formOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="checks-filters-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleReimport}
          >
            Импорт из файла
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!workspaceFormId}
            onClick={handleNew}
          >
            + Новая запись
          </button>
        </div>
      </section>

      {!workspaceFormId ? (
        <section className="tools-section checks-workspace-empty">
          <h2>Выберите форму</h2>
          <p className="tools-hint">
            После выбора отобразятся маппинги Excel для формы и таблица ячеек шаблона.
          </p>
        </section>
      ) : (
        <div className="checks-layout checks-layout-workspace">
          <section className="checks-list-panel">
            <div className="checks-list-toolbar">
              <h2 className="checks-panel-title">
                Маппинги · <code>{workspaceFormId}</code>
                {total > 0 ? ` · ${total}` : ""}
              </h2>
              <CollapsibleFilters
                activeCount={countActiveFilters(search.trim().length > 0)}
                bodyClassName="checks-filters"
              >
                <input
                  type="search"
                  placeholder="Поиск по листу, ячейке…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  className="search-input"
                />
              </CollapsibleFilters>
            </div>

            {loading ? (
              <p className="loading">Загрузка…</p>
            ) : items.length === 0 ? (
              <p className="tools-hint">Нет маппингов для формы.</p>
            ) : (
              <>
                <table className="checks-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Лист Excel</th>
                      <th>Ячейка Excel</th>
                      <th>Ячейка формы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={r.id}
                        className={selected?.id === r.id ? "selected" : ""}
                        onClick={() => selectItem(r)}
                      >
                        <td>{r.id}</td>
                        <td className="expr-cell">{r.sheetName ?? "—"}</td>
                        <td>
                          {r.excelRow ?? "?"},{r.excelColumn ?? "?"}
                        </td>
                        <td>
                          {r.formColumn ?? "—"}
                          {r.formRow != null ? ` R${r.formRow}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="checks-pager">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    ← Назад
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + limit, total)} из {total}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Вперёд →
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="checks-edit-panel">
            <h2>
              {selected
                ? `Запись #${selected.id}`
                : creating
                  ? "Новая запись"
                  : "Таблица и настройка"}
            </h2>

            <div className="saldo-pick-slots" role="group" aria-label="Ячейка формы">
              <button type="button" className="saldo-pick-slot is-active">
                <span className="saldo-pick-slot-label">Ячейка формы</span>
                <span className="saldo-pick-slot-value">{formCellLabel}</span>
              </button>
            </div>

            <FormCellGrid
              workspaceFormId={workspaceFormId}
              gridFormId={gridFormId}
              onGridFormIdChange={setGridFormId}
              usedCellKeys={usedCellKeys}
              activeCellKeys={activeCellKeys}
              cellOwners={cellOwners}
              pickHint="Клик по ячейке задаёт поле формы в маппинге Excel"
              onPick={handlePick}
              onOpenOwner={(ownerId) => {
                const id = Number(String(ownerId).replace(/^#/, ""));
                const item = items.find((r) => r.id === id);
                if (item) selectItem(item);
              }}
            />

            {editing ? (
              <div className="checks-form-grid" style={{ marginTop: 12 }}>
                <p className="form-section-label">Лист Excel</p>
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
                <div className="checks-flags">
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
                <div className="checks-actions">
                  <button type="button" className="btn btn-primary" onClick={handleSave}>
                    Сохранить
                  </button>
                  {selected?.id && (
                    <button
                      type="button"
                      className="btn btn-danger-outline"
                      onClick={handleDelete}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="tools-hint">
                Выберите запись слева или «+ Новая», затем кликните ячейку в таблице.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
