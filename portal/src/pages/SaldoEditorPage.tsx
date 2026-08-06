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
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";

type Tab = "rules" | "correspondence";
type PickSlot = "target" | "source" | "end";

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
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [workspaceFormId, setWorkspaceFormId] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [gridFormId, setGridFormId] = useState(
    () => searchParams.get("form") ?? searchParams.get("formId") ?? ""
  );
  const [formOptions, setFormOptions] = useState<Array<{ id: string; label: string }>>(
    []
  );
  const [saldoType, setSaldoType] = useState<"" | "t" | "s" | "g">("");
  const [selected, setSelected] = useState<SaldoRule | null>(null);
  const [draft, setDraft] = useState<SaldoRule>(EMPTY_RULE);
  const [creating, setCreating] = useState(false);
  const [pickSlot, setPickSlot] = useState<PickSlot>("target");
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

  const usedCellKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!gridFormId) return keys;
    for (const rule of items) collectKeysForForm(rule, gridFormId, keys);
    return keys;
  }, [items, gridFormId]);

  const activeCellKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!gridFormId || !editing) return keys;
    collectKeysForForm(draft, gridFormId, keys);
    return keys;
  }, [draft, gridFormId, editing]);

  const cellOwners = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!gridFormId) return map;
    for (const rule of items) {
      const keys = new Set<string>();
      collectKeysForForm(rule, gridFormId, keys);
      for (const key of keys) {
        const label = `№${rule.number}`;
        const list = map.get(key) ?? [];
        if (!list.includes(label)) list.push(label);
        map.set(key, list);
      }
    }
    return map;
  }, [items, gridFormId]);

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

  const loadRulesPage = useCallback(async () => {
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
        fetchSaldoPage({
          q: search || undefined,
          formId: workspaceFormId,
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
  }, [backend, search, workspaceFormId, saldoType, offset]);

  const loadCorrespondence = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const data = await loadFormCorrespondence();
      setCorrItems(data.forms);
      const wantId =
        searchParams.get("formId") || workspaceFormId || undefined;
      const pick =
        (wantId ? data.forms.find((f) => f.formId === wantId) : undefined) ??
        data.forms[0] ??
        null;
      if (pick) {
        setCorrSelected(pick);
        setCorrDraft({ ...pick });
        if (!workspaceFormId) setWorkspaceFormId(pick.formId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, searchParams, workspaceFormId]);

  useEffect(() => {
    if (tab === "rules") void loadRulesPage();
    else void loadCorrespondence();
  }, [tab, loadRulesPage, loadCorrespondence]);

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

  const selectWorkspaceForm = (formId: string) => {
    setWorkspaceFormId(formId);
    setGridFormId(formId);
    setOffset(0);
    setSelected(null);
    setDraft(EMPTY_RULE);
    setCreating(false);
    setPickSlot("target");
    setStatus("");
  };

  const selectRule = (rule: SaldoRule) => {
    setSelected(rule);
    setDraft({ ...rule });
    setCreating(false);
    setPickSlot("target");
    if (rule.targetForm) setGridFormId(rule.targetForm);
  };

  const handleNew = () => {
    if (!workspaceFormId) return;
    const nextNumber =
      items.reduce((max, r) => Math.max(max, r.number), 0) + 1 || 1;
    setSelected(null);
    setDraft({
      ...EMPTY_RULE,
      number: nextNumber,
      targetForm: workspaceFormId,
      saldoS: true,
    });
    setCreating(true);
    setPickSlot("target");
    setGridFormId(workspaceFormId);
  };

  const handlePick = (pick: FormCellPick) => {
    if (!editing) {
      const nextNumber =
        items.reduce((max, r) => Math.max(max, r.number), 0) + 1 || 1;
      setCreating(true);
      setSelected(null);
      setDraft(
        applyPickToRule(
          {
            ...EMPTY_RULE,
            number: nextNumber,
            targetForm: workspaceFormId || pick.formId,
            saldoS: true,
          },
          pickSlot === "source" || pickSlot === "end" ? pickSlot : "target",
          pick
        )
      );
      return;
    }
    setDraft((prev) => applyPickToRule(prev, pickSlot, pick));
  };

  const handleSaveRule = async () => {
    if (!draft.number || !draft.targetForm.trim()) {
      setError("Укажите номер и целевую ячейку (форму)");
      return;
    }
    try {
      if (selected) {
        await saveSaldoRule(draft);
      } else {
        await createSaldoRule(draft);
      }
      setStatus(`Правило ${draft.number} сохранено`);
      setSelected(draft);
      setCreating(false);
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
    setWorkspaceFormId(item.formId);
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
  if (!access.ok) {
    return <AdminAccessGate title="Сальдо" />;
  }

  const pickHint =
    pickSlot === "target"
      ? "Выбор цели: куда записывается остаток"
      : pickSlot === "source"
        ? "Выбор источника: откуда берётся значение (можно с другой формы)"
        : "Выбор конечной ячейки (год / закрытие)";

  return (
    <div className="admin-page checks-editor saldo-editor">
      <header className="admin-header">
        <div>
          <h1>Сальдо</h1>
          <p className="admin-desc">
            Выберите форму — правила переноса и таблица ячеек. Источник можно взять с
            другой формы (как переход между листами в Excel).
          </p>
        </div>
        {stats && tab === "rules" && (
          <div className="admin-stats">
            <span>Всего: {stats.total}</span>
            <span>Т: {stats.typeT}</span>
            <span>С: {stats.typeS}</span>
            <span>Г: {stats.typeG}</span>
          </div>
        )}
      </header>

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

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      {tab === "rules" ? (
        <>
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
            <select
              value={saldoType}
              onChange={(e) => {
                setSaldoType(e.target.value as "" | "t" | "s" | "g");
                setOffset(0);
              }}
              className="category-select"
              disabled={!workspaceFormId}
            >
              <option value="">Все типы</option>
              <option value="t">Текущий</option>
              <option value="s">Сальдо</option>
              <option value="g">Год</option>
            </select>
            <div className="checks-filters-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleReimportRules}
              >
                Импорт из файла
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!workspaceFormId}
                onClick={handleNew}
              >
                + Новое правило
              </button>
            </div>
          </section>

          {!workspaceFormId ? (
            <section className="tools-section checks-workspace-empty">
              <h2>Выберите форму</h2>
              <p className="tools-hint">
                После выбора отобразятся правила сальдо по форме и таблица ячеек для
                назначения цели и источника.
              </p>
            </section>
          ) : (
            <div className="checks-layout checks-layout-workspace">
              <section className="checks-list-panel">
                <div className="checks-list-toolbar">
                  <h2 className="checks-panel-title">
                    Правила · <code>{workspaceFormId}</code>
                    {total > 0 ? ` · ${total}` : ""}
                  </h2>
                  <CollapsibleFilters
                    activeCount={countActiveFilters(search.trim().length > 0)}
                    bodyClassName="checks-filters"
                  >
                    <input
                      type="search"
                      placeholder="Поиск по №, имени…"
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
                  <p className="tools-hint">Нет правил для формы.</p>
                ) : (
                  <>
                    <table className="checks-table">
                      <thead>
                        <tr>
                          <th>№</th>
                          <th>Цель</th>
                          <th>Источник</th>
                          <th>T/S/G</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((r) => {
                          const cross =
                            (r.sourceForm && r.sourceForm !== workspaceFormId) ||
                            (r.endForm && r.endForm !== workspaceFormId);
                          return (
                            <tr
                              key={r.number}
                              className={
                                selected?.number === r.number ? "selected" : ""
                              }
                              onClick={() => selectRule(r)}
                            >
                              <td>
                                {r.number}
                                {cross ? (
                                  <span
                                    className="checks-cross-badge"
                                    title="Есть ячейки другой формы"
                                  >
                                    ↔
                                  </span>
                                ) : null}
                              </td>
                              <td className="expr-cell">
                                {r.targetForm} {r.targetColumn}
                                {r.targetRow != null ? ` R${r.targetRow}` : ""}
                              </td>
                              <td>
                                {r.sourceForm ?? "—"} {r.sourceColumn ?? ""}
                                {r.sourceRow != null ? ` R${r.sourceRow}` : ""}
                              </td>
                              <td>
                                {[r.saldoT && "T", r.saldoS && "S", r.saldoG && "G"]
                                  .filter(Boolean)
                                  .join("/") || "—"}
                              </td>
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
                    ? `Правило №${selected.number}`
                    : creating
                      ? "Новое правило"
                      : "Таблица и настройка"}
                </h2>

                <div className="saldo-pick-slots" role="group" aria-label="Что выбираем">
                  {(
                    [
                      ["target", "Цель", cellLabel(draft.targetForm, draft.targetColumn, draft.targetRow)],
                      ["source", "Источник", cellLabel(draft.sourceForm, draft.sourceColumn, draft.sourceRow)],
                      ["end", "Конец (год)", cellLabel(draft.endForm, draft.endColumn, draft.endRow)],
                    ] as Array<[PickSlot, string, string]>
                  ).map(([slot, label, value]) => (
                    <button
                      key={slot}
                      type="button"
                      className={`saldo-pick-slot${pickSlot === slot ? " is-active" : ""}`}
                      onClick={() => {
                        setPickSlot(slot);
                        if (slot === "target" && draft.targetForm) {
                          setGridFormId(draft.targetForm);
                        } else if (slot === "source" && draft.sourceForm) {
                          setGridFormId(draft.sourceForm);
                        } else if (slot === "end" && draft.endForm) {
                          setGridFormId(draft.endForm);
                        } else if (workspaceFormId) {
                          setGridFormId(workspaceFormId);
                        }
                      }}
                    >
                      <span className="saldo-pick-slot-label">{label}</span>
                      <span className="saldo-pick-slot-value">{value}</span>
                    </button>
                  ))}
                </div>

                <FormCellGrid
                  workspaceFormId={workspaceFormId}
                  gridFormId={gridFormId}
                  onGridFormIdChange={setGridFormId}
                  usedCellKeys={usedCellKeys}
                  activeCellKeys={activeCellKeys}
                  cellOwners={cellOwners}
                  pickHint={pickHint}
                  onPick={handlePick}
                  onOpenOwner={(ownerId) => {
                    const num = Number(String(ownerId).replace(/^№/, ""));
                    const rule = items.find((r) => r.number === num);
                    if (rule) selectRule(rule);
                  }}
                />

                {editing ? (
                  <div className="checks-form-grid" style={{ marginTop: 12 }}>
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
                    <div className="checks-flags">
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
                    <div className="checks-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSaveRule}
                      >
                        Сохранить
                      </button>
                      {selected && (
                        <button
                          type="button"
                          className="btn btn-danger-outline"
                          onClick={handleDeleteRule}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="tools-hint">
                    Выберите правило слева или «+ Новое». Переключайте Цель / Источник,
                    для источника — «Другая форма…».
                  </p>
                )}
              </section>
            </div>
          )}
        </>
      ) : (
        <div className="checks-layout">
          <section className="checks-list-panel">
            <div className="checks-list-toolbar">
              <h2 className="checks-panel-title">Формы</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleReimportCorr}
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
              <button type="button" className="btn btn-primary" onClick={handleSaveCorr}>
                Сохранить
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
