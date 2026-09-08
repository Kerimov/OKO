import { useMemo, useState } from "react";
import type {
  FormSchema,
  RashModalRow,
  RashModalRowMode,
  RashModalSettings,
} from "../../types";

const MODE_LABELS: Record<RashModalRowMode, string> = {
  dynamic: "Динамические записи",
  fixed: "Фиксированные строки",
  mixed: "Фиксированные + динамические",
};

export function ModalRowsEditor({
  settings,
  rows,
  schemas,
  primaryFormId,
  onSettingsChange,
  onRowsChange,
}: {
  settings: RashModalSettings;
  rows: RashModalRow[];
  schemas: Record<string, FormSchema>;
  primaryFormId?: string;
  onSettingsChange: (settings: RashModalSettings) => void;
  onRowsChange: (rows: RashModalRow[]) => void;
}) {
  const [sourceFormId, setSourceFormId] = useState(primaryFormId || "");
  const [sourceRowNo, setSourceRowNo] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const formIds = useMemo(() => Object.keys(schemas).sort(), [schemas]);
  const sourceSchema = sourceFormId ? schemas[sourceFormId] : undefined;

  const addRow = () => {
    const source = sourceSchema?.rows.find(
      (row) => String(row.num ?? "").trim() === sourceRowNo
    );
    const rowKey = (customKey.trim() || sourceRowNo || `row_${rows.length + 1}`).trim();
    const label = customLabel.trim() || source?.name || rowKey;
    if (!rowKey || rows.some((row) => row.rowKey === rowKey)) return;
    onRowsChange([
      ...rows,
      {
        kod: rows[0]?.kod ?? 0,
        rowKey,
        label,
        sort: rows.length,
        required: false,
        sourceFormId: source ? sourceFormId : null,
        sourceRowNo: source ? sourceRowNo : null,
      },
    ]);
    setSourceRowNo("");
    setCustomKey("");
    setCustomLabel("");
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onRowsChange(next.map((row, sort) => ({ ...row, sort })));
  };

  return (
    <div className="rash-modal-rows-editor">
      <div className="rash-mode-cards">
        {(Object.keys(MODE_LABELS) as RashModalRowMode[]).map((mode) => (
          <label
            key={mode}
            className={`rash-mode-card${settings.rowMode === mode ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="rash-row-mode"
              checked={settings.rowMode === mode}
              onChange={() => onSettingsChange({ rowMode: mode })}
            />
            <strong>{MODE_LABELS[mode]}</strong>
            <span>
              {mode === "dynamic"
                ? "Пользователь сам добавляет контрагентов или записи."
                : mode === "fixed"
                  ? "Методолог заранее задаёт все строки; добавлять новые нельзя."
                  : "Обязательные фиксированные строки и дополнительные записи пользователя."}
            </span>
          </label>
        ))}
      </div>

      {settings.rowMode !== "dynamic" && (
        <>
          <section className="tools-section">
            <h3>Добавить фиксированную строку окна</h3>
            <div className="checks-form-grid">
              <label>
                Взять название из формы
                <select
                  value={sourceFormId}
                  onChange={(event) => {
                    setSourceFormId(event.target.value);
                    setSourceRowNo("");
                  }}
                >
                  <option value="">— не использовать —</option>
                  {formIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Строка формы
                <select
                  value={sourceRowNo}
                  disabled={!sourceSchema}
                  onChange={(event) => setSourceRowNo(event.target.value)}
                >
                  <option value="">— выберите —</option>
                  {sourceSchema?.rows
                    .filter((row) => String(row.num ?? "").trim())
                    .map((row) => (
                      <option key={String(row.num)} value={String(row.num)}>
                        {row.num} — {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Ключ своей строки
                <input
                  value={customKey}
                  placeholder="rent"
                  onChange={(event) => setCustomKey(event.target.value)}
                />
              </label>
              <label>
                Название
                <input
                  value={customLabel}
                  placeholder="Обязательства по аренде"
                  onChange={(event) => setCustomLabel(event.target.value)}
                />
              </label>
            </div>
            <button type="button" className="btn btn-secondary" onClick={addRow}>
              Добавить строку окна
            </button>
          </section>

          <div className="table-wrap">
            <table className="checks-table">
              <thead>
                <tr>
                  <th>Порядок</th>
                  <th>Ключ</th>
                  <th>Название строки в окне</th>
                  <th>Обязательная</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.rowKey}-${index}`}>
                    <td>
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                    </td>
                    <td>
                      <input
                        value={row.rowKey}
                        onChange={(event) => {
                          const next = [...rows];
                          next[index] = { ...row, rowKey: event.target.value };
                          onRowsChange(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.label}
                        onChange={(event) => {
                          const next = [...rows];
                          next[index] = { ...row, label: event.target.value };
                          onRowsChange(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(event) => {
                          const next = [...rows];
                          next[index] = { ...row, required: event.target.checked };
                          onRowsChange(next);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() =>
                          onRowsChange(
                            rows
                              .filter((_, rowIndex) => rowIndex !== index)
                              .map((item, sort) => ({ ...item, sort }))
                          )
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
