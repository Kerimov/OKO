import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createSaldoRule,
  deleteSaldoRule,
  fetchSaldoPage,
  fetchSaldoStats,
  loadCatalog,
  loadFormCorrespondence,
  reimportCorrespondenceFromJson,
  reimportSaldoFromJson,
  saveFormCorrespondence,
  saveSaldoRule,
  type FormCorrespondenceItem,
  type SaldoRule,
} from "../api";
import {
  FormCellGrid,
  formCellKey,
  type FormCellPick,
} from "../components/FormCellGrid";
import { EditorWizardNav, EditorWizardSteps } from "../components/EditorWizard";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";

type Tab = "rules" | "correspondence";
type PickSlot = "target" | "source" | "end";
type WizardStep = 1 | 2 | 3 | 4;

const WIZARD_STEPS = ["Основное", "Цель", "Источник", "Проверка"];

const EMPTY_RULE: SaldoRule = {
  number: 0,
  targetForm: "",
  targetColumn: "",
  targetRow: null,
  sourceForm: null,
  sourceColumn: null,
  sourceRow: null,
  endForm: null,
  endColumn: null,
  endRow: null,
  saldoT: false,
  saldoS: false,
  saldoG: false,
  name: null,
  conditional: false,
};

const EMPTY_CORR: FormCorrespondenceItem = {
  formId: "",
  saldoYellow: null,
  saldoRed: null,
  saldoBlue: null,
  saldoGreen: null,
  saldoYellowCorr: null,
  saldoRedCorr: null,
  saldoBlueCorr: null,
  reorgUpdate: null,
  reorgUpdate2: null,
};

function cellLabel(
  form: string | null | undefined,
  column: string | null | undefined,
  row: number | null | undefined
): string {
  if (!form) return "—";
  return `${form} · ${column ?? "?"} · ${row ?? "?"}`;
}

function applyPickToRule(rule: SaldoRule, slot: PickSlot, pick: FormCellPick): SaldoRule {
  const row = Number(pick.rowNo);
  const rowNum = Number.isFinite(row) ? row : null;
  if (slot === "target") {
    return {
      ...rule,
      targetForm: pick.formId,
      targetColumn: pick.columnKey,
      targetRow: rowNum,
    };
  }
  if (slot === "source") {
    return {
      ...rule,
      sourceForm: pick.formId,
      sourceColumn: pick.columnKey,
      sourceRow: rowNum,
    };
  }
  return {
    ...rule,
    endForm: pick.formId,
    endColumn: pick.columnKey,
    endRow: rowNum,
  };
}

function collectKeysForForm(rule: SaldoRule, formId: string, into: Set<string>) {
  if (rule.targetForm === formId && rule.targetColumn) {
    into.add(formCellKey(rule.targetRow ?? "", rule.targetColumn));
  }
  if (rule.sourceForm === formId && rule.sourceColumn) {
    into.add(formCellKey(rule.sourceRow ?? "", rule.sourceColumn));
  }
  if (rule.endForm === formId && rule.endColumn) {
    into.add(formCellKey(rule.endRow ?? "", rule.endColumn));
  }
}

function collectSlotKey(
  rule: SaldoRule,
  formId: string,
  slot: PickSlot,
  into: Set<string>
) {
  if (slot === "target") {
    if (rule.targetForm === formId && rule.targetColumn) {
      into.add(formCellKey(rule.targetRow ?? "", rule.targetColumn));
    }
    return;
  }
  if (slot === "source") {
    if (rule.sourceForm === formId && rule.sourceColumn) {
      into.add(formCellKey(rule.sourceRow ?? "", rule.sourceColumn));
    }
    return;
  }
  if (rule.endForm === formId && rule.endColumn) {
    into.add(formCellKey(rule.endRow ?? "", rule.endColumn));
  }
}

function clearSlot(rule: SaldoRule, slot: PickSlot): SaldoRule {
  if (slot === "target") {
    return { ...rule, targetForm: "", targetColumn: "", targetRow: null };
  }
  if (slot === "source") {
    return {
      ...rule,
      sourceForm: null,
      sourceColumn: null,
      sourceRow: null,
    };
  }
  return { ...rule, endForm: null, endColumn: null, endRow: null };
}

