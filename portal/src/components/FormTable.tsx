import { useMemo, type CSSProperties } from "react";
import type { FormColumn, KontrAgent, RowData } from "../types";
import { cellErrorKey } from "../engine/cellErrors";

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
  allowAddRows?: boolean;
  kontrMode?: boolean;
  kontrAgents?: KontrAgent[];
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
}

export function FormTable({
  columns,
  rows,
  onChange,
  allowAddRows,
  kontrMode,
  kontrAgents = [],
  cellErrors,
  readOnly = false,
  occupiedCells,
  presenceUsers = [],
  highlightedCells,
  onCellFocus,
  onCellBlur,
  onCellEdit,
}: Props) {
  const kontrListId = useMemo(
    () => (kontrMode ? `kontr-list-${Math.random().toString(36).slice(2)}` : undefined),
    [kontrMode]
  );

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
    onChange([...rows, empty]);
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
      {kontrMode && kontrListId && (
        <datalist id={kontrListId}>
          {kontrAgents.map((k) => (
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
                const readonly = readOnly || occupied || (col.readonly && !kontrEditable);
                const flash = highlightedCells?.has(syncKey);

                return (
                  <td
                    key={col.key}
                    className={`${col.frozen ? "frozen" : ""}${errMsg ? " cell-error" : ""}${occupied ? " cell-occupied" : ""}${flash ? " cell-remote-flash" : ""}`}
                    title={occupiedBy ? `Занято: ${occupiedBy}` : errMsg}
                    style={occupiedBy ? userPresenceStyle(occupiedBy) : undefined}
                  >
                    {readonly ? (
                      <span className={`readonly-cell${occupied ? " occupied-cell" : ""}`}>
                        {String(row[col.key] ?? "")}
                        {occupiedBy && (
                          <span className="presence-badge" title={occupiedBy}>
                            {occupiedBy}
                          </span>
                        )}
                      </span>
                    ) : kontrEditable ? (
                      <input
                        type="text"
                        list={kontrListId}
                        value={String(row[col.key] ?? "")}
                        onFocus={() => emitFocus(rowIdx, row, col.key)}
                        onBlur={() => emitBlur(rowIdx, row, col.key)}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateCell(rowIdx, col.key, v);
                          const agent = kontrAgents.find((k) => k.name === v);
                          if (agent) pickKontr(rowIdx, agent);
                        }}
                        className="kontr-input"
                        placeholder="Контрагент…"
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode={col.type === "number" ? "decimal" : "text"}
                        value={String(row[col.key] ?? "")}
                        onFocus={() => emitFocus(rowIdx, row, col.key)}
                        onBlur={() => emitBlur(rowIdx, row, col.key)}
                        onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                        className={col.type === "number" ? "num-input" : ""}
                      />
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
