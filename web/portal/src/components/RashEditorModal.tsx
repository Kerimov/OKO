import { useEffect, useMemo, useState } from "react";
import type {
  FormColumn,
  FormRashEntry,
  KontrAgent,
  RashAddsum,
  RashModalRow,
  RashModalSettings,
  RashRule,
} from "../types";
import {
  addsumInputType,
  buildRashModalLayout,
  defaultKontrShowFilter,
  effectiveRashFormula,
  entryLineTotal,
  filterKontrByShow,
  getAddsumForRule,
  isFixedRashEntry,
  kontrShowOptionsForRule,
  parseRefFilter,
  parseTotalColumn,
  seedRashEntriesFromModalLayout,
  sumRashSubformTotal,
} from "../engine/rashEngine";
import {
  refItemLabel,
  refOptionsForSpec,
  type RashRefsData,
} from "../engine/rashRefs";
import { KontrInput } from "./KontrInput";

export interface RashEditorModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (entries: FormRashEntry[]) => void;
  context: {
    formId: string;
    parentRowNo: number;
    columnKey: string;
    rashKod: number;
    rule: RashRule;
    parentLabel: string;
    parentValue: number;
    /** Columns of this kod on the parent row (Access multi-column attachment). */
    placementColumns?: string[];
  } | null;
  entries: FormRashEntry[];
  formColumns: FormColumn[];
  addsum: RashAddsum[];
  kontrAgents: KontrAgent[];
  rashRefs?: RashRefsData | null;
  readOnly?: boolean;
  /** When true, render as embedded preview (no save, sample behaviour). */
  preview?: boolean;
  modalSettings?: RashModalSettings | null;
  modalRows?: RashModalRow[] | null;
}

function emptyEntry(
  ctx: NonNullable<RashEditorModalProps["context"]>,
  lineNo: number
): FormRashEntry {
  return {
    formId: ctx.formId,
    parentRowNo: ctx.parentRowNo,
    columnKey: null,
    rashKod: ctx.rashKod,
    lineNo,
    kontrName: "",
    values: {},
  };
}

