import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
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
import {
  isSpreadsheetGridEnabled,
  SpreadsheetFormTable,
} from "./SpreadsheetFormTable";
import { isUniverBackendEnabled } from "./spreadsheetFlags";

const UniverFormHost = lazy(() =>
  import("./UniverFormHost").then((m) => ({ default: m.UniverFormHost }))
);

export interface CellFocusInfo {
  rowIndex: number;
  rowNo: number;
  /** Ключ для presence (для строки контрагента — `*`). */
  columnKey: string;
  /** Фактическая колонка для синхронизации значения. */
  editColumnKey: string;
  kontrRowLock: boolean;
}

export interface CellBlurInfo extends CellFocusInfo {
  saveColumnKey: string;
  value: string;
}

export interface CellEditInfo {
  rowIndex: number;
  rowNo: number;
  saveColumnKey: string;
  value: string;
}

interface Props {
  columns: FormColumn[];
  rows: RowData[];
  onChange: (rows: RowData[]) => void;
  formId?: string;
  allowAddRows?: boolean;
  rowKinds?: Array<"data" | "header" | "total" | "section" | "hidden" | null | undefined>;
  cellFormulas?: Map<string, string>;
  kontrMode?: boolean;
  kontrAgents?: KontrAgent[];
  kontrRefA1Name?: string | null;
  rashThresholds?: RashThresholds;
  cellErrors?: Map<string, string>;
  readOnly?: boolean;
  /** Десктоп: ячейки, занятые другими пользователями (ключ `${rowNo}:${column}`). */
  occupiedCells?: Map<string, string>;
  /** Имена пользователей с открытой формой (панель «В комплекте»). */
  presenceUsers?: string[];
  /** Десктоп: недавно изменённые другим пользователем. */
  highlightedCells?: Set<string>;
  onCellFocus?: (info: CellFocusInfo) => void;
  onCellBlur?: (info: CellBlurInfo) => void;
  /** Десктоп: промежуточное сохранение при вводе (debounce на стороне клиента). */
  onCellEdit?: (info: CellEditInfo) => void;
  /** Ячейки с кнопкой расшифровки [...] (pattern B). */
  rashSlots?: RashCellSlot[];
  rashEntryCounts?: Map<string, number>;
  onRashOpen?: (slot: RashCellSlot, rowIndex: number) => void;
  /** Ячейки, заполняемые только из расшифровки (t_ras). */
  rashReadonlyCells?: Set<string>;
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

export function FormTable(props: Props) {
  const canUseUniver =
    isUniverBackendEnabled() &&
    isSpreadsheetGridEnabled() &&
    !props.kontrMode &&
    !(props.rashSlots && props.rashSlots.length > 0);

  if (canUseUniver && props.formId) {
    return (
      <Suspense fallback={<div className="muted">Загрузка Univer…</div>}>
        <UniverFormHost
          formId={props.formId}
          columns={props.columns}
          rows={props.rows}
          readOnly={props.readOnly || props.designerMode}
          onChange={props.designerMode ? undefined : props.onChange}
        />
      </Suspense>
    );
  }

  if (isSpreadsheetGridEnabled()) {
    return <SpreadsheetFormTable {...props} />;
  }
  return <LegacyFormTable {...props} />;
}

function LegacyFormTable({
  columns,
  rows,
  onChange,
  allowAddRows,
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
}: Props) {
  const [kontrShowFilter, setKontrShowFilter] = useState("1,2");

  const kontrShowOptions = useMemo(
    () => kontrShowOptionsForRule(kontrRefA1Name),
    [kontrRefA1Name]
  );

  useEffect(() => {
    if (kontrRefA1Name) {
      setKontrShowFilter(defaultKontrShowFilter(kontrRefA1Name));
    }
  }, [kontrRefA1Name]);

  const visibleKontrAgents = useMemo(() => {
    if (!kontrMode) return kontrAgents;
    return filterKontrByShow(kontrAgents, kontrRefA1Name, kontrShowFilter);
  }, [kontrAgents, kontrMode, kontrRefA1Name, kontrShowFilter]);

  const kontrOrgTypes = useMemo(() => {
    const opt = kontrShowOptions.find((o) => o.id === kontrShowFilter);
    return opt?.orgTypes;
  }, [kontrShowOptions, kontrShowFilter]);

  const kontrListId = useMemo(
    () => (kontrMode ? `kontr-list-${Math.random().toString(36).slice(2)}` : undefined),
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

  const resolveRowNo = (row: RowData, index: number): number => {
    const parsed = parseInt(String(row.num ?? "").trim(), 10);
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
    return 900_000_000 + index;
  };

  const updateCell = (rowIdx: number, key: string, value: string) => {
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r));
    onChange(next);
    if (onCellEdit) {
      onCellEdit({
        rowIndex: rowIdx,
        rowNo: resolveRowNo(rows[rowIdx], rowIdx),
        saveColumnKey: key,
        value,
      });
    }
  };

