import { useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog, loadSchema } from "../../api";
import { useVirtualRows } from "../../hooks/useVirtualRows";
import type { FormSchema } from "../../types";

export type CellPickTarget = "expression" | "expressionAlt";

export type PickedCell = {
  formId: string;
  columnKey: string;
  rowNo: string;
};

const OPERATORS = ["=", "==", ">=", "<=", ">", "<", "+", "-", "and", "or"] as const;
const PICKER_ROW_HEIGHT = 40;

/** Match Cell("form","col",row) including leading zeros in row. */
const CELL_CALL_RE =
  /Cell\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*("?)([^")]+)\3\s*\)/gi;

export function formatCellCall(pick: PickedCell): string {
  const col = pick.columnKey.replace(/"/g, "");
  const row = pick.rowNo.trim();
  const rowLit = /^-?\d+(\.\d+)?$/.test(row) ? row : JSON.stringify(row);
  return `Cell(${JSON.stringify(pick.formId)},${JSON.stringify(col)},${rowLit})`;
}

export function cellKey(rowNo: string | number, columnKey: string): string {
  return `${String(rowNo).trim()}:${columnKey}`;
}

function rowEquals(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim() === b.trim();
}

function cellMatchesCall(
  form: string,
  column: string,
  rowRaw: string,
  pick: PickedCell
): boolean {
  return (
    form === pick.formId &&
    column === pick.columnKey &&
    rowEquals(rowRaw, pick.rowNo)
  );
}

function cleanupExpression(expr: string): string {
  let s = expr.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\b(and|or)\s+(and|or)\b/gi, "$2");
    s = s.replace(/^\s*(and|or)\s+/i, "");
    s = s.replace(/\s+(and|or)\s*$/i, "");
    s = s.replace(/[+\-*/]\s*[+\-*/]+/g, (m) => m.trim().slice(-1));
    s = s.replace(/^\s*[+\-*/]+/, "");
    s = s.replace(/[+\-*/]+\s*$/, "");
    s = s.replace(/^\s*(==|<=|>=|=|<|>)\s*/, "");
    s = s.replace(/\s*(==|<=|>=|=|<|>)\s*$/, "");
    s = s.replace(/\(\s*\)/g, "");
    s = s.replace(/\s+/g, " ").trim();
  }
  return s;
}

/** Remove all Cell(...) calls matching the pick from an expression. */
export function removeCellCallsFromExpression(
  expression: string,
  pick: PickedCell
): string {
  if (!expression.trim()) return expression;
  const re = new RegExp(CELL_CALL_RE.source, "gi");
  const next = expression.replace(
    re,
    (full, form: string, column: string, _q: string, row: string) =>
      cellMatchesCall(form, column, row, pick) ? "" : full
  );
  return cleanupExpression(next);
}

/** Replace matching Cell(...) calls with another cell. */
export function replaceCellCallsInExpression(
  expression: string,
  from: PickedCell,
  to: PickedCell
): string {
  if (!expression.trim()) return expression;
  const replacement = formatCellCall(to);
  const re = new RegExp(CELL_CALL_RE.source, "gi");
  return expression.replace(
    re,
    (full, form: string, column: string, _q: string, row: string) =>
      cellMatchesCall(form, column, row, from) ? replacement : full
  );
}

