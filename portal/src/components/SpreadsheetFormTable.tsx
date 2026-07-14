import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  buildSheetModel,
  makeRowId,
  type RangeSelection,
} from "@oko/spreadsheet";
import type { FormColumn, KontrAgent, RashThresholds, RowData } from "../types";
import type { RashCellSlot } from "../engine/rashEngine";
import {
  defaultKontrShowFilter,
  filterKontrByShow,
  kontrInsertIndex,
  kontrShowOptionsForRule,
  rashSlotKey,
  rashGroupKey,
  rashSlotVisible,
} from "../engine/rashEngine";
import { cellErrorKey } from "../engine/cellErrors";
import { KontrInput } from "./KontrInput";
import type {
  CellBlurInfo,
  CellEditInfo,
  CellFocusInfo,
} from "./FormTable";

export interface SpreadsheetFormTableProps {
  columns: FormColumn[];
  rows: RowData[];
  onChange: (rows: RowData[]) => void;
  formId?: string;
  allowAddRows?: boolean;
  /** Optional template row kinds by row index (header/section/total). */
  rowKinds?: Array<"data" | "header" | "total" | "section" | "hidden" | null | undefined>;
  /** Per-cell A1 formulas keyed `${rowIndex}:${columnKey}` or stable rowNo:col. */
  cellFormulas?: Map<string, string>;
  kontrMode?: boolean;
  kontrAgents?: KontrAgent[];
  kontrRefA1Name?: string | null;
  rashThresholds?: RashThresholds;
  cellErrors?: Map<string, string>;
  readOnly?: boolean;
  occupiedCells?: Map<string, string>;
  presenceUsers?: string[];
  highlightedCells?: Set<string>;
  onCellFocus?: (info: CellFocusInfo) => void;
  onCellBlur?: (info: CellBlurInfo) => void;
  onCellEdit?: (info: CellEditInfo) => void;
  rashSlots?: RashCellSlot[];
  rashEntryCounts?: Map<string, number>;
  onRashOpen?: (slot: RashCellSlot, rowIndex: number) => void;
  rashReadonlyCells?: Set<string>;
  /** Designer mode: show formula bar and allow editing formulas callback. */
  designerMode?: boolean;
  onFormulaCommit?: (info: {
    rowIndex: number;
    columnKey: string;
    formula: string;
  }) => void;
  onSelectionChange?: (info: {
    rowIndex: number;
    columnKey: string;
    rowNo: string;
  } | null) => void;
}

