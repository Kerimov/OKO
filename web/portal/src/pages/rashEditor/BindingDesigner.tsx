import { useEffect, useMemo, useState } from "react";
import { fetchRashPlacementsByForm, type RashPlacement } from "../../api";
import type { FormSchema } from "../../types";
import type { RashFormAddition } from "../../api";
import type { PlacementDraft } from "./validateDraft";
import { normalizeColKey } from "./ColumnKeyInput";

export function BindingDesigner({
  formIds,
  schemas,
  ensureSchema,
  placements,
  additions,
  onChange,
  onAdditionsChange,
  preferFormId,
  currentKod,
  onOpenRule,
}: {
  formIds: string[];
  schemas: Record<string, FormSchema>;
  ensureSchema: (id: string) => Promise<FormSchema | undefined>;
  placements: PlacementDraft[];
  additions: RashFormAddition[];
  onChange: (placements: PlacementDraft[]) => void;
  onAdditionsChange: (items: RashFormAddition[]) => void;
  preferFormId?: string;
  currentKod?: number;
  onOpenRule?: (kod: number) => void;
}) {
  const [formId, setFormId] = useState(preferFormId || "");
  const [customRowNo, setCustomRowNo] = useState("");
  const [customRowName, setCustomRowName] = useState("");
  const [customColumnKey, setCustomColumnKey] = useState("");
  const [customColumnLabel, setCustomColumnLabel] = useState("");
  const [formOwners, setFormOwners] = useState<RashPlacement[]>([]);

  useEffect(() => {
    if (preferFormId && !formId) setFormId(preferFormId);
  }, [preferFormId, formId]);
  useEffect(() => {
    if (formId) void ensureSchema(formId);
  }, [formId, ensureSchema]);
  useEffect(() => {
    if (!formId) {
      setFormOwners([]);
      return;
    }
    let cancelled = false;
    void fetchRashPlacementsByForm(formId)
      .then((items) => {
        if (!cancelled) setFormOwners(items);
      })
      .catch(() => {
        if (!cancelled) setFormOwners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [formId]);

  const schema = formId ? schemas[formId] : undefined;
  const columns = schema?.columns.filter((column) => column.type === "number") ?? [];
  const selected = useMemo(
    () =>
      new Set(
        placements
          .filter((placement) => placement.formId === formId)
          .map(
            (placement) =>
              `${String(placement.rowNo).trim()}:${normalizeColKey(placement.columnKey)}`
          )
      ),
    [placements, formId]
  );

  const ownerMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of formOwners) {
      if (currentKod && item.kod === currentKod) continue;
      map.set(`${String(item.rowNo).trim()}:${normalizeColKey(item.columnKey)}`, item.kod);
    }
    return map;
  }, [formOwners, currentKod]);

  const toggle = (rowNo: string, columnKey: string) => {
    if (!formId) return;
    const key = `${rowNo}:${normalizeColKey(columnKey)}`;
    if (selected.has(key)) {
      onChange(
        placements.filter(
          (placement) =>
            !(
              placement.formId === formId &&
              String(placement.rowNo).trim() === rowNo &&
              normalizeColKey(placement.columnKey) === normalizeColKey(columnKey)
            )
        )
      );
      return;
    }

    const otherKod = ownerMap.get(key);
    if (otherKod != null) {
      const go = onOpenRule
        ? confirm(
            `Эта ячейка уже привязана к правилу №${otherKod}.\n\nОК — добавить сюда (замена при сохранении)\nОтмена — перейти к правилу №${otherKod}`
          )
        : confirm(
            `Эта ячейка уже привязана к правилу №${otherKod}. Заменить привязку при сохранении?`
          );
      if (!go) {
        onOpenRule?.(otherKod);
        return;
      }
    }

    onChange([...placements, { formId, rowNo, columnKey: normalizeColKey(columnKey) }]);
  };

  const addCustom = () => {
    if (!formId || !customRowNo.trim()) return;
    const rowNo = customRowNo.trim();
    const columnKey = normalizeColKey(customColumnKey);
    const key = `${rowNo}:${columnKey}`;
    const otherKod = ownerMap.get(key);
    if (otherKod != null) {
      const go = confirm(
        `Ячейка уже привязана к правилу №${otherKod}. Добавить и заменить при сохранении?`
      );
      if (!go) {
        onOpenRule?.(otherKod);
        return;
      }
    }
    if (
      !placements.some(
        (placement) =>
          placement.formId === formId &&
          String(placement.rowNo).trim() === rowNo &&
          normalizeColKey(placement.columnKey) === columnKey
      )
    ) {
      onChange([...placements, { formId, rowNo, columnKey }]);
    }

    const next = [...additions];
    let item = next.find((entry) => entry.formId === formId);
    if (!item) {
      item = { formId, rows: [], columns: [] };
      next.push(item);
    }
    if (!schema?.rows.some((row) => String(row.num ?? "").trim() === rowNo)) {
      item.rows = [
        ...(item.rows ?? []).filter((row) => row.num !== rowNo),
        { num: rowNo, name: customRowName.trim() || `Новая строка ${rowNo}` },
      ];
    }
    if (
      columnKey &&
      !schema?.columns.some((column) => column.key.toUpperCase() === columnKey)
    ) {
      item.columns = [
        ...(item.columns ?? []).filter((column) => column.key.toUpperCase() !== columnKey),
        {
          key: columnKey,
          label: customColumnLabel.trim() || `Графа ${columnKey}`,
          type: "number",
        },
      ];
    }
    onAdditionsChange(next);
    setCustomRowNo("");
    setCustomRowName("");
    setCustomColumnKey("");
    setCustomColumnLabel("");
  };

  return (
    <div className="rash-binding-designer">
      <div className="checks-form-grid">
        <label>
          Форма
          <select value={formId} onChange={(event) => setFormId(event.target.value)}>
            <option value="">— выберите форму —</option>
            {formIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {schema && (
        <>
          <p className="tools-hint">
            Отметьте ячейки, из которых должно открываться окно расшифровки. Чужие привязки
            подсвечены.
          </p>
          <div className="rash-binding-grid-wrap">
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
                {schema.rows.map((row, index) => {
                  const rowNo = String(row.num ?? "").trim();
                  if (!rowNo) return null;
                  return (
                    <tr key={`${rowNo}-${index}`}>
                      <td title={row.name}>
                        <strong>{rowNo}</strong> — {row.name}
                      </td>
                      {columns.map((column) => {
                        const cellKey = `${rowNo}:${column.key.toUpperCase()}`;
                        const checked = selected.has(cellKey);
                        const otherKod = ownerMap.get(cellKey);
                        return (
                          <td
                            key={column.key}
                            className={
                              otherKod != null && !checked
                                ? "rash-binding-conflict"
                                : checked
                                  ? "rash-binding-selected"
                                  : undefined
                            }
                            title={
                              otherKod != null
                                ? `Уже привязано к правилу №${otherKod}`
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              aria-label={`${rowNo}, графа ${column.key}`}
                              onChange={() => toggle(rowNo, column.key)}
                            />
                            {otherKod != null && !checked && (
                              <button
                                type="button"
                                className="rash-binding-conflict-link"
                                onClick={() => onOpenRule?.(otherKod)}
                              >
                                №{otherKod}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {formId && (
        <fieldset className="rash-custom-binding">
          <legend>Новая строка или графа основной формы</legend>
          <div className="checks-form-grid">
            <label>
              Номер строки
              <input
                value={customRowNo}
                placeholder="2000"
                onChange={(event) => setCustomRowNo(event.target.value)}
              />
            </label>
            <label>
              Название строки
              <input
                value={customRowName}
                placeholder="Расшифровываемая строка"
                onChange={(event) => setCustomRowName(event.target.value)}
              />
            </label>
            <label>
              Ключ графы
              <input
                value={customColumnKey}
                placeholder="K"
                onChange={(event) => setCustomColumnKey(event.target.value)}
              />
            </label>
            <label>
              Название графы
              <input
                value={customColumnLabel}
                placeholder="Сумма"
                onChange={(event) => setCustomColumnLabel(event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addCustom}>
            Добавить привязку
          </button>
          <p className="tools-hint">
            Если строки или графы нет, перед сохранением конструктор предложит создать их в
            шаблоне формы.
          </p>
        </fieldset>
      )}

      <section>
        <h3>Текущие места открытия ({placements.length})</h3>
        {placements.length === 0 ? (
          <p className="tools-hint">Привязок пока нет.</p>
        ) : (
          <ul className="rash-binding-list">
            {placements.map((placement, index) => {
              const boundSchema = schemas[placement.formId];
              const row = boundSchema?.rows.find(
                (item) => String(item.num ?? "").trim() === String(placement.rowNo).trim()
              );
              const column = boundSchema?.columns.find(
                (item) =>
                  item.key.toUpperCase() === normalizeColKey(placement.columnKey)
              );
              const willCreateRow = Boolean(placement.rowNo) && !row;
              const willCreateCol =
                Boolean(placement.columnKey) &&
                !column &&
                !additions
                  .find((a) => a.formId === placement.formId)
                  ?.columns?.some(
                    (c) => c.key.toUpperCase() === normalizeColKey(placement.columnKey)
                  );
              const additionRow = additions
                .find((a) => a.formId === placement.formId)
                ?.rows?.find((r) => r.num === String(placement.rowNo).trim());
              return (
                <li key={`${placement.formId}-${placement.rowNo}-${placement.columnKey}-${index}`}>
                  <span>
                    <strong>{placement.formId}</strong> → строка {placement.rowNo}
                    {row?.name
                      ? ` «${row.name}»`
                      : additionRow
                        ? ` «${additionRow.name}» (будет создана)`
                        : willCreateRow
                          ? " (будет создана)"
                          : ""}{" "}
                    → графа {placement.columnKey || "*"}
                    {column?.label
                      ? ` «${column.label}»`
                      : placement.columnKey
                        ? willCreateCol ||
                          additions
                            .find((a) => a.formId === placement.formId)
                            ?.columns?.some(
                              (c) =>
                                c.key.toUpperCase() === normalizeColKey(placement.columnKey)
                            )
                          ? " (будет создана)"
                          : ""
                        : ""}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    title="Удалить привязку"
                    onClick={() =>
                      onChange(placements.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
