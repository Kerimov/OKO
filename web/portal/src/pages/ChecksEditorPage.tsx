import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createCheckRule,
  deleteCheckRule,
  fetchCheckRule,
  fetchChecksPage,
  fetchChecksStats,
  loadCatalog,
  reimportChecksFromJson,
  saveCheckRule,
  testCheckExpressionApi,
} from "../api";
import type { CheckRule } from "../engine/checkEngine";
import {
  combineCheckExpression,
  evaluateCheckExpression,
  extractCellRefs,
  CheckParseError,
} from "../engine/cellExpression";
import {
  evalContextFromInstances,
  latestInstancePerTemplate,
  loadInstancesForCheck,
} from "../engine/instanceIndex";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";
import { EditorWizardNav, EditorWizardSteps } from "../components/EditorWizard";
import {
  CellPicker,
  cellKey,
  removeCellCallsFromExpression,
  replaceCellCallsInExpression,
  type CellPickTarget,
  type PickedCell,
} from "./checksEditor/CellPicker";

const EMPTY_RULE: CheckRule = {
  number: 0,
  expression: "",
  expressionAlt: null,
  message: null,
  forAggrOnly: false,
  firstLevel: false,
  active: false,
  periodActive: false,
};

const WIZARD_STEPS = ["Основное", "Выражение", "Проверка"];
type WizardStep = 1 | 2 | 3;

function refsToCellKeys(
  expression: string,
  expressionAlt: string | null | undefined,
  formId: string
): Set<string> {
  const keys = new Set<string>();
  if (!formId) return keys;
  const combined = combineCheckExpression(expression, expressionAlt);
  for (const ref of extractCellRefs(combined)) {
    if (ref.form !== formId) continue;
    keys.add(cellKey(ref.row, ref.column));
  }
  return keys;
}

function shortExpression(rule: CheckRule): string {
  const combined = combineCheckExpression(rule.expression, rule.expressionAlt);
  const trimmed = combined.trim();
  return trimmed.length > 70 ? `${trimmed.slice(0, 70)}…` : trimmed || "— пусто —";
}