function resolveRowNo(row: RowData, index: number): number {
  const parsed = parseInt(String(row.num ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  return 900_000_000 + index;
}

function inRange(
  r: number,
  c: number,
  sel: { r0: number; c0: number; r1: number; c1: number }
): boolean {
  return r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
}

/**
 * Excel-like managed form grid: selection, keyboard nav, clipboard, formula bar.
 * Formula evaluation for sheet formulas uses @oko/spreadsheet; domain recalc stays in @oko/engine.
 */
export function SpreadsheetFormTable({
  columns,
  rows,
  onChange,
  formId = "form",
  allowAddRows,
  rowKinds,
  cellFormulas,
  kontrMode,
  kontrAgents = [],
  kontrRefA1Name,
  rashThresholds,
  cellErrors,
  readOnly = false,
  occupiedCells,
  presenceUsers = [],
  highlightedCells,
  onCellFocus,
  onCellBlur,
  onCellEdit,
  rashSlots = [],
  rashEntryCounts,
  onRashOpen,
  rashReadonlyCells,
  designerMode = false,
  onFormulaCommit,
  onSelectionChange,
}: SpreadsheetFormTableProps) {
  const visibleCols = useMemo(
    () => columns.filter((c) => !c.hidden),
    [columns]
  );
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [formulaBar, setFormulaBar] = useState("");
  const [undoStack, setUndoStack] = useState<RowData[][]>([]);
  const [redoStack, setRedoStack] = useState<RowData[][]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [kontrShowFilter, setKontrShowFilter] = useState("1,2");
  const kontrShowOptions = useMemo(
    () => kontrShowOptionsForRule(kontrRefA1Name),
    [kontrRefA1Name]
  );
  useEffect(() => {
    if (kontrRefA1Name) setKontrShowFilter(defaultKontrShowFilter(kontrRefA1Name));
  }, [kontrRefA1Name]);

  const visibleKontrAgents = useMemo(() => {
    if (!kontrMode) return kontrAgents;
    return filterKontrByShow(kontrAgents, kontrRefA1Name, kontrShowFilter);
  }, [kontrAgents, kontrMode, kontrRefA1Name, kontrShowFilter]);

  const kontrListId = useMemo(
    () => (kontrMode ? `kontr-list-ss-${Math.random().toString(36).slice(2)}` : undefined),
    [kontrMode]
  );

  const rashSlotMap = useMemo(() => {
    const map = new Map<string, RashCellSlot>();
    for (const slot of rashSlots) {
      const display = slot.displayColumnKey ?? slot.columnKey;
      map.set(`${slot.rowNum}:${display}`, slot);
    }
    return map;
  }, [rashSlots]);

  const selection = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return {
      r0: Math.min(a.r, active.r),
      c0: Math.min(a.c, active.c),
      r1: Math.max(a.r, active.r),
      c1: Math.max(a.c, active.c),
    };
  }, [active, anchor]);

  const pushUndo = useCallback((prev: RowData[]) => {
    setUndoStack((s) => [...s.slice(-49), prev.map((r) => ({ ...r }))]);
    setRedoStack([]);
  }, []);

  const commitRows = useCallback(
    (next: RowData[], recordUndo = true) => {
      if (recordUndo) pushUndo(rows);
      onChange(next);
    },
    [onChange, pushUndo, rows]
  );

  const updateCell = (rowIdx: number, key: string, value: string, recordUndo = true) => {
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r));
    commitRows(next, recordUndo);
    onCellEdit?.({
      rowIndex: rowIdx,
      rowNo: resolveRowNo(rows[rowIdx], rowIdx),
      saveColumnKey: key,
      value,
    });
  };

  const beginEdit = (r: number, c: number, initial?: string) => {
    if (readOnly) return;
    const col = visibleCols[c];
    if (!col || col.readonly) return;
    setActive({ r, c });
    setEditing(true);
    const val = initial ?? String(rows[r]?.[col.key] ?? "");
    setDraft(val);
    setFormulaBar(val);
  };

  const endEdit = (save: boolean) => {
    if (!editing || !active) {
      setEditing(false);
      return;
    }
    const col = visibleCols[active.c];
    if (save && col) {
      const value = draft;
      if (designerMode && value.trim().startsWith("=")) {
        onFormulaCommit?.({
          rowIndex: active.r,
          columnKey: col.key,
          formula: value.trim(),
        });
      } else {
        updateCell(active.r, col.key, value);
      }
    }
    setEditing(false);
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  useEffect(() => {
    if (!onSelectionChange) return;
    if (!active) {
      onSelectionChange(null);
      return;
    }
    const col = visibleCols[active.c];
    if (!col) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      rowIndex: active.r,
      columnKey: col.key,
      rowNo: String(rows[active.r]?.num ?? "").trim(),
    });
  }, [active, onSelectionChange, rows, visibleCols]);

  useEffect(() => {
    if (!active) return;
    const col = visibleCols[active.c];
    if (!col) return;
    const formulaKey = `${active.r}:${col.key}`;
    const formula =
      cellFormulas?.get(formulaKey) ??
      cellFormulas?.get(`${resolveRowNo(rows[active.r], active.r)}:${col.key}`);
    const v = formula?.trim()
      ? formula
      : String(rows[active.r]?.[col.key] ?? "");
    setFormulaBar(v);
  }, [active, rows, visibleCols, cellFormulas]);

  const copySelection = async () => {
    if (!selection) return;
    const lines: string[] = [];
    for (let r = selection.r0; r <= selection.r1; r++) {
      const cells: string[] = [];
      for (let c = selection.c0; c <= selection.c1; c++) {
        const col = visibleCols[c];
        cells.push(String(rows[r]?.[col.key] ?? ""));
      }
      lines.push(cells.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* ignore */
    }
  };

  const pasteTsv = async () => {
    if (readOnly || !active) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
    if (!lines.length) return;
    pushUndo(rows);
    const next = rows.map((r) => ({ ...r }));
    for (let i = 0; i < lines.length; i++) {
      const rr = active.r + i;
      if (rr >= next.length) break;
      const parts = lines[i].split("\t");
      for (let j = 0; j < parts.length; j++) {
        const cc = active.c + j;
        if (cc >= visibleCols.length) break;
        const col = visibleCols[cc];
        if (col.readonly) continue;
        next[rr] = { ...next[rr], [col.key]: parts[j] };
      }
    }
    onChange(next);
  };

  const fillDown = () => {
    if (!selection || readOnly) return;
    pushUndo(rows);
    const next = rows.map((r) => ({ ...r }));
    for (let c = selection.c0; c <= selection.c1; c++) {
      const col = visibleCols[c];
      if (col.readonly) continue;
      const src = String(next[selection.r0]?.[col.key] ?? "");
      for (let r = selection.r0 + 1; r <= selection.r1; r++) {
        next[r] = { ...next[r], [col.key]: src };
      }
    }
    onChange(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!active) return;
    const maxR = rows.length - 1;
    const maxC = visibleCols.length - 1;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void copySelection();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      void pasteTsv();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        const next = redoStack[redoStack.length - 1];
        if (!next) return;
        setRedoStack((s) => s.slice(0, -1));
        setUndoStack((s) => [...s, rows.map((r) => ({ ...r }))]);
        onChange(next);
      } else {
        const prev = undoStack[undoStack.length - 1];
        if (!prev) return;
        setUndoStack((s) => s.slice(0, -1));
        setRedoStack((s) => [...s, rows.map((r) => ({ ...r }))]);
        onChange(prev);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fillDown();
      return;
    }

    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        endEdit(true);
        setActive({ r: Math.min(maxR, active.r + 1), c: active.c });
        setAnchor(null);
      } else if (e.key === "Escape") {
        e.preventDefault();
        endEdit(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        endEdit(true);
        const nc = e.shiftKey ? Math.max(0, active.c - 1) : Math.min(maxC, active.c + 1);
        setActive({ r: active.r, c: nc });
        setAnchor(null);
      }
      return;
    }

    if (e.key === "F2" || e.key === "Enter") {
      e.preventDefault();
      beginEdit(active.r, active.c);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      beginEdit(active.r, active.c, e.key);
      return;
    }

    let nr = active.r;
    let nc = active.c;
    if (e.key === "ArrowUp") nr = Math.max(0, active.r - 1);
    else if (e.key === "ArrowDown") nr = Math.min(maxR, active.r + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, active.c - 1);
    else if (e.key === "ArrowRight") nc = Math.min(maxC, active.c + 1);
    else if (e.key === "Tab") {
      e.preventDefault();
      nc = e.shiftKey ? Math.max(0, active.c - 1) : Math.min(maxC, active.c + 1);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!selection || readOnly) return;
      pushUndo(rows);
      const next = rows.map((r) => ({ ...r }));
      for (let r = selection.r0; r <= selection.r1; r++) {
        for (let c = selection.c0; c <= selection.c1; c++) {
          const col = visibleCols[c];
          if (col.readonly) continue;
          next[r] = { ...next[r], [col.key]: "" };
        }
      }
      onChange(next);
      return;
    } else return;

    e.preventDefault();
    if (e.shiftKey) {
      setActive({ r: nr, c: nc });
      if (!anchor) setAnchor(active);
    } else {
      setActive({ r: nr, c: nc });
      setAnchor(null);
    }
  };

  const onCellMouseDown = (r: number, c: number, e: ReactMouseEvent) => {
    if (editing) endEdit(true);
    if (e.shiftKey && active) {
      setActive({ r, c });
      if (!anchor) setAnchor(active);
    } else {
      setActive({ r, c });
      setAnchor({ r, c });
    }
    wrapRef.current?.focus({ preventScroll: true });
  };

  const addRow = () => {
    const empty: RowData = {};
    for (const col of columns) empty[col.key] = "";
    if (!kontrMode) {
      commitRows([...rows, empty]);
      return;
    }
    const insertAt = kontrInsertIndex(rows, active?.r);
    const next = [...rows];
    next.splice(insertAt, 0, empty);
    commitRows(next);
  };

  const removeRow = (idx: number) => {
    commitRows(rows.filter((_, i) => i !== idx));
  };

  const isKontrEditableRow = (row: RowData) =>
    !!kontrMode && !String(row.num ?? "").trim();

  const occupancyUser = (row: RowData, rowIdx: number, colKey: string): string | null => {
    if (!occupiedCells?.size) return null;
    const rowNo = resolveRowNo(row, rowIdx);
    return (
      occupiedCells.get(`${rowNo}:${colKey}`) ??
      (kontrMode && isKontrEditableRow(row)
        ? occupiedCells.get(`${rowNo}:*`) ?? null
        : null)
    );
  };

  const activeA1 = useMemo(() => {
    if (!active) return "";
    const col = visibleCols[active.c];
    if (!col) return "";
    const letter = /^[A-Z]+$/i.test(col.key)
      ? col.key.toUpperCase()
      : String.fromCharCode(65 + active.c);
    return `${letter}${active.r + 1}`;
  }, [active, visibleCols]);

  // Keep buildSheetModel wired for future Univer host / designer export.
  useMemo(
    () =>
      buildSheetModel({
        schema: {
          id: formId,
          title: formId,
          columns: visibleCols,
          rows: rows.map((r, i) => ({
            num: String(r.num ?? ""),
            name: String(r.name ?? ""),
            rowId: makeRowId(formId, String(r.num ?? ""), i),
          })),
        },
        dataRows: rows,
      }),
    [formId, visibleCols, rows]
  );

  return (
    <div className="table-wrap spreadsheet-wrap">
      {presenceUsers.length > 0 && (
        <div className="presence-bar" aria-label="Пользователи на форме">
          <span className="presence-bar-label">В форме:</span>
          {presenceUsers.map((name) => (
            <span key={name} className="presence-chip">
              {name}
            </span>
          ))}
        </div>
      )}

      <div className="spreadsheet-formula-bar" aria-label="Строка формул">
        <span className="spreadsheet-a1">{activeA1 || "—"}</span>
        <input
          className="spreadsheet-formula-input"
          value={formulaBar}
          disabled={readOnly || !active}
          onChange={(e) => {
            setFormulaBar(e.target.value);
            if (editing) setDraft(e.target.value);
          }}
          onFocus={() => {
            if (active && !editing) beginEdit(active.r, active.c, formulaBar);
          }}
          onBlur={() => endEdit(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              endEdit(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              endEdit(false);
            }
          }}
          placeholder="Значение или =SUM(...)"
        />
      </div>

      {kontrMode && kontrShowOptions.length > 1 && !readOnly && (
        <div className="kontr-table-toolbar">
          <label className="rash-show-filter">
            <span>Показать</span>
            <select
              value={kontrShowFilter}
              onChange={(e) => setKontrShowFilter(e.target.value)}
            >
              {kontrShowOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {kontrMode && kontrListId && visibleKontrAgents.length <= 400 && (
        <datalist id={kontrListId}>
          {visibleKontrAgents.map((k) => (
            <option key={k.id} value={k.name} label={k.inn ? `ИНН ${k.inn}` : undefined} />
          ))}
        </datalist>
      )}

      <div
        ref={wrapRef}
        className="spreadsheet-grid-focus"
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="grid"
        aria-label="Таблица формы"
      >
        <table className="form-table spreadsheet-table">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {visibleCols.map((col) => (
                <th
                  key={col.key}
                  style={{ minWidth: col.width ?? 100 }}
                  className={col.frozen ? "frozen" : ""}
                  title={col.helpText ?? col.label}
                >
                  <span className="col-letter">{col.key}</span>
                  <span className="col-label">{col.label}</span>
                </th>
              ))}
              {(allowAddRows || kontrMode) && <th className="actions-col" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const kind = rowKinds?.[rowIdx] ?? "data";
              const kindClass =
                kind === "header"
                  ? "row-kind-header"
                  : kind === "section"
                    ? "row-kind-section"
                    : kind === "total"
                      ? "row-kind-total"
                      : kind === "hidden"
                        ? "row-kind-hidden"
                        : "";
              return (
              <tr
                key={rowIdx}
                className={`${kindClass}${
                  String(row.num ?? "") === "" && kontrMode ? " row-kontr" : ""
                }`}
              >
                <td className="row-num">{rowIdx + 1}</td>
                {visibleCols.map((col, colIdx) => {
                  const errKey = cellErrorKey(row, rowIdx, col.key);
                  const errMsg = cellErrors?.get(errKey);
                  const occupiedBy = occupancyUser(row, rowIdx, col.key);
                  const rowNum = String(row.num ?? "").trim();
                  const rashLocked =
                    !!rowNum && !!rashReadonlyCells?.has(`${rowNum}:${col.key}`);
                  const selected = selection
                    ? inRange(rowIdx, colIdx, selection)
                    : false;
                  const isActive =
                    active?.r === rowIdx && active?.c === colIdx;
                  const kontrEditable =
                    !readOnly &&
                    kontrMode &&
                    col.key === "name" &&
                    isKontrEditableRow(row);
                  const cellReadonly =
                    readOnly ||
                    !!occupiedBy ||
                    rashLocked ||
                    (col.readonly && !kontrEditable);
                  const rashSlot = rowNum
                    ? rashSlotMap.get(`${rowNum}:${col.key}`)
                    : undefined;
                  const rashCount =
                    rashSlot && rashEntryCounts
                      ? rashEntryCounts.get(
                          rashGroupKey(rashSlot.rowNum, rashSlot.rashKod)
                        ) ??
                        rashEntryCounts.get(
                          rashSlotKey(
                            rashSlot.rowNum,
                            rashSlot.columnKey,
                            rashSlot.rashKod
                          )
                        ) ??
                        0
                      : 0;
                  const flash = highlightedCells?.has(
                    `${resolveRowNo(row, rowIdx)}:${col.key}`
                  );
                  const alignStyle: CSSProperties | undefined =
                    col.align
                      ? { textAlign: col.align }
                      : col.type === "number"
                        ? { textAlign: "right" }
                        : undefined;

                  const showRash =
                    !!rashSlot &&
                    !!onRashOpen &&
                    (rashLocked ||
                      !rashThresholds ||
                      rashSlotVisible(
                        rashSlot,
                        row,
                        rashThresholds,
                        rashEntryCounts
                      ));

                  return (
                    <td
                      key={col.key}
                      className={`${col.frozen ? "frozen" : ""}${
                        errMsg ? " cell-error" : ""
                      }${occupiedBy ? " cell-occupied" : ""}${
                        flash ? " cell-remote-flash" : ""
                      }${selected ? " cell-selected" : ""}${
                        isActive ? " cell-active" : ""
                      }`}
                      style={alignStyle}
                      title={occupiedBy ? `Занято: ${occupiedBy}` : errMsg}
                      onMouseDown={(e) => onCellMouseDown(rowIdx, colIdx, e)}
                      onDoubleClick={() => beginEdit(rowIdx, colIdx)}
                    >
                      {isActive && editing && !cellReadonly ? (
                        <input
                          ref={inputRef}
                          className={col.type === "number" ? "num-input" : ""}
                          value={draft}
                          onChange={(e) => {
                            setDraft(e.target.value);
                            setFormulaBar(e.target.value);
                          }}
                          onBlur={() => {
                            endEdit(true);
                            onCellBlur?.({
                              rowIndex: rowIdx,
                              rowNo: resolveRowNo(row, rowIdx),
                              columnKey: col.key,
                              editColumnKey: col.key,
                              kontrRowLock: false,
                              saveColumnKey: col.key,
                              value: draft,
                            });
                          }}
                        />
                      ) : kontrEditable ? (
                        <KontrInput
                          value={String(row[col.key] ?? "")}
                          listId={kontrListId!}
                          agents={visibleKontrAgents}
                          className="kontr-input"
                          placeholder="Контрагент…"
                          onChange={(v) => updateCell(rowIdx, col.key, v)}
                          onPick={(agent) => {
                            const next = rows.map((r, i) =>
                              i === rowIdx
                                ? {
                                    ...r,
                                    name: agent.name,
                                    kontrId: agent.id,
                                    inn: agent.inn ?? "",
                                    kpp: agent.kpp ?? "",
                                  }
                                : r
                            );
                            commitRows(next);
                          }}
                          onFocus={() =>
                            onCellFocus?.({
                              rowIndex: rowIdx,
                              rowNo: resolveRowNo(row, rowIdx),
                              columnKey: "*",
                              editColumnKey: col.key,
                              kontrRowLock: true,
                            })
                          }
                        />
                      ) : (
                        <div className="cell-with-rash">
                          <span
                            className={
                              cellReadonly
                                ? "readonly-cell"
                                : col.type === "number"
                                  ? "num-input ss-cell-value"
                                  : "ss-cell-value"
                            }
                          >
                            {col.decimals != null &&
                            col.type === "number" &&
                            row[col.key] !== "" &&
                            row[col.key] != null &&
                            Number.isFinite(Number(row[col.key]))
                              ? Number(row[col.key]).toFixed(col.decimals)
                              : String(row[col.key] ?? "")}
                          </span>
                          {showRash && (
                            <button
                              type="button"
                              className={`rash-cell-btn${
                                rashCount > 0 ? " has-entries" : ""
                              }`}
                              onClick={() => onRashOpen!(rashSlot!, rowIdx)}
                            >
                              …
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                {(allowAddRows || kontrMode) && !readOnly && (
                  <td className="actions-col">
                    {allowAddRows || isKontrEditableRow(row) ? (
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => removeRow(rowIdx)}
                        title="Удалить строку"
                      >
                        ×
                      </button>
                    ) : null}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(allowAddRows || kontrMode) && !readOnly && (
        <button type="button" className="btn btn-secondary add-row-btn" onClick={addRow}>
          + {kontrMode ? "Добавить контрагента" : "Добавить строку"}
        </button>
      )}

      <p className="tools-hint spreadsheet-hint">
        Стрелки / Tab / Enter · Ctrl+C/V · Ctrl+D заполнить вниз · Ctrl+Z отмена · F2 правка
        {designerMode ? " · формулы начинаются с =" : ""}
      </p>
    </div>
  );
}

export { isSpreadsheetGridEnabled } from "./spreadsheetFlags";

export type { RangeSelection };
