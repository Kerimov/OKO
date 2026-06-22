import { useMemo } from "react";
import type { FormColumn, KontrAgent, RowData } from "../types";
import { cellErrorKey } from "../engine/cellErrors";

interface Props {
  columns: FormColumn[];
  rows: RowData[];
  onChange: (rows: RowData[]) => void;
  allowAddRows?: boolean;
  kontrMode?: boolean;
  kontrAgents?: KontrAgent[];
  cellErrors?: Map<string, string>;
  readOnly?: boolean;
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
}: Props) {
  const kontrListId = useMemo(
    () => (kontrMode ? `kontr-list-${Math.random().toString(36).slice(2)}` : undefined),
    [kontrMode]
  );

  const updateCell = (rowIdx: number, key: string, value: string) => {
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r));
    onChange(next);
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

  return (
    <div className="table-wrap">
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
                const kontrEditable = !readOnly && kontrMode && col.key === "name" && isKontrEditableRow(row);
                const readonly = readOnly || (col.readonly && !kontrEditable);

                return (
                  <td
                    key={col.key}
                    className={`${col.frozen ? "frozen" : ""}${errMsg ? " cell-error" : ""}`}
                    title={errMsg}
                  >
                    {readonly ? (
                      <span className="readonly-cell">{String(row[col.key] ?? "")}</span>
                    ) : kontrEditable ? (
                      <input
                        type="text"
                        list={kontrListId}
                        value={String(row[col.key] ?? "")}
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