export function RashEditorModal({
  open,
  onClose,
  onSave,
  context,
  entries: initialEntries,
  formColumns,
  addsum,
  kontrAgents,
  rashRefs,
  readOnly = false,
  preview = false,
  modalSettings,
  modalRows,
}: RashEditorModalProps) {
  const [draft, setDraft] = useState<FormRashEntry[]>([]);
  const [showFilter, setShowFilter] = useState("1,2");
  /** Once true, draft is authoritative (including empty = delete all). */
  const [seeded, setSeeded] = useState(false);

  const layout = useMemo(() => {
    if (!context) return null;
    return buildRashModalLayout({
      rule: context.rule,
      formColumns,
      addsum,
      placementColumns: context.placementColumns,
      modalSettings,
      modalRows,
    });
  }, [context, formColumns, addsum, modalSettings, modalRows]);

  const showOptions = useMemo(() => {
    if (!context) return [];
    return kontrShowOptionsForRule(context.rule.refA1Name);
  }, [context]);

  const kontrOrgTypes = useMemo(() => {
    const opt = showOptions.find((o) => o.id === showFilter);
    return opt?.orgTypes;
  }, [showOptions, showFilter]);

  useEffect(() => {
    if (!open || !context || !layout) {
      setDraft([]);
      setSeeded(false);
      return;
    }
    const seededEntries = seedRashEntriesFromModalLayout(initialEntries, layout, {
      formId: context.formId,
      parentRowNo: context.parentRowNo,
      rashKod: context.rashKod,
    });
    setDraft(seededEntries);
    setSeeded(true);
    setShowFilter(defaultKontrShowFilter(context.rule.refA1Name));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed key
  }, [
    open,
    context?.formId,
    context?.parentRowNo,
    context?.rashKod,
    layout?.rowMode,
    layout?.fixedRows.map((r) => r.rowKey).join("|"),
  ]);

  const filteredAgents = useMemo(() => {
    if (!context) return kontrAgents;
    return filterKontrByShow(kontrAgents, context.rule.refA1Name, showFilter);
  }, [context, kontrAgents, showFilter]);

  if (!open || !context || !seeded || !layout) return null;

  const editable = !readOnly && !preview;
  const rashColumns = layout.columns;
  const formula = effectiveRashFormula(context.rule);
  const totalCol = layout.totalCol ?? parseTotalColumn(formula);
  const sumCol = totalCol ?? context.columnKey ?? "";

  const attrA2 = parseRefFilter(context.rule.refA2Name);
  const attrA3 = parseRefFilter(context.rule.refA3Name);
  const attrA4 = parseRefFilter(context.rule.refA4Name);

  const refA2Options = rashRefs ? refOptionsForSpec(rashRefs, context.rule.refA2Name) : [];
  const refA3Options = rashRefs ? refOptionsForSpec(rashRefs, context.rule.refA3Name) : [];
  const refA4Options = rashRefs ? refOptionsForSpec(rashRefs, context.rule.refA4Name) : [];

  // Ghost row only in dynamic/mixed when there are no lines yet.
  const showingGhost =
    draft.length === 0 && editable && layout.allowAddRows;
  const working = showingGhost ? [emptyEntry(context, 0)] : draft;

  const setWorking = (next: FormRashEntry[]) => setDraft(next);

  const updateLine = (idx: number, patch: Partial<FormRashEntry>) => {
    const base = showingGhost ? [emptyEntry(context, 0)] : draft;
    const next = base.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    setWorking(next);
  };

  const updateValue = (
    idx: number,
    key: string,
    raw: string,
    colType: FormColumn["type"]
  ) => {
    const base = showingGhost ? [emptyEntry(context, 0)] : draft;
    const next = base.map((e, i) => {
      if (i !== idx) return e;
      const values = { ...e.values };
      if (raw.trim() === "") {
        delete values[key];
      } else if (colType === "number") {
        const n = parseFloat(raw.replace(",", "."));
        values[key] = Number.isFinite(n) ? n : raw;
      } else {
        values[key] = raw;
      }
      return { ...e, values };
    });
    setWorking(next);
  };

  const pickKontr = (idx: number, agent: KontrAgent) => {
    updateLine(idx, {
      kontrId: agent.id,
      kontrName: agent.name,
      inn: agent.inn ?? "",
      kpp: agent.kpp ?? "",
    });
  };

  const addLine = () => {
    if (!layout.allowAddRows) return;
    const base = showingGhost ? [] : draft;
    setWorking([...base, emptyEntry(context, base.length)]);
  };

  const removeLine = (idx: number) => {
    if (showingGhost) {
      setDraft([]);
      return;
    }
    const line = draft[idx];
    if (isFixedRashEntry(line)) return;
    if (!layout.allowRemoveDynamic) return;
    setWorking(draft.filter((_, i) => i !== idx));
  };

  const total = sumRashSubformTotal(working, context.rule, sumCol || context.columnKey);

  const handleClose = () => {
    if (preview) {
      onClose();
      return;
    }
    setDraft([]);
    setSeeded(false);
    onClose();
  };

  const handleSave = () => {
    const cleaned = draft
      .filter(
        (e) =>
          isFixedRashEntry(e) ||
          e.kontrName?.trim() ||
          Object.keys(e.values).length > 0
      )
      .map((e, i) => ({ ...e, lineNo: i, columnKey: null }));
    onSave(cleaned);
    setDraft([]);
    setSeeded(false);
    onClose();
  };

  const listId = `rash-kontr-${context.rashKod}${preview ? "-preview" : ""}`;
  const listA2Id = `rash-ref-a2-${context.rashKod}${preview ? "-preview" : ""}`;
  const listA3Id = `rash-ref-a3-${context.rashKod}${preview ? "-preview" : ""}`;
  const listA4Id = `rash-ref-a4-${context.rashKod}${preview ? "-preview" : ""}`;

  const renderRefAttr = (
    value: string | null | undefined,
    options: ReturnType<typeof refOptionsForSpec>,
    listIdAttr: string,
    onChange: (v: string) => void
  ) => {
    if (!editable) return value;
    if (options.length > 0) {
      return (
        <>
          <datalist id={listIdAttr}>
            {options.map((item) => (
              <option
                key={item.kod}
                value={refItemLabel(item)}
                label={item.kod !== item.value ? item.kod : undefined}
              />
            ))}
          </datalist>
          <input
            type="text"
            list={listIdAttr}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      );
    }
    return (
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  const inputModeForCol = (col: FormColumn): "decimal" | "text" | undefined => {
    if (col.key.startsWith("_addsum_")) {
      const sort = Number(col.key.replace("_addsum_", ""));
      const a = getAddsumForRule(context.rashKod, addsum).find((x) => x.sort === sort);
      const t = addsumInputType(a?.fldType);
      if (t === "number") return "decimal";
      return "text";
    }
    return col.type === "number" ? "decimal" : "text";
  };

  const htmlTypeForCol = (col: FormColumn): string => {
    if (col.key.startsWith("_addsum_")) {
      const sort = Number(col.key.replace("_addsum_", ""));
      const a = getAddsumForRule(context.rashKod, addsum).find((x) => x.sort === sort);
      const t = addsumInputType(a?.fldType);
      if (t === "date") return "date";
      return "text";
    }
    return "text";
  };

  const totalLabel = totalCol
    ? formColumns.find((c) => c.key === totalCol)?.label ?? "Итог"
    : null;

  const modeLabel =
    layout.rowMode === "fixed"
      ? "фиксированные строки"
      : layout.rowMode === "mixed"
        ? "фиксированные + динамические"
        : "динамические записи";

  const showActionsCol =
    editable && layout.allowRemoveDynamic && working.some((line) => !isFixedRashEntry(line));

  const modalBody = (
    <div
      className={`rash-modal${preview ? " rash-modal-preview" : ""}`}
      role="dialog"
      aria-labelledby="rash-modal-title"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="rash-modal-header">
        <div>
          <h2 id="rash-modal-title">
            {preview ? "Предпросмотр расшифровки" : "Расшифровка"}
          </h2>
          <p className="rash-modal-sub">
            {context.parentLabel} · строка {context.parentRowNo} · правило №
            {context.rashKod} · {modeLabel}
          </p>
          {formula && (
            <p className="rash-modal-formula">
              <code>{formula}</code>
            </p>
          )}
        </div>
        {!preview && (
          <button type="button" className="btn-icon rash-modal-close" onClick={handleClose}>
            ×
          </button>
        )}
      </header>

      <div className="rash-modal-summary">
        <span>
          {totalCol ? (
            <>
              Итог на форме: сумма по формуле{" "}
              <strong>
                {totalCol}
                {formula ? ` (${formula})` : ""}
              </strong>
            </>
          ) : (
            <>Итоги граф расшифровки переносятся в соответствующие графы формы</>
          )}
        </span>
        <span>
          Сумма в подформе
          {totalCol ? ` (${totalCol})` : ""}: <strong>{total}</strong>
        </span>
      </div>

      <div className="rash-modal-toolbar">
        {showOptions.length > 1 && editable && (
          <label className="rash-show-filter">
            <span>Показать</span>
            <select value={showFilter} onChange={(e) => setShowFilter(e.target.value)}>
              {showOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <datalist id={listId}>
        {filteredAgents.length <= 400 &&
          filteredAgents.map((k) => (
            <option key={k.id} value={k.name} label={k.inn ? `ИНН ${k.inn}` : undefined} />
          ))}
      </datalist>

      <div className="table-wrap rash-modal-table-wrap">
        <table className="form-table rash-modal-table">
          <thead>
            <tr>
              <th>{context.rule.refA1Title ?? "Контрагент / строка"}</th>
              {attrA2 && <th>{context.rule.refA2Title ?? attrA2.kind}</th>}
              {attrA3 && <th>{context.rule.refA3Title ?? attrA3.kind}</th>}
              {attrA4 && <th>{context.rule.refA4Title ?? attrA4.kind}</th>}
              {rashColumns.map((c) => (
                <th key={c.key} title={c.label}>
                  <span className="col-letter">{c.key.replace("_addsum_", "+")}</span>
                  <span className="col-label">{c.label}</span>
                </th>
              ))}
              {totalCol && (
                <th title={totalLabel ?? "Итог"} className="rash-total-col">
                  <span className="col-letter">{totalCol}</span>
                  <span className="col-label">{totalLabel ?? "Итог"}</span>
                </th>
              )}
              {showActionsCol && <th className="actions-col" />}
            </tr>
          </thead>
          <tbody>
            {working.map((line, idx) => {
              const lineTotal = entryLineTotal(line, context.rule);
              const fixed = isFixedRashEntry(line);
              return (
                <tr key={line.templateRowKey ?? `dyn-${idx}`} className={fixed ? "rash-fixed-row" : undefined}>
                  <td>
                    {!editable || fixed ? (
                      <span title={fixed ? "Фиксированная строка" : undefined}>
                        {line.kontrName}
                      </span>
                    ) : (
                      <KontrInput
                        value={line.kontrName ?? ""}
                        listId={listId}
                        agents={filteredAgents}
                        orgTypes={kontrOrgTypes}
                        placeholder="Контрагент…"
                        onChange={(v) => {
                          updateLine(idx, { kontrName: v });
                          const agent = filteredAgents.find((k) => k.name === v);
                          if (agent) pickKontr(idx, agent);
                        }}
                        onPick={(agent) => pickKontr(idx, agent)}
                      />
                    )}
                  </td>
                  {attrA2 && (
                    <td>
                      {renderRefAttr(line.attrA2, refA2Options, listA2Id, (v) =>
                        updateLine(idx, { attrA2: v })
                      )}
                    </td>
                  )}
                  {attrA3 && (
                    <td>
                      {renderRefAttr(line.attrA3, refA3Options, listA3Id, (v) =>
                        updateLine(idx, { attrA3: v })
                      )}
                    </td>
                  )}
                  {attrA4 && (
                    <td>
                      {renderRefAttr(line.attrA4, refA4Options, listA4Id, (v) =>
                        updateLine(idx, { attrA4: v })
                      )}
                    </td>
                  )}
                  {rashColumns.map((c) => (
                    <td key={c.key}>
                      {!editable ? (
                        String(line.values[c.key] ?? "")
                      ) : (
                        <input
                          type={htmlTypeForCol(c)}
                          inputMode={inputModeForCol(c)}
                          className={c.type === "number" ? "num-input" : undefined}
                          value={String(line.values[c.key] ?? "")}
                          onChange={(e) => updateValue(idx, c.key, e.target.value, c.type)}
                        />
                      )}
                    </td>
                  ))}
                  {totalCol && (
                    <td className="rash-total-col num-input">
                      {lineTotal == null || Number.isNaN(lineTotal) ? "" : lineTotal}
                    </td>
                  )}
                  {showActionsCol && (
                    <td className="actions-col">
                      {!fixed && (
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeLine(idx)}
                          title="Удалить строку"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && layout.allowAddRows && (
        <button type="button" className="btn btn-secondary add-row-btn" onClick={addLine}>
          + Добавить {layout.rowMode === "mixed" ? "запись" : "контрагента"}
        </button>
      )}

      {getAddsumForRule(context.rashKod, addsum).length > 0 && (
        <p className="rash-modal-hint">
          Доп. графы:{" "}
          {getAddsumForRule(context.rashKod, addsum)
            .map((a) => a.sumTitle.trim())
            .join("; ")}
        </p>
      )}

      {!preview && (
        <footer className="rash-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Отмена
          </button>
          {editable && (
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              Сохранить расшифровку
            </button>
          )}
        </footer>
      )}
    </div>
  );

  if (preview) {
    return <div className="rash-preview-embed">{modalBody}</div>;
  }

  return (
    <div className="rash-modal-backdrop" role="presentation" onClick={handleClose}>
      {modalBody}
    </div>
  );
}
