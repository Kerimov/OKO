import { useCallback, useEffect, useState } from "react";
import {
  createSaldoRule,
  deleteSaldoRule,
  fetchSaldoPage,
  fetchSaldoStats,
  loadFormCorrespondence,
  reimportCorrespondenceFromJson,
  reimportSaldoFromJson,
  saveFormCorrespondence,
  saveSaldoRule,
  type FormCorrespondenceItem,
  type SaldoRule,
} from "../api";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";

type Tab = "rules" | "correspondence";

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

export function SaldoEditorPage() {
  const backend = isBackendMode();
  const [tab, setTab] = useState<Tab>("rules");
  const [stats, setStats] = useState<{
    total: number;
    typeT: number;
    typeS: number;
    typeG: number;
  } | null>(null);
  const [items, setItems] = useState<SaldoRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [saldoType, setSaldoType] = useState<"" | "t" | "s" | "g">("");
  const [selected, setSelected] = useState<SaldoRule | null>(null);
  const [draft, setDraft] = useState<SaldoRule>(EMPTY_RULE);
  const [corrItems, setCorrItems] = useState<FormCorrespondenceItem[]>([]);
  const [corrSelected, setCorrSelected] = useState<FormCorrespondenceItem | null>(null);
  const [corrDraft, setCorrDraft] = useState<FormCorrespondenceItem>(EMPTY_CORR);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 40;

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
      if (!corrSelected && data.forms.length) {
        setCorrSelected(data.forms[0]);
        setCorrDraft({ ...data.forms[0] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, corrSelected]);

  useEffect(() => {
    if (tab === "rules") loadRulesPage();
    else loadCorrespondence();
  }, [tab, loadRulesPage, loadCorrespondence]);

  const selectRule = (rule: SaldoRule) => {
    setSelected(rule);
    setDraft({ ...rule });
  };

  const selectCorr = (item: FormCorrespondenceItem) => {
    setCorrSelected(item);
    setCorrDraft({ ...item });
  };

  const handleSaveRule = async () => {
    if (!draft.number || !draft.targetForm.trim()) {
      setError("Укажите номер и целевую форму");
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
      await loadRulesPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDeleteRule = async () => {
    if (!selected) return;
    if (!confirm(`Удалить правило сальdo №${selected.number}?`)) return;
    try {
      await deleteSaldoRule(selected.number);
      setSelected(null);
      setDraft(EMPTY_RULE);
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
    if (!confirm("Перезаписать правила колонок из form-correspondence.json?")) return;
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

  return (
    <div className="admin-page checks-editor saldo-editor">
      <header className="admin-header">
        <div>
          <h1>Сальдо</h1>
          <p className="admin-desc">
            Правила переноса входящих остатков: детальные правила и соответствие граф форм.
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
        <div className="checks-layout">
          <section className="checks-list-panel">
            <div className="checks-filters">
              <input
                type="search"
                placeholder="Поиск по №, имени, форме…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                className="search-input"
              />
              <input
                placeholder="Форма, напр. N01_1"
                value={formFilter}
                onChange={(e) => {
                  setFormFilter(e.target.value);
                  setOffset(0);
                }}
                className="category-select"
              />
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimportRules}>
                Импорт из файла
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setSelected(null);
                  setDraft({ ...EMPTY_RULE, number: (items[0]?.number ?? 0) + 1 });
                }}
              >
                + Новое
              </button>
            </div>

            {loading ? (
              <p className="loading">Загрузка…</p>
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
                    {items.map((r) => (
                      <tr
                        key={r.number}
                        className={selected?.number === r.number ? "selected" : ""}
                        onClick={() => selectRule(r)}
                      >
                        <td>{r.number}</td>
                        <td className="expr-cell" title={r.name ?? ""}>
                          {r.targetForm} {r.targetColumn}
                          {r.targetRow != null ? ` R${r.targetRow}` : ""}
                        </td>
                        <td>
                          {r.sourceForm ?? "—"} {r.sourceColumn ?? ""}
                          {r.sourceRow != null ? ` R${r.sourceRow}` : ""}
                        </td>
                        <td>
                          {[r.saldoT && "T", r.saldoS && "S", r.saldoG && "G"].filter(Boolean).join("/") ||
                            "—"}
                        </td>
                      </tr>
                    ))}
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

          <section className="checks-detail-panel">
            <h2>{selected ? `Правило №${selected.number}` : "Новое правило"}</h2>
            <div className="checks-form-grid">
              <p className="form-section-label">Общее</p>
              <label>
                № правила
                <input
                  type="number"
                  value={draft.number || ""}
                  disabled={!!selected}
                  onChange={(e) => setDraft({ ...draft, number: Number(e.target.value) })}
                />
              </label>
              <label>
                Наименование строки
                <input
                  value={draft.name ?? ""}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value || null })}
                  placeholder="Нематериальные активы"
                />
              </label>

              <p className="form-section-label">Цель (куда записывается)</p>
              <label>
                Форма
                <input
                  value={draft.targetForm}
                  onChange={(e) => setDraft({ ...draft, targetForm: e.target.value })}
                  placeholder="N01_1"
                />
              </label>
              <label>
                Колонка
                <input
                  value={draft.targetColumn}
                  onChange={(e) => setDraft({ ...draft, targetColumn: e.target.value })}
                  placeholder="B"
                />
              </label>
              <label>
                Номер строки
                <input
                  type="number"
                  value={draft.targetRow ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      targetRow: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="1110"
                />
              </label>

              <p className="form-section-label">Источник (откуда берётся)</p>
              <label>
                Форма
                <input
                  value={draft.sourceForm ?? ""}
                  onChange={(e) => setDraft({ ...draft, sourceForm: e.target.value || null })}
                  placeholder="N01_1"
                />
              </label>
              <label>
                Колонка
                <input
                  value={draft.sourceColumn ?? ""}
                  onChange={(e) => setDraft({ ...draft, sourceColumn: e.target.value || null })}
                  placeholder="B"
                />
              </label>
              <label>
                Номер строки
                <input
                  type="number"
                  value={draft.sourceRow ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sourceRow: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="1110"
                />
              </label>

              <p className="form-section-label">Тип переноса</p>
              <div className="checks-flags">
              <label className="check-flag">
                <input
                  type="checkbox"
                  checked={draft.saldoT}
                  onChange={(e) => setDraft({ ...draft, saldoT: e.target.checked })}
                />
                Текущий
              </label>
              <label className="check-flag">
                <input
                  type="checkbox"
                  checked={draft.saldoS}
                  onChange={(e) => setDraft({ ...draft, saldoS: e.target.checked })}
                />
                Сальдо
              </label>
              <label className="check-flag">
                <input
                  type="checkbox"
                  checked={draft.saldoG}
                  onChange={(e) => setDraft({ ...draft, saldoG: e.target.checked })}
                />
                Год
              </label>
              <label className="check-flag">
                <input
                  type="checkbox"
                  checked={!!draft.conditional}
                  onChange={(e) => setDraft({ ...draft, conditional: e.target.checked })}
                />
                Условное
              </label>
              </div>
            </div>
            <div className="checks-actions">
              <button type="button" className="btn btn-primary" onClick={handleSaveRule}>
                Сохранить
              </button>
              {selected && (
                <button type="button" className="btn btn-danger" onClick={handleDeleteRule}>
                  Удалить
                </button>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="checks-layout">
          <section className="checks-list-panel">
            <div className="checks-filters">
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimportCorr}>
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
              Маски граф FormCorrespondence: сальдо (жёлтый/красный), цветовые режимы свода
              AggrSetReorg* (синий/зелёный) и флаг ReorgUpdate.
            </p>
            <div className="checks-form-grid">
            <label>
              Жёлтый — предыдущий период
              <textarea
                rows={3}
                value={corrDraft.saldoYellow ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, saldoYellow: e.target.value || null })
                }
                placeholder="B,C,D-*;"
                title="Yellow"
              />
            </label>
            <label>
              Красный — аналогичный период прошлого года
              <textarea
                rows={3}
                value={corrDraft.saldoRed ?? ""}
                onChange={(e) => setCorrDraft({ ...corrDraft, saldoRed: e.target.value || null })}
                placeholder="B,C-*;"
                title="Red"
              />
            </label>
            <label>
              Синий (свод / сальдо)
              <textarea
                rows={3}
                value={corrDraft.saldoBlue ?? ""}
                onChange={(e) => setCorrDraft({ ...corrDraft, saldoBlue: e.target.value || null })}
                title="Blue"
              />
            </label>
            <label>
              Зелёный (свод / реорганизация)
              <textarea
                rows={3}
                value={corrDraft.saldoGreen ?? ""}
                onChange={(e) => setCorrDraft({ ...corrDraft, saldoGreen: e.target.value || null })}
                title="Green"
              />
            </label>
            <label>
              YellowCorr
              <textarea
                rows={2}
                value={corrDraft.saldoYellowCorr ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, saldoYellowCorr: e.target.value || null })
                }
                placeholder="*-110;*-120;"
                title="YellowCorr"
              />
            </label>
            <label>
              RedCorr
              <textarea
                rows={2}
                value={corrDraft.saldoRedCorr ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, saldoRedCorr: e.target.value || null })
                }
                title="RedCorr"
              />
            </label>
            <label>
              BlueCorr
              <textarea
                rows={2}
                value={corrDraft.saldoBlueCorr ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, saldoBlueCorr: e.target.value || null })
                }
                title="BlueCorr"
              />
            </label>
            <label>
              ReorgUpdate
              <input
                type="text"
                value={corrDraft.reorgUpdate ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, reorgUpdate: e.target.value || null })
                }
                placeholder="*"
                title="ReorgUpdate"
              />
            </label>
            <label>
              ReorgUpdate2
              <input
                type="text"
                value={corrDraft.reorgUpdate2 ?? ""}
                onChange={(e) =>
                  setCorrDraft({ ...corrDraft, reorgUpdate2: e.target.value || null })
                }
                placeholder="*"
                title="ReorgUpdate2"
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