  const pickKontr = (rowIdx: number, agent: KontrAgent) => {
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
    onChange(next);
  };

  const addRow = () => {
    const empty: RowData = {};
    for (const col of columns) empty[col.key] = "";
    if (!kontrMode) {
      onChange([...rows, empty]);
      return;
    }
    const insertAt = kontrInsertIndex(rows);
    const next = [...rows];
    next.splice(insertAt, 0, empty);
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  const isKontrEditableRow = (row: RowData) =>
    kontrMode && !String(row.num ?? "").trim();

  const userHue = (name: string): number => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return Math.abs(hash) % 360;
  };

  const userPresenceStyle = (name: string): CSSProperties => {
    const hue = userHue(name);
    return {
      "--presence-color": `hsl(${hue} 65% 38%)`,
      "--presence-bg": `hsl(${hue} 55% 92%)`,
    } as CSSProperties;
  };

  const cellPresenceKey = (row: RowData, rowIdx: number, colKey: string): string =>
    `${resolveRowNo(row, rowIdx)}:${colKey}`;

  const occupancyUser = (row: RowData, rowIdx: number, colKey: string): string | null => {
    if (!occupiedCells?.size) return null;
    const rowNo = resolveRowNo(row, rowIdx);
    const direct = occupiedCells.get(`${rowNo}:${colKey}`);
    if (direct) return direct;
    if (kontrMode && isKontrEditableRow(row)) {
      return occupiedCells.get(`${rowNo}:*`) ?? null;
    }
    return null;
  };

  const emitFocus = (rowIdx: number, row: RowData, colKey: string) => {
    if (!onCellFocus) return;
    const kontrRowLock = !!(kontrMode && isKontrEditableRow(row));
    onCellFocus({
      rowIndex: rowIdx,
      rowNo: resolveRowNo(row, rowIdx),
      columnKey: kontrRowLock ? "*" : colKey,
      editColumnKey: colKey,
      kontrRowLock,
    });
  };

  const emitBlur = (rowIdx: number, row: RowData, colKey: string) => {
    if (!onCellBlur) return;
    const kontrRowLock = !!(kontrMode && isKontrEditableRow(row));
    onCellBlur({
      rowIndex: rowIdx,
      rowNo: resolveRowNo(row, rowIdx),
      columnKey: kontrRowLock ? "*" : colKey,
      editColumnKey: colKey,
      kontrRowLock,
      saveColumnKey: colKey,
      value: String(row[colKey] ?? ""),
    });
  };

