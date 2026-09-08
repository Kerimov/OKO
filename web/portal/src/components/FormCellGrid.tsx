import { useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog, loadSchema } from "../api";
import { useVirtualRows } from "../hooks/useVirtualRows";
import type { FormSchema } from "../types";

export type FormCellPick = {
  formId: string;
  columnKey: string;
  rowNo: string;
};

const ROW_HEIGHT = 44;

export function formCellKey(rowNo: string | number, columnKey: string): string {
  return `${String(rowNo).trim()}:${columnKey}`;
}

/**
 * Binding-style cell grid (checkboxes + links to other rules), with optional
 * Excel-like navigation to another form. Used by Saldo and Excel editors.
 */
export function FormCellGrid({
  workspaceFormId = "",
  gridFormId,
  onGridFormIdChange,
  activeCellKeys,
  cellOwners,
  /** Label of the rule currently being edited (e.g. «№12» / «#5») — hidden from conflict links. */
  currentOwnerId,
  pickHint = "Чекбокс — выбрать. Чужие настройки — ссылкой. ПКМ или «⋯» — меню (другая форма, очистить).",
  onPick,
  onClear,
  onOpenOwner,
  allowCrossForm = true,
}: {
  workspaceFormId?: string;
  gridFormId: string;
  onGridFormIdChange: (formId: string) => void;
  activeCellKeys?: Set<string>;
  cellOwners?: Map<string, string[]>;
  currentOwnerId?: string;
  pickHint?: string;
  onPick: (pick: FormCellPick) => void;
  onClear?: (pick: FormCellPick) => void;
  onOpenOwner?: (ownerId: string, pick: FormCellPick) => void;
  allowCrossForm?: boolean;
}) {
  const [formIds, setFormIds] = useState<string[]>([]);
  const [formLabels, setFormLabels] = useState<Record<string, string>>({});
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const [navStack, setNavStack] = useState<string[]>([]);
  const [returnAfterPick, setReturnAfterPick] = useState(true);
  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [formPickerQuery, setFormPickerQuery] = useState("");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pickerSearchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const ids = catalog.forms.map((f) => f.id);
        const labels: Record<string, string> = {};
        for (const f of catalog.forms) {
          labels[f.id] = f.title ? `${f.id} — ${f.title}` : f.id;
        }
        setFormIds(ids);
        setFormLabels(labels);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить каталог");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!gridFormId) {
      setSchema(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadSchema(gridFormId)
      .then((s) => {
        if (!cancelled) setSchema(s);
      })
      .catch((e) => {
        if (!cancelled) {
          setSchema(null);
          setError(e instanceof Error ? e.message : "Не удалось загрузить схему");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gridFormId]);

  useEffect(() => {
    setFormPickerOpen(false);
    setFormPickerQuery("");
    setRowFilter("");
    setMenuKey(null);
  }, [gridFormId]);

  useEffect(() => {
    setNavStack([]);
    setFormPickerOpen(false);
    setMenuKey(null);
  }, [workspaceFormId]);

  useEffect(() => {
    if (!formPickerOpen) return;
    const t = window.setTimeout(() => pickerSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [formPickerOpen]);

  const columns = useMemo(
    () => schema?.columns.filter((c) => c.type === "number") ?? [],
    [schema]
  );

  const rows = useMemo(() => {
    if (!schema) return [];
    const q = rowFilter.trim().toLowerCase();
    return schema.rows.filter((row) => {
      const rowNo = String(row.num ?? "").trim();
      if (!rowNo) return false;
      if (!q) return true;
      return (
        rowNo.toLowerCase().includes(q) ||
        String(row.name ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [schema, rowFilter]);

  const filteredForms = useMemo(() => {
    const q = formPickerQuery.trim().toLowerCase();
    return formIds.filter((id) => {
      if (id === gridFormId) return false;
      if (!q) return true;
      const label = (formLabels[id] ?? id).toLowerCase();
      return id.toLowerCase().includes(q) || label.includes(q);
    });
  }, [formIds, formLabels, formPickerQuery, gridFormId]);

  const virtual = useVirtualRows(scrollRef, rows.length, ROW_HEIGHT, {
    threshold: 40,
  });

  const homeFormId = workspaceFormId || navStack[0] || "";
  const awayFromHome = Boolean(
    homeFormId && gridFormId && gridFormId !== homeFormId
  );
  const canReturn = navStack.length > 0 || awayFromHome;

  const goToForm = (targetFormId: string) => {
    if (!targetFormId || targetFormId === gridFormId) {
      setFormPickerOpen(false);
      setMenuKey(null);
      return;
    }
    if (gridFormId) {
      setNavStack((stack) =>
        stack[stack.length - 1] === gridFormId ? stack : [...stack, gridFormId]
      );
    }
    onGridFormIdChange(targetFormId);
    setFormPickerOpen(false);
    setFormPickerQuery("");
    setMenuKey(null);
  };

  const returnToPreviousSheet = () => {
    if (navStack.length > 0) {
      const prev = navStack[navStack.length - 1];
      setNavStack((stack) => stack.slice(0, -1));
      onGridFormIdChange(prev);
      return;
    }
    if (homeFormId) onGridFormIdChange(homeFormId);
  };

  const returnHome = () => {
    setNavStack([]);
    if (homeFormId) onGridFormIdChange(homeFormId);
  };

  const toggleCell = (rowNo: string, columnKey: string) => {
    if (!gridFormId) return;
    const pick: FormCellPick = { formId: gridFormId, columnKey, rowNo };
    const key = formCellKey(rowNo, columnKey);
    const isActive = activeCellKeys?.has(key) ?? false;
    if (isActive) {
      onClear?.(pick);
      return;
    }
    onPick(pick);
    if (returnAfterPick && awayFromHome) returnToPreviousSheet();
  };

  const otherOwners = (key: string, isActive: boolean): string[] => {
    const owners = cellOwners?.get(key) ?? [];
    return owners.filter((id) => {
      if (currentOwnerId && id === currentOwnerId) return false;
      if (isActive && currentOwnerId && id === currentOwnerId) return false;
      return true;
    });
  };

  const openCellMenu = (key: string) => {
    setFormPickerOpen(false);
    setMenuKey((prev) => (prev === key ? null : key));
  };

  const renderCellMenu = (
    key: string,
    pick: FormCellPick,
    checked: boolean,
    others: string[]
  ) => {
    if (menuKey !== key) return null;
    return (
      <div className="checks-cell-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            toggleCell(pick.rowNo, pick.columnKey);
            setMenuKey(null);
          }}
        >
          {checked ? "Снять выбор" : "Выбрать ячейку"}
        </button>
        {allowCrossForm ? (
          <button
            type="button"
            role="menuitem"
            className="checks-cell-menu-accent"
            onClick={() => {
              setMenuKey(null);
              setFormPickerOpen(true);
            }}
          >
            Связать с другой формой…
          </button>
        ) : null}
        {others.map((id) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenOwner?.(id, pick);
              setMenuKey(null);
            }}
          >
            Открыть {id}
          </button>
        ))}
        {checked && onClear ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClear(pick);
              setMenuKey(null);
            }}
          >
            Очистить привязку
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="rash-binding-designer form-cell-grid">
      <div className="checks-form-grid">
        <label>
          Форма
          <select
            value={gridFormId}
            onChange={(e) => {
              const next = e.target.value;
              if (!next) {
                onGridFormIdChange("");
                setNavStack([]);
                return;
              }
              if (homeFormId && next === homeFormId) {
                returnHome();
                return;
              }
              goToForm(next);
            }}
          >
            <option value="">— выберите форму —</option>
            {formIds.map((id) => (
              <option key={id} value={id}>
                {formLabels[id] ?? id}
                {workspaceFormId && id === workspaceFormId ? " (исходная)" : ""}
              </option>
            ))}
          </select>
        </label>
        {gridFormId ? (
          <label>
            Фильтр строк
            <input
              type="search"
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value)}
              placeholder="№ или название…"
            />
          </label>
        ) : null}
        {allowCrossForm ? (
          <div className="checks-cell-picker-goto">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!gridFormId}
              onClick={() => setFormPickerOpen((v) => !v)}
            >
              Другая форма…
            </button>
            {formPickerOpen ? (
              <div className="checks-sheet-picker" role="dialog" aria-label="Выбор формы">
                <div className="checks-sheet-picker-head">
                  <strong>Ячейка другой формы</strong>
                  <span className="tools-hint">Как переход на другой лист в Excel</span>
                </div>
                <input
                  ref={pickerSearchRef}
                  type="search"
                  className="checks-sheet-picker-search"
                  value={formPickerQuery}
                  onChange={(e) => setFormPickerQuery(e.target.value)}
                  placeholder="Поиск формы…"
                />
                <div className="checks-sheet-picker-list">
                  {filteredForms.length === 0 ? (
                    <p className="tools-hint">Нет форм по запросу</p>
                  ) : (
                    filteredForms.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="checks-sheet-picker-item"
                        onClick={() => goToForm(id)}
                      >
                        {formLabels[id] ?? id}
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setFormPickerOpen(false)}
                >
                  Отмена
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {(awayFromHome || navStack.length > 0) && (
        <div
          className={`checks-formula-sheetbar${awayFromHome ? " is-away" : ""}`}
        >
          <div className="checks-formula-sheetbar-main">
            <span className="checks-formula-sheetbar-label">Выбор ячейки</span>
            <span>
              Лист: <strong>{gridFormId || "—"}</strong>
              {homeFormId && gridFormId !== homeFormId ? (
                <>
                  {" "}
                  · исходный: <strong>{homeFormId}</strong>
                </>
              ) : null}
            </span>
          </div>
          <div className="checks-formula-sheetbar-actions">
            <label className="check-flag checks-formula-return-flag">
              <input
                type="checkbox"
                checked={returnAfterPick}
                onChange={(e) => setReturnAfterPick(e.target.checked)}
              />
              После выбора вернуться
            </label>
            {canReturn ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={returnToPreviousSheet}
              >
                ← Вернуться
                {navStack.length
                  ? ` к ${navStack[navStack.length - 1]}`
                  : homeFormId
                    ? ` к ${homeFormId}`
                    : ""}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <p className="tools-hint">{pickHint}</p>

      {error ? <p className="error-box">{error}</p> : null}
      {loading ? <p className="loading">Загрузка формы…</p> : null}

      {schema && !loading ? (
        columns.length === 0 ? (
          <p className="tools-hint">В форме нет числовых граф.</p>
        ) : (
          <div
            ref={scrollRef}
            className="rash-binding-grid-wrap"
          >
            <table className="checks-table rash-binding-grid">
              <thead>
                <tr>
                  <th>Строка</th>
                  {columns.map((column) => (
                    <th key={column.key} title={column.label}>
                      {column.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {virtual.enabled && virtual.offsetTop > 0 ? (
                  <tr aria-hidden>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        height: virtual.offsetTop,
                        padding: 0,
                        border: "none",
                      }}
                    />
                  </tr>
                ) : null}
                {(virtual.enabled
                  ? rows.slice(virtual.startIndex, virtual.endIndex)
                  : rows
                ).map((row, localIdx) => {
                  const index = virtual.enabled
                    ? virtual.startIndex + localIdx
                    : localIdx;
                  const rowNo = String(row.num ?? "").trim();
                  return (
                    <tr
                      key={`${rowNo}-${index}`}
                      style={virtual.enabled ? { height: ROW_HEIGHT } : undefined}
                    >
                      <td title={row.name}>
                        <strong>{rowNo}</strong>
                        {row.name ? ` — ${row.name}` : ""}
                      </td>
                      {columns.map((column) => {
                        const key = formCellKey(rowNo, column.key);
                        const checked = activeCellKeys?.has(key) ?? false;
                        const others = otherOwners(key, checked);
                        const foreign = others[0];
                        const pick: FormCellPick = {
                          formId: gridFormId,
                          columnKey: column.key,
                          rowNo,
                        };
                        const menuOpen = menuKey === key;
                        return (
                          <td
                            key={column.key}
                            className={[
                              "checks-cell-slot",
                              foreign && !checked
                                ? "rash-binding-conflict"
                                : "",
                              checked ? "rash-binding-selected" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            title={
                              foreign && !checked
                                ? `Уже привязано к ${foreign}`
                                : checked
                                  ? "Текущая настройка"
                                  : undefined
                            }
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openCellMenu(key);
                            }}
                          >
                            <div className="checks-cell-slot-inner checks-cell-slot-binding">
                              <input
                                type="checkbox"
                                checked={checked}
                                aria-label={`Строка ${rowNo}, графа ${column.key}`}
                                onChange={() => toggleCell(rowNo, column.key)}
                              />
                              {foreign && !checked ? (
                                <button
                                  type="button"
                                  className="rash-binding-conflict-link"
                                  onClick={() => onOpenOwner?.(foreign, pick)}
                                >
                                  {foreign}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="checks-cell-act checks-cell-act-menu"
                                title="Меню ячейки"
                                aria-label="Меню ячейки"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCellMenu(key);
                                }}
                              >
                                ⋯
                              </button>
                            </div>
                            {menuOpen
                              ? renderCellMenu(key, pick, checked, others)
                              : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {virtual.enabled && virtual.offsetBottom > 0 ? (
                  <tr aria-hidden>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        height: virtual.offsetBottom,
                        padding: 0,
                        border: "none",
                      }}
                    />
                  </tr>
                ) : null}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="tools-hint">Нет строк по фильтру.</p>
            ) : null}
          </div>
        )
      ) : !gridFormId && !loading ? (
        <p className="tools-hint">Выберите форму, чтобы показать таблицу.</p>
      ) : null}
    </div>
  );
}