/** Owners map for all rules on a form; active keys for one slot of the draft. */
function useCellMaps(
  items: SaldoRule[],
  formId: string,
  draft: SaldoRule,
  editing: boolean,
  activeSlot: PickSlot
) {
  const owners = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!formId) return map;
    for (const rule of items) {
      const keys = new Set<string>();
      collectKeysForForm(rule, formId, keys);
      for (const key of keys) {
        const label = `№${rule.number}`;
        const list = map.get(key) ?? [];
        if (!list.includes(label)) list.push(label);
        map.set(key, list);
      }
    }
    return map;
  }, [items, formId]);

  const active = useMemo(() => {
    const keys = new Set<string>();
    if (!formId || !editing) return keys;
    collectSlotKey(draft, formId, activeSlot, keys);
    return keys;
  }, [draft, formId, editing, activeSlot]);

  return { active, owners };
}

export function SaldoEditorPage() {
  const backend = isBackendMode();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get("tab") === "correspondence" ? "correspondence" : "rules"
  );

  const [stats, setStats] = useState<{
    total: number;
    typeT: number;
    typeS: number;
    typeG: number;
  } | null>(null);
  const [items, setItems] = useState<SaldoRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const [search, setSearch] = useState(searchInput);
  const [formFilter, setFormFilter] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [saldoType, setSaldoType] = useState<"" | "t" | "s" | "g">("");
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );

  const [selected, setSelected] = useState<SaldoRule | null>(null);
  const [draft, setDraft] = useState<SaldoRule>(EMPTY_RULE);
  const [creating, setCreating] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [targetGridFormId, setTargetGridFormId] = useState("");
  const [sourceGridFormId, setSourceGridFormId] = useState("");
  const [sourceSlot, setSourceSlot] = useState<"source" | "end">("source");

  const [corrItems, setCorrItems] = useState<FormCorrespondenceItem[]>([]);
  const [corrSelected, setCorrSelected] = useState<FormCorrespondenceItem | null>(
    null
  );
  const [corrDraft, setCorrDraft] = useState<FormCorrespondenceItem>(EMPTY_CORR);

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 80;

  const editing = creating || selected != null;

  const targetMaps = useCellMaps(items, targetGridFormId, draft, editing, "target");
  const sourceMaps = useCellMaps(
    items,
    sourceGridFormId,
    draft,
    editing,
    sourceSlot
  );

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setFormOptions(
          catalog.forms
            .map((f) => ({
              id: f.id,
              label: f.title ? `${f.id} — ${f.title}` : f.id,
            }))
            .sort((a, b) => a.id.localeCompare(b.id))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRulesPage = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchSaldoPage({
          q: search || undefined,
          formId: formFilter || undefined,
          saldoType: saldoType || undefined,
          limit,
          offset,
        }),
        fetchSaldoStats(),
      ]);
      setItems(page.items);
      setTotal(page.total);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, saldoType, offset]);

  const loadCorrespondence = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const data = await loadFormCorrespondence();
      setCorrItems(data.forms);
      const wantId = searchParams.get("formId") || formFilter || undefined;
      const pick =
        (wantId ? data.forms.find((f) => f.formId === wantId) : undefined) ??
        data.forms[0] ??
        null;
      if (pick) {
        setCorrSelected(pick);
        setCorrDraft({ ...pick });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, searchParams]);

  useEffect(() => {
    if (tab === "rules") void loadRulesPage();
    else void loadCorrespondence();
  }, [tab, loadRulesPage, loadCorrespondence]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (tab !== "correspondence") return;
    const field = searchParams.get("field");
    if (!field) return;
    const id = `corr-field-${field.replace(/_/g, "-")}`;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
      }
    }
  }, [tab, searchParams, corrDraft.formId]);

  const selectRule = (rule: SaldoRule) => {
    setSelected(rule);
    setDraft({ ...rule });
    setCreating(false);
    setWizardStep(1);
    setTargetGridFormId(rule.targetForm || formFilter || "");
    setSourceGridFormId(rule.sourceForm || rule.targetForm || formFilter || "");
    setSourceSlot("source");
  };

  const handleNew = () => {
    const nextNumber = items.reduce((max, r) => Math.max(max, r.number), 0) + 1 || 1;
    setSelected(null);
    setDraft({
      ...EMPTY_RULE,
      number: nextNumber,
      targetForm: formFilter || "",
      saldoS: true,
    });
    setCreating(true);
    setWizardStep(1);
    setTargetGridFormId(formFilter || "");
    setSourceGridFormId(formFilter || "");
    setSourceSlot("source");
  };

  const handleDiscard = () => {
    if (selected) selectRule(selected);
    else {
      setCreating(false);
      setDraft(EMPTY_RULE);
    }
  };

  const handleSaveRule = async () => {
    if (!draft.number || !draft.targetForm.trim()) {
      setError("Укажите номер и целевую ячейку (форму)");
      return;
    }
    try {
      const saved = selected ? await saveSaldoRule(draft) : await createSaldoRule(draft);
      setStatus(`Правило ${saved.number} сохранено`);
      setSelected(saved);
      setDraft({ ...saved });
      setCreating(false);
      setError("");
      await loadRulesPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDeleteRule = async () => {
    if (!selected) return;
    if (!confirm(`Удалить правило сальдо №${selected.number}?`)) return;
    try {
      await deleteSaldoRule(selected.number);
      setSelected(null);
      setDraft(EMPTY_RULE);
      setCreating(false);
      setStatus("Удалено");
      await loadRulesPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimportRules = async () => {
    if (!confirm("Перезаписать все правила из saldo-rules.json?")) return;
    try {
      const r = await reimportSaldoFromJson();
      setStatus(`Импортировано ${r.reimported} правил`);
      await loadRulesPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const selectCorr = (item: FormCorrespondenceItem) => {
    setCorrSelected(item);
    setCorrDraft({ ...item });
  };

  const handleSaveCorr = async () => {
    if (!corrDraft.formId) return;
    try {
      const saved = await saveFormCorrespondence(corrDraft);
      setCorrSelected(saved);
      setCorrDraft({ ...saved });
      setStatus(`Соответствие форм ${saved.formId} сохранено`);
      await loadCorrespondence();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleReimportCorr = async () => {
    if (!confirm("Перезаписать правила колонок из form-correspondence.json?"))
      return;
    try {
      const r = await reimportCorrespondenceFromJson();
      setStatus(`Обновлено ${r.reimported} форм`);
      await loadCorrespondence();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const access = useAdminAccess();

  const stepBlocked = useMemo(() => {
    if (wizardStep === 1) return !draft.number;
    if (wizardStep === 2) return !draft.targetForm || !draft.targetColumn;
    return false;
  }, [wizardStep, draft]);

  const canSave = !!draft.number && !!draft.targetForm.trim();

  if (!access.ok) {
    return <AdminAccessGate title="Сальдо" />;
  }

  const sourcePickHint =
    sourceSlot === "source"
      ? "Выбор источника: откуда берётся значение (можно с другой формы)"
      : "Выбор конечной ячейки (год / закрытие)";

  return (
    <div className="admin-editor-page rash-constructor-page">
      <h1>Конструктор сальдо</h1>
      <p className="tools-intro">
        Правила переноса остатков между графами форм: цель, источник (в т.ч. с другой
        формы) и необязательная конечная ячейка (год / закрытие).
      </p>

      {!backend && (
        <div className="status-bar">Режим только чтения. Подключите API для редактирования.</div>
      )}
      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      {stats && tab === "rules" && (
        <p className="tools-hint">
          Правил: <strong>{stats.total}</strong>, Т: <strong>{stats.typeT}</strong>, С:{" "}
          <strong>{stats.typeS}</strong>, Г: <strong>{stats.typeG}</strong>
        </p>
      )}

      <div className="forms-tabs">
        <button
          type="button"
          className={tab === "rules" ? "active" : ""}
          onClick={() => setTab("rules")}
        >
          Детальные правила
        </button>
        <button
          type="button"
          className={tab === "correspondence" ? "active" : ""}
          onClick={() => setTab("correspondence")}
        >
          Соответствие форм
        </button>
      </div>

      {tab === "rules" ? (
        <>
          <div className="editor-list-toolbar">
            <CollapsibleFilters
              activeCount={countActiveFilters(
                searchInput.trim().length > 0,
                formFilter !== "",
                saldoType !== ""
              )}
              bodyClassName="checks-filters"
            >
              <input
                placeholder="№ или название…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="search-input"
              />
              <select
                value={formFilter}
                onChange={(e) => {
                  setFormFilter(e.target.value);
                  setOffset(0);
                }}
                className="category-select"
              >
                <option value="">Все формы</option>
                {formOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={saldoType}
                onChange={(e) => {
                  setSaldoType(e.target.value as "" | "t" | "s" | "g");
                  setOffset(0);
                }}
                className="category-select"
              >
                <option value="">Все типы</option>
                <option value="t">Текущий</option>
                <option value="s">Сальдо</option>
                <option value="g">Год</option>
              </select>
            </CollapsibleFilters>
            {backend && (
              <div className="checks-filters-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleReimportRules()}
                >
                  Импорт
                </button>
                <button type="button" className="btn btn-primary" onClick={handleNew}>
                  + Новое
                </button>
              </div>
            )}
          </div>

          <div className="checks-layout rash-constructor-layout">
            <div className="checks-list-panel">
              {loading ? (
                <div className="loading">Загрузка…</div>
              ) : items.length === 0 ? (
                <p className="tools-hint">Нет правил по фильтру.</p>
              ) : (
                <div className="rash-rule-catalog">
                  {items.map((r) => {
                    const cross =
                      (r.sourceForm && r.sourceForm !== r.targetForm) ||
                      (r.endForm && r.endForm !== r.targetForm);
                    return (
                      <button
                        type="button"
                        key={r.number}
                        className={`rash-rule-card${selected?.number === r.number ? " selected" : ""}`}
                        onClick={() => selectRule(r)}
                      >
                        <span className="rash-rule-card-title">
                          <strong>№{r.number}</strong> {r.name || "без названия"}
                          {cross ? (
                            <span
                              className="checks-cross-badge"
                              title="Есть ячейки другой формы"
                            >
                              ↔
                            </span>
                          ) : null}
                        </span>
                        <span className="rash-rule-card-meta">
                          <span>Цель: {cellLabel(r.targetForm, r.targetColumn, r.targetRow)}</span>
                          <span>
                            Источник: {cellLabel(r.sourceForm, r.sourceColumn, r.sourceRow)}
                          </span>
                          <span>
                            {[r.saldoT && "T", r.saldoS && "S", r.saldoG && "G"]
                              .filter(Boolean)
                              .join("/") || "—"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="toolbar-actions" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  ←
                </button>
                <span className="muted">
                  {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} / {total}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  →
                </button>
              </div>
            </div>

            <div className="checks-detail-panel">
              {editing ? (
                <>
                  <header className="rash-constructor-header">
                    <div>
                      <h2>
                        {selected
                          ? `Правило №${draft.number}: ${draft.name || "без названия"}`
                          : "Новое правило"}
                      </h2>
                      <span className="status-badge accepted">
                        {[draft.saldoT && "T", draft.saldoS && "S", draft.saldoG && "G"]
                          .filter(Boolean)
                          .join("/") || "—"}
                      </span>
                    </div>
                  </header>

                  <EditorWizardSteps
                    steps={WIZARD_STEPS}
                    value={wizardStep}
                    onChange={(step) => setWizardStep(step as WizardStep)}
                  />

                  {wizardStep === 1 && (
                    <section className="tools-section">
                      <h2>1. Основное</h2>
                      <div className="checks-form-grid">
                        <label>
                          № правила
                          <input
                            type="number"
                            value={draft.number || ""}
                            disabled={!!selected}
                            onChange={(e) =>
                              setDraft({ ...draft, number: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Наименование
                          <input
                            value={draft.name ?? ""}
                            onChange={(e) =>
                              setDraft({ ...draft, name: e.target.value || null })
                            }
                            placeholder="Нематериальные активы"
                          />
                        </label>
                        <div className="checks-flags full-width">
                          <label className="check-flag">
                            <input
                              type="checkbox"
                              checked={draft.saldoT}
                              onChange={(e) =>
                                setDraft({ ...draft, saldoT: e.target.checked })
                              }
                            />
                            Текущий
                          </label>
                          <label className="check-flag">
                            <input
                              type="checkbox"
                              checked={draft.saldoS}
                              onChange={(e) =>
                                setDraft({ ...draft, saldoS: e.target.checked })
                              }
                            />
                            Сальдо
                          </label>
                          <label className="check-flag">
                            <input
                              type="checkbox"
                              checked={draft.saldoG}
                              onChange={(e) =>
                                setDraft({ ...draft, saldoG: e.target.checked })
                              }
                            />
                            Год
                          </label>
                          <label className="check-flag">
                            <input
                              type="checkbox"
                              checked={!!draft.conditional}
                              onChange={(e) =>
                                setDraft({ ...draft, conditional: e.target.checked })
                              }
                            />
                            Условное
                          </label>
                        </div>
                      </div>
                    </section>
                  )}

                  {wizardStep === 2 && (
                    <section className="tools-section">
                      <h2>2. Цель</h2>
                      <p className="tools-hint">
                        Текущая цель: <strong>{cellLabel(draft.targetForm, draft.targetColumn, draft.targetRow)}</strong>
                      </p>
                      <FormCellGrid
                        workspaceFormId={draft.targetForm}
                        gridFormId={targetGridFormId}
                        onGridFormIdChange={setTargetGridFormId}
                        activeCellKeys={targetMaps.active}
                        cellOwners={targetMaps.owners}
                        currentOwnerId={
                          draft.number ? `№${draft.number}` : undefined
                        }
                        pickHint="Отметьте целевую ячейку. Чужие настройки — ссылкой №…"
                        onPick={(pick) =>
                          setDraft((prev) => applyPickToRule(prev, "target", pick))
                        }
                        onClear={() =>
                          setDraft((prev) => clearSlot(prev, "target"))
                        }
                        onOpenOwner={(ownerId) => {
                          const num = Number(String(ownerId).replace(/^№/, ""));
                          const rule = items.find((r) => r.number === num);
                          if (rule) selectRule(rule);
                        }}
                      />
                    </section>
                  )}

                  {wizardStep === 3 && (
                    <section className="tools-section">
                      <h2>3. Источник</h2>
                      <div className="rash-mode-cards">
                        {(["source", "end"] as const).map((slot) => (
                          <label
                            key={slot}
                            className={`rash-mode-card${sourceSlot === slot ? " selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name="saldo-source-slot"
                              checked={sourceSlot === slot}
                              onChange={() => {
                                setSourceSlot(slot);
                                const formId =
                                  slot === "source" ? draft.sourceForm : draft.endForm;
                                setSourceGridFormId(
                                  formId || draft.targetForm || formFilter || ""
                                );
                              }}
                            />
                            <strong>{slot === "source" ? "Источник" : "Конец (год)"}</strong>
                            <span>
                              {slot === "source"
                                ? cellLabel(draft.sourceForm, draft.sourceColumn, draft.sourceRow)
                                : cellLabel(draft.endForm, draft.endColumn, draft.endRow)}
                            </span>
                          </label>
                        ))}
                      </div>
                      <FormCellGrid
                        workspaceFormId={draft.targetForm}
                        gridFormId={sourceGridFormId}
                        onGridFormIdChange={setSourceGridFormId}
                        activeCellKeys={sourceMaps.active}
                        cellOwners={sourceMaps.owners}
                        currentOwnerId={
                          draft.number ? `№${draft.number}` : undefined
                        }
                        pickHint={sourcePickHint}
                        onPick={(pick) =>
                          setDraft((prev) => applyPickToRule(prev, sourceSlot, pick))
                        }
                        onClear={() =>
                          setDraft((prev) => clearSlot(prev, sourceSlot))
                        }
                        onOpenOwner={(ownerId) => {
                          const num = Number(String(ownerId).replace(/^№/, ""));
                          const rule = items.find((r) => r.number === num);
                          if (rule) selectRule(rule);
                        }}
                      />
                    </section>
                  )}

                  {wizardStep === 4 && (
                    <section className="tools-section">
                      <h2>4. Проверка перед сохранением</h2>
                      {canSave ? (
                        <p className="status-ok">Правило заполнено корректно и готово к сохранению.</p>
                      ) : (
                        <ul className="rash-validation">
                          <li className="err">Укажите номер и целевую ячейку (форму, графу).</li>
                        </ul>
                      )}
                      <div className="rash-rule-summary">
                        <p>
                          Цель: <strong>{cellLabel(draft.targetForm, draft.targetColumn, draft.targetRow)}</strong>
                        </p>
                        <p>
                          Источник: <strong>{cellLabel(draft.sourceForm, draft.sourceColumn, draft.sourceRow)}</strong>
                        </p>
                        <p>
                          Конец (год): <strong>{cellLabel(draft.endForm, draft.endColumn, draft.endRow)}</strong>
                        </p>
                        <p>
                          Типы:{" "}
                          <strong>
                            {[draft.saldoT && "T", draft.saldoS && "S", draft.saldoG && "G"]
                              .filter(Boolean)
                              .join("/") || "—"}
                          </strong>
                          {draft.conditional ? ", условное" : ""}
                        </p>
                      </div>
                    </section>
                  )}

                  <EditorWizardNav
                    step={wizardStep}
                    maxStep={4}
                    onBack={() => setWizardStep((wizardStep - 1) as WizardStep)}
                    onNext={() => setWizardStep((wizardStep + 1) as WizardStep)}
                    nextDisabled={stepBlocked}
                  >
                    {backend && (
                      <>
                        <span>{selected ? "Изменения" : "Новое правило"}</span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!canSave}
                          onClick={() => void handleSaveRule()}
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleDiscard}
                        >
                          Отменить
                        </button>
                        {selected && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void handleDeleteRule()}
                          >
                            Удалить
                          </button>
                        )}
                      </>
                    )}
                  </EditorWizardNav>
                </>
              ) : (
                <p className="tools-hint">
                  Выберите правило слева или «+ Новое», чтобы задать цель, источник и
                  (опционально) конечную ячейку переноса остатка.
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="checks-layout">
          <section className="checks-list-panel">
            <div className="checks-list-toolbar">
              <h2 className="checks-panel-title">Формы</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleReimportCorr()}
              >
                Импорт из файла
              </button>
            </div>
            {loading ? (
              <p className="loading">Загрузка…</p>
            ) : (
              <table className="checks-table">
                <thead>
                  <tr>
                    <th>Форма</th>
                    <th>Жёлтый</th>
                    <th>Красный</th>
                    <th>Синий</th>
                    <th>Зелёный</th>
                    <th>Reorg</th>
                  </tr>
                </thead>
                <tbody>
                  {corrItems.map((f) => (
                    <tr
                      key={f.formId}
                      className={corrSelected?.formId === f.formId ? "selected" : ""}
                      onClick={() => selectCorr(f)}
                    >
                      <td>{f.formId}</td>
                      <td className="expr-cell">{f.saldoYellow ? "✓" : ""}</td>
                      <td>{f.saldoRed ? "✓" : ""}</td>
                      <td>{f.saldoBlue ? "✓" : ""}</td>
                      <td>{f.saldoGreen ? "✓" : ""}</td>
                      <td>{f.reorgUpdate || f.reorgUpdate2 ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="checks-detail-panel">
            <h2>Соответствие форм — {corrDraft.formId || "—"}</h2>
            <p className="admin-desc">
              Маски граф FormCorrespondence: сальдо и цветовые режимы свода.
            </p>
            <div className="checks-form-grid">
              <label>
                Жёлтый — предыдущий период
                <textarea
                  id="corr-field-saldo-yellow"
                  rows={3}
                  value={corrDraft.saldoYellow ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      saldoYellow: e.target.value || null,
                    })
                  }
                  placeholder="B,C,D-*;"
                />
              </label>
              <label>
                Красный — аналогичный период прошлого года
                <textarea
                  id="corr-field-saldo-red"
                  rows={3}
                  value={corrDraft.saldoRed ?? ""}
                  onChange={(e) =>
                    setCorrDraft({ ...corrDraft, saldoRed: e.target.value || null })
                  }
                  placeholder="B,C-*;"
                />
              </label>
              <label>
                Синий (свод / сальдо)
                <textarea
                  id="corr-field-saldo-blue"
                  rows={3}
                  value={corrDraft.saldoBlue ?? ""}
                  onChange={(e) =>
                    setCorrDraft({ ...corrDraft, saldoBlue: e.target.value || null })
                  }
                />
              </label>
              <label>
                Зелёный (свод / реорганизация)
                <textarea
                  id="corr-field-saldo-green"
                  rows={3}
                  value={corrDraft.saldoGreen ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      saldoGreen: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                YellowCorr
                <textarea
                  id="corr-field-saldo-yellow-corr"
                  rows={2}
                  value={corrDraft.saldoYellowCorr ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      saldoYellowCorr: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                RedCorr
                <textarea
                  id="corr-field-saldo-red-corr"
                  rows={2}
                  value={corrDraft.saldoRedCorr ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      saldoRedCorr: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                BlueCorr
                <textarea
                  id="corr-field-saldo-blue-corr"
                  rows={2}
                  value={corrDraft.saldoBlueCorr ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      saldoBlueCorr: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                ReorgUpdate
                <input
                  type="text"
                  value={corrDraft.reorgUpdate ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      reorgUpdate: e.target.value || null,
                    })
                  }
                  placeholder="*"
                />
              </label>
              <label>
                ReorgUpdate2
                <input
                  type="text"
                  value={corrDraft.reorgUpdate2 ?? ""}
                  onChange={(e) =>
                    setCorrDraft({
                      ...corrDraft,
                      reorgUpdate2: e.target.value || null,
                    })
                  }
                  placeholder="*"
                />
              </label>
            </div>
            <div className="checks-actions">
              <button type="button" className="btn btn-primary" onClick={() => void handleSaveCorr()}>
                Сохранить
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