export function ChecksEditorPage() {
  const backend = isBackendMode();
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    periodActive: number;
    aggrOnly: number;
  } | null>(null);
  const [items, setItems] = useState<CheckRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(
    () => searchParams.get("q") ?? searchParams.get("number") ?? ""
  );
  /** Форма-фильтр списка увязок (необязательная — пусто значит «все формы»). */
  const [formFilter, setFormFilter] = useState(() => searchParams.get("form") ?? "");
  /** Форма таблицы ячеек (может отличаться для межформенных ссылок). */
  const [gridFormId, setGridFormId] = useState(() => searchParams.get("form") ?? "");
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );
  const [onlyPeriod, setOnlyPeriod] = useState(false);
  const [selected, setSelected] = useState<CheckRule | null>(null);
  const [draft, setDraft] = useState<CheckRule>(EMPTY_RULE);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [pickTarget, setPickTarget] = useState<CellPickTarget>("expression");
  const [creating, setCreating] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState<PickedCell | null>(null);
  const limit = 80;

  const expressionPreview = useMemo(() => {
    const combined = combineCheckExpression(draft.expression, draft.expressionAlt);
    const refs = extractCellRefs(combined);
    return { combined, refs };
  }, [draft.expression, draft.expressionAlt]);

  const usedCellKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!gridFormId) return keys;
    for (const rule of items) {
      for (const key of refsToCellKeys(rule.expression, rule.expressionAlt, gridFormId)) {
        keys.add(key);
      }
    }
    return keys;
  }, [items, gridFormId]);

  const cellOwners = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!gridFormId) return map;
    for (const rule of items) {
      for (const key of refsToCellKeys(rule.expression, rule.expressionAlt, gridFormId)) {
        const list = map.get(key) ?? [];
        if (!list.includes(rule.number)) list.push(rule.number);
        map.set(key, list);
      }
    }
    return map;
  }, [items, gridFormId]);

  const activeCellKeys = useMemo(
    () => refsToCellKeys(draft.expression, draft.expressionAlt, gridFormId),
    [draft.expression, draft.expressionAlt, gridFormId]
  );

  const otherFormsInDraft = useMemo(() => {
    const forms = new Set<string>();
    for (const ref of expressionPreview.refs) {
      if (formFilter && ref.form === formFilter) continue;
      forms.add(ref.form);
    }
    return [...forms].sort();
  }, [expressionPreview.refs, formFilter]);

  const insertIntoExpression = useCallback(
    (text: string) => {
      setDraft((prev) => {
        if (pickTarget === "expressionAlt") {
          const cur = prev.expressionAlt ?? "";
          const next = cur.trim() ? `${cur}${text}` : text;
          return { ...prev, expressionAlt: next };
        }
        const cur = prev.expression;
        const next = cur.trim() ? `${cur}${text}` : text;
        return { ...prev, expression: next };
      });
    },
    [pickTarget]
  );

  const applyRemoveToDraft = useCallback((pick: PickedCell) => {
    setDraft((prev) => ({
      ...prev,
      expression: removeCellCallsFromExpression(prev.expression, pick),
      expressionAlt: prev.expressionAlt
        ? removeCellCallsFromExpression(prev.expressionAlt, pick) || null
        : null,
    }));
    setReplaceFrom(null);
  }, []);

  const applyReplaceToDraft = useCallback((from: PickedCell, to: PickedCell) => {
    setDraft((prev) => ({
      ...prev,
      expression: replaceCellCallsInExpression(prev.expression, from, to),
      expressionAlt: prev.expressionAlt
        ? replaceCellCallsInExpression(prev.expressionAlt, from, to) || null
        : null,
    }));
    setReplaceFrom(null);
  }, []);

  const openOwnerRule = useCallback(
    (ruleNumber: number) => {
      const rule = items.find((r) => r.number === ruleNumber);
      if (!rule) return;
      setSelected(rule);
      setDraft({ ...rule });
      setCreating(false);
      setWizardStep(2);
      setTestResult("");
      setReplaceFrom(null);
    },
    [items]
  );

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setFormOptions(
          catalog.forms.map((f) => ({
            id: f.id,
            label: f.title ? `${f.id} — ${f.title}` : f.id,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchChecksPage({
          q: search || undefined,
          formId: formFilter || undefined,
          periodActive: onlyPeriod || undefined,
          limit,
          offset,
        }),
        fetchChecksStats(),
      ]);
      setItems(page.items);
      setTotal(page.total);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, onlyPeriod, offset]);

  const removeFromOwnerRule = useCallback(
    async (ruleNumber: number, pick: PickedCell) => {
      const rule = items.find((r) => r.number === ruleNumber);
      if (!rule) return;
      if (
        !confirm(
          `Удалить привязку ${pick.formId} · ${pick.columnKey} · ${pick.rowNo} из увязки №${ruleNumber}?`
        )
      ) {
        return;
      }
      const next: CheckRule = {
        ...rule,
        expression: removeCellCallsFromExpression(rule.expression, pick),
        expressionAlt: rule.expressionAlt
          ? removeCellCallsFromExpression(rule.expressionAlt, pick) || null
          : null,
      };
      if (!next.expression.trim() && !(next.expressionAlt ?? "").trim()) {
        setError(
          "После удаления выражение пустое — сохраните вручную или удалите увязку"
        );
        setSelected(rule);
        setDraft(next);
        setCreating(false);
        return;
      }
      try {
        await saveCheckRule(next);
        setStatus(`Увязка №${ruleNumber}: привязка удалена`);
        setSelected(next);
        setDraft(next);
        setCreating(false);
        await loadPage();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
        setSelected(rule);
        setDraft(next);
        setCreating(false);
      }
    },
    [items, loadPage]
  );

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    const raw = searchParams.get("number") ?? searchParams.get("q");
    if (!raw || !backend) return;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return;
    if (selected?.number === num) return;
    const fromList = items.find((r) => r.number === num);
    if (fromList) {
      setSelected(fromList);
      setDraft({ ...fromList });
      setCreating(false);
      setWizardStep(1);
      setTestResult("");
      return;
    }
    let cancelled = false;
    void fetchCheckRule(num)
      .then((rule) => {
        if (cancelled || !rule) return;
        const r = rule as CheckRule;
        setSelected(r);
        setDraft({ ...r });
        setCreating(false);
        setWizardStep(1);
        setTestResult("");
        const refs = extractCellRefs(
          combineCheckExpression(r.expression, r.expressionAlt)
        );
        if (refs[0]?.form) setGridFormId(refs[0].form);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend, items, searchParams, selected?.number]);

  const selectRule = (rule: CheckRule) => {
    setSelected(rule);
    setDraft({ ...rule });
    setCreating(false);
    setWizardStep(1);
    setTestResult("");
    setReplaceFrom(null);
    const refs = extractCellRefs(
      combineCheckExpression(rule.expression, rule.expressionAlt)
    );
    if (refs[0]?.form) setGridFormId(refs[0].form);
    else if (formFilter) setGridFormId(formFilter);
  };

  const handleSave = async () => {
    if (!draft.number || !draft.expression.trim()) {
      setError("Укажите номер и выражение");
      setWizardStep(draft.number ? 2 : 1);
      return;
    }
    try {
      if (selected) {
        await saveCheckRule(draft);
      } else {
        await createCheckRule(draft);
      }
      setStatus(`Правило ${draft.number} сохранено`);
      setSelected(draft);
      setCreating(false);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Удалить увязку №${selected.number}?`)) return;
    try {
      await deleteCheckRule(selected.number);
      setSelected(null);
      setDraft(EMPTY_RULE);
      setCreating(false);
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (
      !confirm(
        "Перезаписать все увязки из checks.json? Текущие изменения в БД будут потеряны."
      )
    ) {
      return;
    }
    try {
      const r = await reimportChecksFromJson();
      setStatus(`Импортировано ${r.reimported} правил`);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const handleTest = async () => {
    setTestResult("");
    const expr = combineCheckExpression(draft.expression, draft.expressionAlt);
    try {
      if (isBackendMode()) {
        const result = await testCheckExpressionApi({
          expression: draft.expression,
          expressionAlt: draft.expressionAlt,
        });
        setTestResult(result.message);
        return;
      }
      const instances = await loadInstancesForCheck();
      const latest = latestInstancePerTemplate(instances);
      const ctx = evalContextFromInstances(latest);
      const result = evaluateCheckExpression(expr, ctx);
      if (result.ok) {
        setTestResult(
          `OK — условие выполнено (лево=${result.left}, право=${result.right})`
        );
      } else {
        setTestResult(
          `Не выполнено: ${result.failedClause ?? expr} (лево=${result.left}, право=${result.right})`
        );
      }
    } catch (e) {
      if (e instanceof CheckParseError) {
        setTestResult(`Ошибка разбора: ${e.message}`);
      } else {
        setTestResult(e instanceof Error ? e.message : "Ошибка проверки");
      }
    }
  };

  const handleNew = () => {
    const nextNumber =
      items.reduce((max, r) => Math.max(max, r.number), 0) + 1 || 1;
    setSelected(null);
    setDraft({ ...EMPTY_RULE, number: nextNumber, periodActive: true });
    setCreating(true);
    setWizardStep(1);
    setTestResult("");
    setReplaceFrom(null);
    if (formFilter) setGridFormId(formFilter);
  };

  const editing = creating || selected != null;

  const access = useAdminAccess();

  if (!access.ok) {
    return <AdminAccessGate title="Конструктор увязок" />;
  }

  return (
    <div className="admin-editor-page rash-constructor-page">
      <h1>Конструктор увязок</h1>
      <p className="tools-intro">
        Список увязок слева, редактирование — справа. Увязка может ссылаться на ячейки
        нескольких форм: таблица ячеек и выбор формы находятся на шаге «Выражение».
      </p>

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      {stats && (
        <p className="tools-hint">
          Всего: <strong>{stats.total}</strong> · активных: <strong>{stats.active}</strong>{" "}
          · за период: <strong>{stats.periodActive}</strong> · только агрег.:{" "}
          <strong>{stats.aggrOnly}</strong>
        </p>
      )}

      <div className="editor-list-toolbar">
        <CollapsibleFilters
          activeCount={countActiveFilters(
            search.trim().length > 0,
            formFilter !== "",
            onlyPeriod
          )}
          bodyClassName="checks-filters"
        >
          <input
            type="search"
            placeholder="Поиск по №, выражению, сообщению…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="search-input"
          />
          <select
            value={formFilter}
            title="Включая увязки с привязками к форме"
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
          <label className="check-flag">
            <input
              type="checkbox"
              checked={onlyPeriod}
              onChange={(e) => {
                setOnlyPeriod(e.target.checked);
                setOffset(0);
              }}
            />
            Только для периода
          </label>
        </CollapsibleFilters>
        <div className="checks-filters-actions">
          <button type="button" className="btn btn-secondary" onClick={handleReimport}>
            Импорт из файла
          </button>
          <button type="button" className="btn btn-primary" onClick={handleNew}>
            + Новая увязка
          </button>
        </div>
      </div>

      <div className="checks-layout rash-constructor-layout">
        <div className="checks-list-panel">
          {loading ? (
            <div className="loading">Загрузка…</div>
          ) : items.length === 0 ? (
            <p className="tools-hint">
              Увязок не найдено{search || formFilter ? " по фильтру" : ""}. Создайте
              новую или снимите фильтры.
            </p>
          ) : (
            <div className="rash-rule-catalog">
              {items.map((r) => {
                const refs = extractCellRefs(
                  combineCheckExpression(r.expression, r.expressionAlt)
                );
                const forms = [...new Set(refs.map((ref) => ref.form))].sort();
                return (
                  <button
                    type="button"
                    key={r.number}
                    className={`rash-rule-card${
                      selected?.number === r.number ? " selected" : ""
                    }`}
                    onClick={() => selectRule(r)}
                  >
                    <span className="rash-rule-card-title">
                      <strong>№{r.number}</strong> {shortExpression(r)}
                    </span>
                    <span className="rash-rule-card-meta">
                      <span>{r.periodActive ? "За период" : "Не за период"}</span>
                      <span>{r.active ? "Активна" : "Выключена"}</span>
                      <span>{forms.join(", ") || "Без формы"}</span>
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
          {!editing ? (
            <p className="tools-hint">Выберите увязку или создайте новую</p>
          ) : (
            <>
              <header className="rash-constructor-header">
                <div>
                  <h2>{selected ? `Увязка №${draft.number}` : "Новая увязка"}</h2>
                  <span
                    className={`status-badge ${draft.active ? "accepted" : "returned"}`}
                  >
                    {draft.active ? "Активна" : "Выключена"}
                  </span>
                  {draft.periodActive && (
                    <span className="status-badge accepted">За период</span>
                  )}
                  {draft.forAggrOnly && (
                    <span className="status-badge">Только агрегация</span>
                  )}
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
                      Номер
                      <input
                        type="number"
                        value={draft.number || ""}
                        disabled={!!selected}
                        onChange={(e) =>
                          setDraft({ ...draft, number: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="full-width">
                      Сообщение об ошибке
                      <input
                        value={draft.message ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, message: e.target.value || null })
                        }
                      />
                    </label>
                    <label className="rash-check">
                      <input
                        type="checkbox"
                        checked={!!draft.periodActive}
                        onChange={(e) =>
                          setDraft({ ...draft, periodActive: e.target.checked })
                        }
                      />
                      Учитывать в проверке за период
                    </label>
                    <label className="rash-check">
                      <input
                        type="checkbox"
                        checked={!!draft.active}
                        onChange={(e) =>
                          setDraft({ ...draft, active: e.target.checked })
                        }
                      />
                      Активно
                    </label>
                    <label className="rash-check">
                      <input
                        type="checkbox"
                        checked={!!draft.forAggrOnly}
                        onChange={(e) =>
                          setDraft({ ...draft, forAggrOnly: e.target.checked })
                        }
                      />
                      Только для агрегации
                    </label>
                    <label className="rash-check">
                      <input
                        type="checkbox"
                        checked={!!draft.firstLevel}
                        onChange={(e) =>
                          setDraft({ ...draft, firstLevel: e.target.checked })
                        }
                      />
                      Первый уровень
                    </label>
                  </div>
                </section>
              )}

              {wizardStep === 2 && (
                <section className="tools-section">
                  <h2>2. Выражение</h2>
                  <CellPicker
                    target={pickTarget}
                    onTargetChange={setPickTarget}
                    onInsert={insertIntoExpression}
                    workspaceFormId={formFilter}
                    gridFormId={gridFormId}
                    onGridFormIdChange={setGridFormId}
                    usedCellKeys={usedCellKeys}
                    activeCellKeys={activeCellKeys}
                    cellOwners={cellOwners}
                    currentRuleNumber={draft.number || undefined}
                    replaceFrom={replaceFrom}
                    onReplaceFromChange={setReplaceFrom}
                    onRemoveActive={(pick) => applyRemoveToDraft(pick)}
                    onOpenOwner={(ruleNumber) => openOwnerRule(ruleNumber)}
                    onRemoveOwner={(ruleNumber, pick) => {
                      void removeFromOwnerRule(ruleNumber, pick);
                    }}
                    onReplaceCell={(from, to) => applyReplaceToDraft(from, to)}
                  />

                  <div className="checks-expression-preview">
                    <div className="checks-expression-preview-label">Предпросмотр</div>
                    <code className="checks-expression-preview-expr">
                      {expressionPreview.combined.trim() ||
                        "— выражение пока пустое —"}
                    </code>
                    {expressionPreview.refs.length > 0 ? (
                      <ul className="checks-expression-preview-refs">
                        {expressionPreview.refs.map((ref, i) => {
                          const pick: PickedCell = {
                            formId: ref.form,
                            columnKey: ref.column,
                            rowNo: String(ref.row),
                          };
                          return (
                            <li key={`${ref.form}-${ref.column}-${ref.row}-${i}`}>
                              <button
                                type="button"
                                className="checks-ref-jump"
                                onClick={() => setGridFormId(ref.form)}
                                title="Показать таблицу этой формы"
                              >
                                {ref.form}
                              </button>
                              {" · "}
                              {ref.column} · {ref.row}{" "}
                              <button
                                type="button"
                                className="checks-ref-act"
                                title="Заменить"
                                onClick={() => {
                                  setGridFormId(ref.form);
                                  setReplaceFrom(pick);
                                }}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="checks-ref-act is-del"
                                title="Удалить из выражения"
                                onClick={() => applyRemoveToDraft(pick)}
                              >
                                ×
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="tools-hint">
                        Ссылки Cell(...) появятся после выбора ячеек в таблице.
                      </p>
                    )}
                    {otherFormsInDraft.length > 0 ? (
                      <p className="tools-hint">
                        Другие формы в выражении:{" "}
                        {otherFormsInDraft.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ marginRight: 4 }}
                            onClick={() => setGridFormId(id)}
                          >
                            {id}
                          </button>
                        ))}
                      </p>
                    ) : null}
                  </div>

                  <label className="full-width">
                    Основное выражение
                    <textarea
                      rows={4}
                      value={draft.expression}
                      onChange={(e) =>
                        setDraft({ ...draft, expression: e.target.value })
                      }
                      placeholder='Cell("N01_1","B",1371)>=0'
                    />
                  </label>
                  <label className="full-width">
                    Дополнительное выражение
                    <textarea
                      rows={2}
                      value={draft.expressionAlt ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          expressionAlt: e.target.value || null,
                        })
                      }
                    />
                  </label>
                </section>
              )}

              {wizardStep === 3 && (
                <section className="tools-section">
                  <h2>3. Проверка</h2>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleTest()}
                  >
                    Проверить на данных
                  </button>
                  {testResult && <p className="test-result">{testResult}</p>}
                  <div className="rash-rule-summary">
                    <p>
                      Выражение:{" "}
                      <code>{expressionPreview.combined.trim() || "—"}</code>
                    </p>
                    <p>
                      Ссылок на ячейки: <strong>{expressionPreview.refs.length}</strong>
                      {otherFormsInDraft.length > 0
                        ? `, других форм: ${otherFormsInDraft.length}`
                        : ""}
                    </p>
                    <p>Сообщение об ошибке: {draft.message || "—"}</p>
                  </div>
                </section>
              )}

              <EditorWizardNav
                step={wizardStep}
                maxStep={3}
                onBack={() => setWizardStep((wizardStep - 1) as WizardStep)}
                onNext={() => setWizardStep((wizardStep + 1) as WizardStep)}
                nextDisabled={wizardStep === 1 && !draft.number}
              >
                <span>{draft.number ? `Черновик №${draft.number}` : "Заполните номер"}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleTest()}
                >
                  Проверить
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSave()}
                >
                  Сохранить
                </button>
                {selected && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void handleDelete()}
                  >
                    Удалить
                  </button>
                )}
              </EditorWizardNav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
