import { useEffect, useMemo, useState } from "react";
import type {
  FormColumn,
  FormRashEntry,
  KontrAgent,
  RashAddsum,
  RashRule,
} from "../types";
import {
  addsumInputType,
  defaultKontrShowFilter,
  effectiveRashFormula,
  filterKontrByShow,
  getAddsumForRule,
  getRashNumericColumns,
  kontrShowOptionsForRule,
  numVal,
  parseRefFilter,
  parseTotalColumn,
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
  } | null;
  entries: FormRashEntry[];
  formColumns: FormColumn[];
  addsum: RashAddsum[];
  kontrAgents: KontrAgent[];
  rashRefs?: RashRefsData | null;
  readOnly?: boolean;
}

function emptyEntry(
  ctx: NonNullable<RashEditorModalProps["context"]>,
  lineNo: number
): FormRashEntry {
  return {
    formId: ctx.formId,
    parentRowNo: ctx.parentRowNo,
    columnKey: ctx.columnKey,
    rashKod: ctx.rashKod,
    lineNo,
    kontrName: "",
    values: {},
  };
}

function filterModalEntries(
  entries: FormRashEntry[],
  ctx: NonNullable<RashEditorModalProps["context"]>
): FormRashEntry[] {
  return entries.filter(
    (e) =>
      e.parentRowNo === ctx.parentRowNo &&
      e.rashKod === ctx.rashKod &&
      (!e.columnKey || !ctx.columnKey || e.columnKey === ctx.columnKey)
  );
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
}: RashEditorModalProps) {
  const [draft, setDraft] = useState<FormRashEntry[]>([]);
  const [showFilter, setShowFilter] = useState("1,2");
  /** Once true, draft is authoritative (including empty = delete all). */
  const [seeded, setSeeded] = useState(false);

  const showOptions = useMemo(() => {
    if (!context) return [];
    return kontrShowOptionsForRule(context.rule.refA1Name);
  }, [context]);

  const kontrOrgTypes = useMemo(() => {
    const opt = showOptions.find((o) => o.id === showFilter);
    return opt?.orgTypes;
  }, [showOptions, showFilter]);

  useEffect(() => {
    if (!open || !context) {
      setDraft([]);
      setSeeded(false);
      return;
    }
    setDraft(filterModalEntries(initialEntries, context));
    setSeeded(true);
    setShowFilter(defaultKontrShowFilter(context.rule.refA1Name));
    // Seed only when the modal opens / target cell changes — not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional seed key
  }, [open, context?.formId, context?.parentRowNo, context?.rashKod, context?.columnKey]);

  const filteredAgents = useMemo(() => {
    if (!context) return kontrAgents;
    return filterKontrByShow(kontrAgents, context.rule.refA1Name, showFilter);
  }, [context, kontrAgents, showFilter]);

  const rashColumns = useMemo(() => {
    if (!context) return [];
    return getRashNumericColumns(context.rule, formColumns, addsum);
  }, [context, formColumns, addsum]);

  const formula = context ? effectiveRashFormula(context.rule) : null;
  const sumCol = parseTotalColumn(formula) ?? context?.columnKey ?? "";

  const attrA2 = context ? parseRefFilter(context.rule.refA2Name) : null;
  const attrA3 = context ? parseRefFilter(context.rule.refA3Name) : null;
  const attrA4 = context ? parseRefFilter(context.rule.refA4Name) : null;

  const refA2Options = useMemo(() => {
    if (!context || !rashRefs || !attrA2) return [];
    return refOptionsForSpec(rashRefs, context.rule.refA2Name);
  }, [context, rashRefs, attrA2]);

  const refA3Options = useMemo(() => {
    if (!context || !rashRefs || !attrA3) return [];
    return refOptionsForSpec(rashRefs, context.rule.refA3Name);
  }, [context, rashRefs, attrA3]);

  const refA4Options = useMemo(() => {
    if (!context || !rashRefs || !attrA4) return [];
    return refOptionsForSpec(rashRefs, context.rule.refA4Name);
  }, [context, rashRefs, attrA4]);

  if (!open || !context || !seeded) return null;

  // Ghost row for empty drafts so the user can start typing; remove-all stays [].
  const showingGhost = draft.length === 0 && !readOnly;
  const working = showingGhost ? [emptyEntry(context, 0)] : draft;

  const setWorking = (next: FormRashEntry[]) => setDraft(next);

  const updateLine = (idx: number, patch: Partial<FormRashEntry>) => {
    const base = showingGhost ? [emptyEntry(context, 0)] : draft;
    const next = base.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    setWorking(next);
  };

  const updateValue = (idx: number, key: string, raw: string, colType: FormColumn["type"]) => {
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
    const base = showingGhost ? [] : draft;
    setWorking([...base, emptyEntry(context, base.length)]);
  };

  const removeLine = (idx: number) => {
    if (showingGhost) {
      setDraft([]);
      return;
    }
    setWorking(draft.filter((_, i) => i !== idx));
  };

  const total = working.reduce((s, e) => s + numVal(e.values[sumCol]), 0);

  const handleClose = () => {
    setDraft([]);
    setSeeded(false);
    onClose();
  };

  const handleSave = () => {
    const cleaned = draft
      .filter((e) => e.kontrName?.trim() || Object.keys(e.values).length > 0)
      .map((e, i) => ({ ...e, lineNo: i }));
    onSave(cleaned);
    setDraft([]);
    setSeeded(false);
    onClose();
  };

  const listId = `rash-kontr-${context.rashKod}`;
  const listA2Id = `rash-ref-a2-${context.rashKod}`;
  const listA3Id = `rash-ref-a3-${context.rashKod}`;
  const listA4Id = `rash-ref-a4-${context.rashKod}`;

  const renderRefAttr = (
    value: string | null | undefined,
    options: typeof refA2Options,
    listIdAttr: string,
    onChange: (v: string) => void
  ) => {
    if (readOnly) return value;
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

  return (
    <div className="rash-modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="rash-modal"
        role="dialog"
        aria-labelledby="rash-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rash-modal-header">
          <div>
            <h2 id="rash-modal-title">Расшифровка</h2>
            <p className="rash-modal-sub">
              {context.parentLabel} · строка {context.parentRowNo} · правило №
              {context.rashKod}
            </p>
            {formula && (
              <p className="rash-modal-formula">
                <code>{formula}</code>
              </p>
            )}
          </div>
          <button type="button" className="btn-icon rash-modal-close" onClick={handleClose}>
            ×
          </button>
        </header>

        <div className="rash-modal-summary">
          <span>
            Итог на форме формируется из суммы расшифровки по гр.{" "}
            <strong>{sumCol}</strong>
          </span>
          <span>
            Сумма в подформе: <strong>{total}</strong>
          </span>
        </div>

        <div className="rash-modal-toolbar">
          {showOptions.length > 1 && !readOnly && (
            <label className="rash-show-filter">
              <span>Показать</span>
              <select
                value={showFilter}
                onChange={(e) => setShowFilter(e.target.value)}
              >
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
                <th>{context.rule.refA1Title ?? "Контрагент"}</th>
                {attrA2 && <th>{context.rule.refA2Title ?? attrA2.kind}</th>}
                {attrA3 && <th>{context.rule.refA3Title ?? attrA3.kind}</th>}
                {attrA4 && <th>{context.rule.refA4Title ?? attrA4.kind}</th>}
                {rashColumns.map((c) => (
                  <th key={c.key} title={c.label}>
                    <span className="col-letter">{c.key.replace("_addsum_", "+")}</span>
                    <span className="col-label">{c.label}</span>
                  </th>
                ))}
                {!readOnly && <th className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {working.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    {readOnly ? (
                      line.kontrName
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
                      {readOnly ? (
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
                  {!readOnly && (
                    <td className="actions-col">
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => removeLine(idx)}
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
        </div>

        {!readOnly && (
          <button type="button" className="btn btn-secondary add-row-btn" onClick={addLine}>
            + Добавить контрагента
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

        <footer className="rash-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Отмена
          </button>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              Сохранить расшифровку
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
