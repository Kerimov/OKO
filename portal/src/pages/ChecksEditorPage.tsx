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
  /** Форма, чьи увязки показываем в списке. */
  const [workspaceFormId, setWorkspaceFormId] = useState(
    () => searchParams.get("form") ?? ""
  );
  /** Форма таблицы ячеек (может быть другой для межформенных ссылок). */
  const [gridFormId, setGridFormId] = useState(
    () => searchParams.get("form") ?? ""
  );
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );
  const [onlyPeriod, setOnlyPeriod] = useState(false);
  const [selected, setSelected] = useState<CheckRule | null>(null);
  const [draft, setDraft] = useState<CheckRule>(EMPTY_RULE);
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
      if (workspaceFormId && ref.form === workspaceFormId) continue;
      forms.add(ref.form);
    }
    return [...forms].sort();
  }, [expressionPreview.refs, workspaceFormId]);

  const insertIntoExpression = useCallback(
    (text: string) => {
      const startFresh = !creating && selected == null;
      if (startFresh) {
        const nextNumber =
          items.reduce((max, r) => Math.max(max, r.number), 0) + 1 || 1;
        setCreating(true);
        setSelected(null);
        if (pickTarget === "expressionAlt") {
          setDraft({
            ...EMPTY_RULE,
            number: nextNumber,
            periodActive: true,
            expressionAlt: text,
          });
        } else {
          setDraft({
            ...EMPTY_RULE,
            number: nextNumber,
            periodActive: true,
            expression: text,
          });
        }
        return;
      }
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
    [pickTarget, creating, selected, items]
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
    if (!workspaceFormId) {
      setItems([]);
      setTotal(0);
      setStats(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchChecksPage({
          q: search || undefined,
          formId: workspaceFormId,
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
  }, [backend, search, workspaceFormId, onlyPeriod, offset]);

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
        setTestResult("");
        const refs = extractCellRefs(
          combineCheckExpression(r.expression, r.expressionAlt)
        );
        if (!workspaceFormId && refs[0]?.form) {
          setWorkspaceFormId(refs[0].form);
          setGridFormId(refs[0].form);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend, items, searchParams, selected?.number, workspaceFormId]);

  const selectWorkspaceForm = (formId: string) => {
    setWorkspaceFormId(formId);
    setGridFormId(formId);
    setOffset(0);
    setSelected(null);
    setDraft(EMPTY_RULE);
    setCreating(false);
    setReplaceFrom(null);
    setTestResult("");
    setStatus("");
  };

  const selectRule = (rule: CheckRule) => {
    setSelected(rule);
    setDraft({ ...rule });
    setCreating(false);
    setTestResult("");
  };

  const handleSave = async () => {
    if (!draft.number || !draft.expression.trim()) {
      setError("Укажите номер и выражение");
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
    setTestResult("");
    if (workspaceFormId) setGridFormId(workspaceFormId);
  };

  const editing = creating || selected != null;

  const access = useAdminAccess();

  if (!access.ok) {
    return <AdminAccessGate title="Редактор увязок" />;
  }

  return (
    <div className="admin-page checks-editor">
      <header className="admin-header">
        <div>
          <h1>Редактор увязок</h1>
          <p className="admin-desc">
            Выберите форму — справа список её увязок, ниже таблица ячеек для настройки.
            Увязка может ссылаться на ячейки других форм.
          </p>
        </div>
        {stats && (
          <div className="admin-stats">
            <span>Всего: {stats.total}</span>
            <span>Активных: {stats.active}</span>
            <span>Период: {stats.periodActive}</span>
            <span>Только агрег.: {stats.aggrOnly}</span>
          </div>
        )}
      </header>

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      <section className="checks-workspace-formbar">
        <label className="checks-workspace-form-select">
          Форма
          <select
            value={workspaceFormId}
            onChange={(e) => selectWorkspaceForm(e.target.value)}
          >
            <option value="">— выберите форму —</option>
            {formOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-flag">
          <input
            type="checkbox"
            checked={onlyPeriod}
            onChange={(e) => {
              setOnlyPeriod(e.target.checked);
              setOffset(0);
            }}
            disabled={!workspaceFormId}
          />
          Только для периода
        </label>
        <div className="checks-filters-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimport}>
            Импорт из файла
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!workspaceFormId}
            onClick={handleNew}
          >
            + Новая увязка
          </button>
        </div>
      </section>

      {!workspaceFormId ? (
        <section className="tools-section checks-workspace-empty">
          <h2>Выберите форму</h2>
          <p className="tools-hint">
            После выбора формы отобразятся увязки, в которых она участвует, и таблица
            её ячеек. Для межформенных правил в таблице можно переключиться на другую
            форму.
          </p>
        </section>
      ) : (
        <div className="checks-layout checks-layout-workspace">
          <section className="checks-list-panel">
            <div className="checks-list-toolbar">
              <h2 className="checks-panel-title">
                Увязки формы <code>{workspaceFormId}</code>
                {total > 0 ? ` · ${total}` : ""}
              </h2>
              <CollapsibleFilters
                activeCount={countActiveFilters(search.trim().length > 0)}
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
              </CollapsibleFilters>
            </div>

            {loading ? (
              <p className="loading">Загрузка…</p>
            ) : items.length === 0 ? (
              <p className="tools-hint">
                Для формы нет увязок
                {search ? " по фильтру" : ""}. Создайте новую или снимите поиск.
              </p>
            ) : (
              <>
                <table className="checks-table">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Выражение</th>
                      <th>П</th>
                      <th>А</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const refs = extractCellRefs(
                        combineCheckExpression(r.expression, r.expressionAlt)
                      );
                      const cross = refs.some((ref) => ref.form !== workspaceFormId);
                      return (
                        <tr
                          key={r.number}
                          className={selected?.number === r.number ? "selected" : ""}
                          onClick={() => selectRule(r)}
                        >
                          <td>
                            {r.number}
                            {cross ? (
                              <span className="checks-cross-badge" title="Ссылки на другие формы">
                                ↔
                              </span>
                            ) : null}
                          </td>
                          <td className="expr-cell" title={r.expression}>
                            {r.expression.slice(0, 80)}
                            {(r.expression?.length ?? 0) > 80 ? "…" : ""}
                          </td>
                          <td>{r.periodActive ? "✓" : ""}</td>
                          <td>{r.active ? "✓" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="checks-pager">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    ← Назад
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + limit, total)} из {total}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Вперёд →
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="checks-edit-panel">
            <h2>
              {selected
                ? `Увязка №${selected.number}`
                : creating
                  ? "Новая увязка"
                  : "Таблица и настройка"}
            </h2>
            <div className="checks-form">
              <CellPicker
                target={pickTarget}
                onTargetChange={setPickTarget}
                onInsert={insertIntoExpression}
                workspaceFormId={workspaceFormId}
                gridFormId={gridFormId}
                onGridFormIdChange={setGridFormId}
                usedCellKeys={usedCellKeys}
                activeCellKeys={activeCellKeys}
                cellOwners={cellOwners}
                replaceFrom={replaceFrom}
                onReplaceFromChange={setReplaceFrom}
                onRemoveActive={(pick) => {
                  if (!creating && selected == null) {
                    const owners = cellOwners.get(
                      cellKey(pick.rowNo, pick.columnKey)
                    );
                    if (owners?.[0] != null) {
                      void removeFromOwnerRule(owners[0], pick);
                      return;
                    }
                  }
                  applyRemoveToDraft(pick);
                }}
                onOpenOwner={(ruleNumber) => openOwnerRule(ruleNumber)}
                onRemoveOwner={(ruleNumber, pick) => {
                  void removeFromOwnerRule(ruleNumber, pick);
                }}
                onReplaceCell={(from, to) => applyReplaceToDraft(from, to)}
              />

              {!editing ? (
                <p className="tools-hint">
                  Выберите увязку слева или нажмите «+». На привязанной ячейке:
                  ✎ заменить, × удалить; клик по ● — меню.
                </p>
              ) : (
                <>
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
                  <label className="full-width">
                    Сообщение об ошибке
                    <input
                      value={draft.message ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, message: e.target.value || null })
                      }
                    />
                  </label>
                  <div className="checks-flags">
                    <label>
                      <input
                        type="checkbox"
                        checked={!!draft.periodActive}
                        onChange={(e) =>
                          setDraft({ ...draft, periodActive: e.target.checked })
                        }
                      />
                      Учитывать в проверке за период
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!draft.active}
                        onChange={(e) =>
                          setDraft({ ...draft, active: e.target.checked })
                        }
                      />
                      Активно
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!draft.forAggrOnly}
                        onChange={(e) =>
                          setDraft({ ...draft, forAggrOnly: e.target.checked })
                        }
                      />
                      Только для агрегации
                    </label>
                    <label>
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
                  <div className="checks-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleTest}
                    >
                      Проверить на данных
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSave}
                    >
                      Сохранить
                    </button>
                    {selected && (
                      <button
                        type="button"
                        className="btn btn-danger-outline"
                        onClick={handleDelete}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  {testResult && <p className="test-result">{testResult}</p>}
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
