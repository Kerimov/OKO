import { useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog, loadSchema } from "../api";
import { useVirtualRows } from "../hooks/useVirtualRows";
import type { FormSchema } from "../types";

export type FormCellPick = {
  formId: string;
  columnKey: string;
  rowNo: string;
};

const ROW_HEIGHT = 40;

export function formCellKey(rowNo: string | number, columnKey: string): string {
  return `${String(rowNo).trim()}:${columnKey}`;
}

/**
 * Shared form cell grid with Excel-like sheet navigation (go to other form / return).
 * Used by Saldo and Excel editors; Checks keeps its expression-oriented CellPicker.
 */
export function FormCellGrid({
  workspaceFormId = "",
  gridFormId,
  onGridFormIdChange,
  usedCellKeys,
  activeCellKeys,
  cellOwners,
  pickHint = "Клик по ячейке выбирает её для текущего поля",
  onPick,
  onOpenOwner,
}: {
  workspaceFormId?: string;
  gridFormId: string;
  onGridFormIdChange: (formId: string) => void;
  usedCellKeys?: Set<string>;
  activeCellKeys?: Set<string>;
  cellOwners?: Map<string, string[]>;
  pickHint?: string;
  onPick: (pick: FormCellPick) => void;
  onOpenOwner?: (ownerId: string, pick: FormCellPick) => void;
}) {
  const [formIds, setFormIds] = useState<string[]>([]);
  const [formLabels, setFormLabels] = useState<Record<string, string>>({});
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [navStack, setNavStack] = useState<string[]>([]);
  const [returnAfterPick, setReturnAfterPick] = useState(true);
  const [formPickerFor, setFormPickerFor] = useState<string | null>(null);
  const [formPickerQuery, setFormPickerQuery] = useState("");
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
    setMenuKey(null);
    setFormPickerFor(null);
    setFormPickerQuery("");
    setRowFilter("");
  }, [gridFormId]);

  useEffect(() => {
    setNavStack([]);
    setFormPickerFor(null);
  }, [workspaceFormId]);

  useEffect(() => {
    if (!formPickerFor) return;
    const t = window.setTimeout(() => pickerSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [formPickerFor]);

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
      setFormPickerFor(null);
      setMenuKey(null);
      return;
    }
    if (gridFormId) {
      setNavStack((stack) =>
        stack[stack.length - 1] === gridFormId ? stack : [...stack, gridFormId]
      );
    }
    onGridFormIdChange(targetFormId);
    setFormPickerFor(null);
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

  const pickCell = (rowNo: string, columnKey: string) => {
    if (!gridFormId) return;
    onPick({ formId: gridFormId, columnKey, rowNo });
    setMenuKey(null);
    if (returnAfterPick && awayFromHome) returnToPreviousSheet();
  };

  const openFormPicker = (anchorKey: string) => {
    setMenuKey(anchorKey);
    setFormPickerFor(anchorKey);
    setFormPickerQuery("");
  };

  const renderFormPicker = () => (
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
        onClick={() => {
          setFormPickerFor(null);
          setFormPickerQuery("");
        }}
      >
        Отмена
      </button>
    </div>
  );

  return (
    <div className="checks-cell-picker">
      <div className="checks-cell-picker-head">
        <strong>Таблица ячеек</strong>
        <span className="tools-hint">{pickHint}</span>
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
            <span className="tools-hint">
              Клик по ячейке выберет её
              {returnAfterPick ? " и вернёт на исходный лист" : ""}
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
            {awayFromHome && homeFormId && navStack.length > 1 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={returnHome}
              >
                На исходный лист
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="checks-cell-picker-controls">
        <label>
          Текущий лист (форма)
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
        <div className="checks-cell-picker-goto">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!gridFormId}
            onClick={() => openFormPicker("__toolbar__")}
          >
            Другая форма…
          </button>
          {formPickerFor === "__toolbar__" ? renderFormPicker() : null}
        </div>
      </div>

      <div className="checks-cell-picker-legend" aria-hidden>
        <span>
          <i className="checks-cell-swatch is-used" /> занято правилами
        </span>
        <span>
          <i className="checks-cell-swatch is-active" /> в текущем правиле
        </span>
      </div>

      {error ? <p className="error-box">{error}</p> : null}
      {loading ? <p className="loading">Загрузка формы…</p> : null}

      {schema && !loading ? (
        columns.length === 0 ? (
          <p className="tools-hint">В форме нет числовых граф.</p>
        ) : (
          <div
            ref={scrollRef}
            className="checks-cell-picker-grid-wrap rash-binding-grid-wrap"
          >
            <table className="checks-table rash-binding-grid checks-cell-picker-grid">
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
                      style={{ height: ROW_HEIGHT }}
                    >
                      <td title={row.name}>
                        <strong>{rowNo}</strong>
                        {row.name ? ` — ${row.name}` : ""}
                      </td>
                      {columns.map((column) => {
                        const key = formCellKey(rowNo, column.key);
                        const isActive = activeCellKeys?.has(key) ?? false;
                        const isUsed = usedCellKeys?.has(key) ?? false;
                        const owners = cellOwners?.get(key) ?? [];
                        const isBound = isActive || isUsed;
                        const pick: FormCellPick = {
                          formId: gridFormId,
                          columnKey: column.key,
                          rowNo,
                        };
                        const cls = [
                          "checks-cell-picker-cell",
                          isActive ? "is-active" : "",
                          !isActive && isUsed ? "is-used" : "",
                          awayFromHome ? "is-foreign-sheet" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const menuOpen = menuKey === key;

                        return (
                          <td key={column.key} className="checks-cell-slot">
                            <div className="checks-cell-slot-inner">
                              <button
                                type="button"
                                className={cls}
                                title={`${pick.formId} · ${column.key} · ${rowNo}`}
                                aria-label={`Строка ${rowNo}, графа ${column.key}`}
                                onClick={() => pickCell(rowNo, column.key)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setFormPickerFor(null);
                                  setMenuKey(menuOpen ? null : key);
                                }}
                              >
                                {isBound ? "●" : "+"}
                              </button>
                              <button
                                type="button"
                                className="checks-cell-act checks-cell-act-menu"
                                title="Меню"
                                aria-label="Меню ячейки"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFormPickerFor(null);
                                  setMenuKey(menuOpen ? null : key);
                                }}
                              >
                                ⋯
                              </button>
                            </div>
                            {menuOpen ? (
                              formPickerFor === key ? (
                                renderFormPicker()
                              ) : (
                                <div className="checks-cell-menu" role="menu">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => pickCell(rowNo, column.key)}
                                  >
                                    Выбрать ячейку
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="checks-cell-menu-accent"
                                    onClick={() => openFormPicker(key)}
                                  >
                                    Ячейка другой формы…
                                  </button>
                                  {owners.map((id) => (
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
                                </div>
                              )
                            ) : null}
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