export function CellPicker({
  onInsert,
  target,
  onTargetChange,
  workspaceFormId = "",
  gridFormId,
  onGridFormIdChange,
  usedCellKeys,
  activeCellKeys,
  cellOwners,
  onRemoveActive,
  onOpenOwner,
  onRemoveOwner,
  onReplaceCell,
  replaceFrom,
  onReplaceFromChange,
}: {
  onInsert: (text: string) => void;
  target: CellPickTarget;
  onTargetChange: (target: CellPickTarget) => void;
  workspaceFormId?: string;
  gridFormId: string;
  onGridFormIdChange: (formId: string) => void;
  usedCellKeys?: Set<string>;
  activeCellKeys?: Set<string>;
  cellOwners?: Map<string, number[]>;
  onRemoveActive?: (pick: PickedCell) => void;
  onOpenOwner?: (ruleNumber: number, pick: PickedCell) => void;
  onRemoveOwner?: (ruleNumber: number, pick: PickedCell) => void;
  onReplaceCell?: (from: PickedCell, to: PickedCell) => void;
  replaceFrom: PickedCell | null;
  onReplaceFromChange: (pick: PickedCell | null) => void;
}) {
  const [formIds, setFormIds] = useState<string[]>([]);
  const [formLabels, setFormLabels] = useState<Record<string, string>>({});
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowFilter, setRowFilter] = useState("");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  /** Stack of forms left behind (Excel-like sheet navigation while editing formula). */
  const [navStack, setNavStack] = useState<string[]>([]);
  /** After picking a cell on another sheet, jump back automatically. */
  const [returnAfterPick, setReturnAfterPick] = useState(true);
  /** Inline form picker open for cross-sheet link. */
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
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить каталог форм"
          );
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
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить схему"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gridFormId]);

  // Only close menus on sheet change — keep replace / formula navigation.
  useEffect(() => {
    setMenuKey(null);
    setFormPickerFor(null);
    setFormPickerQuery("");
    setRowFilter("");
  }, [gridFormId]);

  // Reset sheet-nav when workspace form changes.
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

  const virtual = useVirtualRows(scrollRef, rows.length, PICKER_ROW_HEIGHT, {
    threshold: 40,
  });

  const homeFormId = workspaceFormId || navStack[0] || "";
  const awayFromHome = Boolean(
    homeFormId && gridFormId && gridFormId !== homeFormId
  );
  const canReturn = navStack.length > 0 || awayFromHome;

  const goToForm = (targetFormId: string, opts?: { push?: boolean }) => {
    if (!targetFormId || targetFormId === gridFormId) {
      setFormPickerFor(null);
      setMenuKey(null);
      return;
    }
    if (opts?.push !== false && gridFormId) {
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
    const pick: PickedCell = { formId: gridFormId, columnKey, rowNo };
    if (replaceFrom) {
      onReplaceCell?.(replaceFrom, pick);
      onReplaceFromChange(null);
      setMenuKey(null);
      if (returnAfterPick && canReturn) returnToPreviousSheet();
      return;
    }
    onInsert(formatCellCall(pick));
    setMenuKey(null);
    if (returnAfterPick && awayFromHome) returnToPreviousSheet();
  };

  const openFormPicker = (anchorKey: string) => {
    setMenuKey(anchorKey);
    setFormPickerFor(anchorKey);
    setFormPickerQuery("");
  };

  const replaceKey =
    replaceFrom && replaceFrom.formId === gridFormId
      ? cellKey(replaceFrom.rowNo, replaceFrom.columnKey)
      : null;

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

  const renderCellMenu = (
    key: string,
    pick: PickedCell,
    isActive: boolean,
    isUsed: boolean,
    owners: number[],
    rowNo: string,
    columnKey: string
  ) => {
    if (menuKey !== key) return null;
    if (formPickerFor === key) return renderFormPicker();

    return (
      <div className="checks-cell-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          onClick={() => pickCell(rowNo, columnKey)}
        >
          Вставить в выражение
        </button>
        <button
          type="button"
          role="menuitem"
          className="checks-cell-menu-accent"
          onClick={() => openFormPicker(key)}
        >
          Связать с другой формой…
        </button>
        {isActive ? (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onReplaceFromChange(pick);
                setMenuKey(null);
              }}
            >
              Заменить на ячейку этого листа…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onReplaceFromChange(pick);
                openFormPicker(key);
              }}
            >
              Заменить на ячейку другой формы…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRemoveActive?.(pick);
                setMenuKey(null);
              }}
            >
              Удалить из выражения
            </button>
          </>
        ) : null}
        {owners.map((num) => (
          <button
            key={num}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenOwner?.(num, pick);
              setMenuKey(null);
            }}
          >
            Открыть увязку №{num}
          </button>
        ))}
        {!isActive && isUsed && owners[0] != null ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRemoveOwner?.(owners[0], pick);
              setMenuKey(null);
            }}
          >
            Удалить из увязки №{owners[0]}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="checks-cell-picker">
      <div className="checks-cell-picker-head">
        <strong>Таблица ячеек</strong>
        <span className="tools-hint">
          «+» — вставить. ПКМ или «⋯» — меню, в т.ч. связь с другой формой.
        </span>
      </div>

      {(awayFromHome || replaceFrom || navStack.length > 0) && (
        <div
          className={`checks-formula-sheetbar${awayFromHome ? " is-away" : ""}`}
        >
          <div className="checks-formula-sheetbar-main">
            <span className="checks-formula-sheetbar-label">
              {replaceFrom
                ? "Замена ячейки в формуле"
                : "Набор формулы"}
            </span>
            <span>
              Лист:{" "}
              <strong>{gridFormId || "—"}</strong>
              {homeFormId && gridFormId !== homeFormId ? (
                <>
                  {" "}
                  · исходный: <strong>{homeFormId}</strong>
                </>
              ) : null}
            </span>
            {replaceFrom ? (
              <span className="tools-hint">
                вместо {replaceFrom.formId} · {replaceFrom.columnKey} ·{" "}
                {replaceFrom.rowNo}
              </span>
            ) : (
              <span className="tools-hint">
                Клик по ячейке вставит ссылку в выражение
              </span>
            )}
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
            {replaceFrom ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onReplaceFromChange(null)}
              >
                Отмена замены
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
                {workspaceFormId && id === workspaceFormId
                  ? " (исходная)"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Вставлять в
          <select
            value={target}
            onChange={(e) => onTargetChange(e.target.value as CellPickTarget)}
          >
            <option value="expression">Основное выражение</option>
            <option value="expressionAlt">Дополнительное выражение</option>
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

      <div className="checks-cell-picker-ops" role="group" aria-label="Операторы">
        {OPERATORS.map((op) => (
          <button
            key={op}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              onInsert(op === "and" || op === "or" ? ` ${op} ` : op)
            }
          >
            {op}
          </button>
        ))}
      </div>

      <div className="checks-cell-picker-legend" aria-hidden>
        <span>
          <i className="checks-cell-swatch is-used" /> в увязках формы
        </span>
        <span>
          <i className="checks-cell-swatch is-active" /> в текущем выражении
        </span>
      </div>

      {error ? <p className="error-box">{error}</p> : null}
      {loading ? <p className="loading">Загрузка формы…</p> : null}

      {schema && !loading ? (
        columns.length === 0 ? (
          <p className="tools-hint">В форме нет числовых граф для увязок.</p>
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
                      style={{ height: PICKER_ROW_HEIGHT }}
                    >
                      <td title={row.name}>
                        <strong>{rowNo}</strong>
                        {row.name ? ` — ${row.name}` : ""}
                      </td>
                      {columns.map((column) => {
                        const key = cellKey(rowNo, column.key);
                        const isActive = activeCellKeys?.has(key) ?? false;
                        const isUsed = usedCellKeys?.has(key) ?? false;
                        const owners = cellOwners?.get(key) ?? [];
                        const isBound = isActive || isUsed;
                        const isReplaceSource = replaceKey === key;
                        const pick: PickedCell = {
                          formId: gridFormId,
                          columnKey: column.key,
                          rowNo,
                        };
                        const cls = [
                          "checks-cell-picker-cell",
                          isActive ? "is-active" : "",
                          !isActive && isUsed ? "is-used" : "",
                          isReplaceSource ? "is-replace-from" : "",
                          replaceFrom && !isReplaceSource
                            ? "is-replace-target"
                            : "",
                          awayFromHome ? "is-foreign-sheet" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return (
                          <td key={column.key} className="checks-cell-slot">
                            <div className="checks-cell-slot-inner">
                              <button
                                type="button"
                                className={cls}
                                title={
                                  awayFromHome
                                    ? `Ссылка с листа ${gridFormId}: Cell("${gridFormId}","${column.key}",${rowNo})`
                                    : isBound
                                      ? `Привязка: ${
                                          owners.length
                                            ? `увязки ${owners.join(", ")}`
                                            : "текущее выражение"
                                        }`
                                      : `Вставить Cell("${gridFormId}","${column.key}",${rowNo})`
                                }
                                aria-label={`Строка ${rowNo}, графа ${column.key}`}
                                onClick={() => {
                                  if (replaceFrom || awayFromHome) {
                                    pickCell(rowNo, column.key);
                                    return;
                                  }
                                  pickCell(rowNo, column.key);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setFormPickerFor(null);
                                  setMenuKey(menuKey === key ? null : key);
                                }}
                              >
                                {isBound ? "●" : "+"}
                              </button>
                              <button
                                type="button"
                                className="checks-cell-act checks-cell-act-menu"
                                title="Меню ячейки"
                                aria-label="Меню ячейки"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFormPickerFor(null);
                                  setMenuKey(menuKey === key ? null : key);
                                }}
                              >
                                ⋯
                              </button>
                              {isBound && !replaceFrom && !awayFromHome ? (
                                <>
                                  <button
                                    type="button"
                                    className="checks-cell-act checks-cell-act-edit"
                                    title="Заменить"
                                    aria-label="Заменить привязку"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuKey(null);
                                      if (isActive) {
                                        onReplaceFromChange(pick);
                                        return;
                                      }
                                      if (owners[0] != null) {
                                        onOpenOwner?.(owners[0], pick);
                                        onReplaceFromChange(pick);
                                      }
                                    }}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    type="button"
                                    className="checks-cell-act checks-cell-act-del"
                                    title="Удалить"
                                    aria-label="Удалить привязку"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuKey(null);
                                      if (isActive) {
                                        onRemoveActive?.(pick);
                                        return;
                                      }
                                      if (owners[0] != null) {
                                        onRemoveOwner?.(owners[0], pick);
                                      }
                                    }}
                                  >
                                    ×
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {renderCellMenu(
                              key,
                              pick,
                              isActive,
                              isUsed,
                              owners,
                              rowNo,
                              column.key
                            )}
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
        <p className="tools-hint">
          Выберите форму, чтобы показать таблицу ячеек.
        </p>
      ) : null}
    </div>
  );
}
