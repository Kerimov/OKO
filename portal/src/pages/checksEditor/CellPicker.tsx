import { useEffect, useMemo, useState } from "react";
import { loadCatalog, loadSchema } from "../../api";
import type { FormSchema } from "../../types";

export type CellPickTarget = "expression" | "expressionAlt";

export type PickedCell = {
  formId: string;
  columnKey: string;
  rowNo: string;
};

const OPERATORS = ["=", ">=", "<=", ">", "<", "+", "-", "and", "or"] as const;

export function formatCellCall(pick: PickedCell): string {
  const col = pick.columnKey.replace(/"/g, "");
  const row = pick.rowNo.trim();
  const rowLit = /^-?\d+(\.\d+)?$/.test(row) ? row : JSON.stringify(row);
  return `Cell(${JSON.stringify(pick.formId)},${JSON.stringify(col)},${rowLit})`;
}

export function CellPicker({
  onInsert,
  target,
  onTargetChange,
}: {
  onInsert: (text: string) => void;
  target: CellPickTarget;
  onTargetChange: (target: CellPickTarget) => void;
}) {
  const [formIds, setFormIds] = useState<string[]>([]);
  const [formLabels, setFormLabels] = useState<Record<string, string>>({});
  const [formId, setFormId] = useState("");
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowFilter, setRowFilter] = useState("");

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
          setError(e instanceof Error ? e.message : "Не удалось загрузить каталог форм");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!formId) {
      setSchema(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadSchema(formId)
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
  }, [formId]);

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

  const pickCell = (rowNo: string, columnKey: string) => {
    if (!formId) return;
    onInsert(formatCellCall({ formId, columnKey, rowNo }));
  };

  return (
    <div className="checks-cell-picker">
      <div className="checks-cell-picker-head">
        <strong>Конструктор Cell</strong>
        <span className="tools-hint">Клик по ячейке вставляет ссылку в выражение</span>
      </div>

      <div className="checks-cell-picker-controls">
        <label>
          Форма
          <select value={formId} onChange={(e) => setFormId(e.target.value)}>
            <option value="">— выберите форму —</option>
            {formIds.map((id) => (
              <option key={id} value={id}>
                {formLabels[id] ?? id}
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
        {formId ? (
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
      </div>

      <div className="checks-cell-picker-ops" role="group" aria-label="Операторы">
        {OPERATORS.map((op) => (
          <button
            key={op}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onInsert(op === "and" || op === "or" ? ` ${op} ` : op)}
          >
            {op}
          </button>
        ))}
      </div>

      {error ? <p className="error-box">{error}</p> : null}
      {loading ? <p className="loading">Загрузка формы…</p> : null}

      {schema && !loading ? (
        columns.length === 0 ? (
          <p className="tools-hint">В форме нет числовых граф для увязок.</p>
        ) : (
          <div className="checks-cell-picker-grid-wrap rash-binding-grid-wrap">
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
                {rows.map((row, index) => {
                  const rowNo = String(row.num ?? "").trim();
                  return (
                    <tr key={`${rowNo}-${index}`}>
                      <td title={row.name}>
                        <strong>{rowNo}</strong>
                        {row.name ? ` — ${row.name}` : ""}
                      </td>
                      {columns.map((column) => (
                        <td key={column.key}>
                          <button
                            type="button"
                            className="checks-cell-picker-cell"
                            title={`Вставить Cell("${formId}","${column.key}",${rowNo})`}
                            aria-label={`Строка ${rowNo}, графа ${column.key}`}
                            onClick={() => pickCell(rowNo, column.key)}
                          >
                            +
                          </button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="tools-hint">Нет строк по фильтру.</p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
