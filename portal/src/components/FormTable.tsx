import type { FormColumn, RowData } from "../types";

interface Props {
  columns: FormColumn[];
  rows: RowData[];
  onChange: (rows: RowData[]) => void;
  allowAddRows?: boolean;
}

export function FormTable({ columns, rows, onChange, allowAddRows }: Props) {
  const updateCell = (rowIdx: number, key: string, value: string) => {
    const next = rows.map((r, i) =>
      i === rowIdx ? { ...r, [key]: value } : r
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

  return (
    <div className="table-wrap">
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
            {allowAddRows && <th className="actions-col" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              <td className="row-num">{rowIdx + 1}</td>
              {columns.map((col) => (
                <td key={col.key} className={col.frozen ? "frozen" : ""}>
                  {col.readonly ? (
                    <span className="readonly-cell">{String(row[col.key] ?? "")}</span>
                  ) : (
                    <input
                      type={col.type === "number" ? "text" : "text"}
                      inputMode={col.type === "number" ? "decimal" : "text"}
                      value={String(row[col.key] ?? "")}
                      onChange={(e) => updateCell(rowIdx, col.key, e.target.value)}
                      className={col.type === "number" ? "num-input" : ""}
                    />
                  )}
                </td>
              ))}
              {allowAddRows && (
                <td className="actions-col">
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => removeRow(rowIdx)}
                    title="Удалить строку"
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {allowAddRows && (
        <button type="button" className="btn btn-secondary add-row-btn" onClick={addRow}>
          + Добавить строку
        </button>
      )}
    </div>
  );
}