  return (
    <div className="table-wrap">
      {presenceUsers.length > 0 && (
        <div className="presence-bar" aria-label="Пользователи на форме">
          <span className="presence-bar-label">В форме:</span>
          {presenceUsers.map((name) => (
            <span
              key={name}
              className="presence-chip"
              style={userPresenceStyle(name)}
            >
              {name}
            </span>
          ))}
        </div>
      )}
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
      <table className="form-table">
        <thead>
          <tr>
            <th className="row-num">#</th>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ minWidth: col.width ?? 100 }}
                className={col.frozen ? "frozen" : ""}
                title={col.label}
              >
                <span className="col-letter">{col.key}</span>
                <span className="col-label">{col.label}</span>
              </th>
            ))}
            {(allowAddRows || kontrMode) && <th className="actions-col" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              <td className="row-num">{rowIdx + 1}</td>
              {columns.map((col) => {
                const errKey = cellErrorKey(row, rowIdx, col.key);
                const errMsg = cellErrors?.get(errKey);
                const syncKey = cellPresenceKey(row, rowIdx, col.key);
                const kontrEditable = !readOnly && kontrMode && col.key === "name" && isKontrEditableRow(row);
                const occupiedBy = occupancyUser(row, rowIdx, col.key);
                const occupied = !!occupiedBy;
                const rowNum = String(row.num ?? "").trim();
                const rashLocked =
                  !!rowNum && !!rashReadonlyCells?.has(`${rowNum}:${col.key}`);
                const readonly =
                  readOnly || occupied || rashLocked || (col.readonly && !kontrEditable);
                const flash = highlightedCells?.has(syncKey);
                const rashSlot = rowNum
                  ? rashSlotMap.get(`${rowNum}:${col.key}`)
                  : undefined;
                const rashCount =
                  rashSlot && rashEntryCounts
                    ? rashEntryCounts.get(
                        rashGroupKey(rashSlot.rowNum, rashSlot.rashKod)
                      ) ??
                      rashEntryCounts.get(
                        rashSlotKey(rashSlot.rowNum, rashSlot.columnKey, rashSlot.rashKod)
                      ) ??
                      0
                    : 0;

                const rashVisible =
                  rashSlot &&
                  (!rashThresholds ||
                    rashSlotVisible(rashSlot, row, rashThresholds, rashEntryCounts));

                const showRashBtn =
                  !!rashSlot &&
                  !!onRashOpen &&
                  (rashLocked || rashVisible);

                const rashBtn = showRashBtn ? (
                  <button
                    type="button"
                    className={`rash-cell-btn${rashCount > 0 ? " has-entries" : ""}`}
                    onClick={() => onRashOpen!(rashSlot!, rowIdx)}
                    title={
                      rashCount > 0
                        ? `Расшифровка (${rashCount} контрагентов)`
                        : "Расшифровка контрагентов"
                    }
                  >
                    …
                  </button>
                ) : null;

                return (
                  <td
                    key={col.key}
                    className={`${col.frozen ? "frozen" : ""}${errMsg ? " cell-error" : ""}${occupied ? " cell-occupied" : ""}${flash ? " cell-remote-flash" : ""}`}
                    title={occupiedBy ? `Занято: ${occupiedBy}` : errMsg}
                    style={occupiedBy ? userPresenceStyle(occupiedBy) : undefined}
                  >
                    {rashLocked && rashSlot ? (
                      <div className="cell-with-rash">
                        <span className="readonly-cell rash-locked-value">
                          {String(row[col.key] ?? "")}
                        </span>
                        {rashBtn}
                      </div>
                    ) : readonly ? (
                      <span className={`readonly-cell${occupied ? " occupied-cell" : ""}`}>
                        {String(row[col.key] ?? "")}
                        {occupiedBy && (
                          <span className="presence-badge" title={occupiedBy}>
                            {occupiedBy}
                          </span>
                        )}
                      </span>
                    ) : kontrEditable ? (
                      <KontrInput
                        value={String(row[col.key] ?? "")}
                        listId={kontrListId!}
                        agents={visibleKontrAgents}
                        orgTypes={kontrOrgTypes}
                        className="kontr-input"
                        placeholder="Контрагент…"
                        onChange={(v) => updateCell(rowIdx, col.key, v)}
                        onPick={(agent) => pickKontr(rowIdx, agent)}
                        onFocus={() => emitFocus(rowIdx, row, col.key)}
                        onBlur={() => emitBlur(rowIdx, row, col.key)}
                      />
                    ) : (
                      <div className="cell-with-rash">
                        <input
                          type="text"
                          inputMode={col.type === "number" ? "decimal" : "text"}
                          value={String(row[col.key] ?? "")}
                          onFocus={() => emitFocus(rowIdx, row, col.key)}
                          onBlur={() => emitBlur(rowIdx, row, col.key)}
                          onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                          className={col.type === "number" ? "num-input" : ""}
                        />
                        {rashBtn}
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
          ))}
        </tbody>
      </table>
      {(allowAddRows || kontrMode) && !readOnly && (
        <button type="button" className="btn btn-secondary add-row-btn" onClick={addRow}>
          + {kontrMode ? "Добавить контрагента" : "Добавить строку"}
        </button>
      )}
    </div>
  );
}
