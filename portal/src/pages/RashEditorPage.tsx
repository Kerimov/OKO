import { useCallback, useEffect, useState } from "react";
import {
  createRashRule,
  deleteRashRule,
  fetchRashPage,
  fetchRashPlacements,
  fetchRashRule,
  fetchRashStats,
  fetchRashThresholds,
  reimportRashFromJson,
  reimportRashPlacementsFromJson,
  saveRashAddsum,
  saveRashPlacements,
  saveRashRule,
  saveRashThresholds,
  type RashPlacement,
  type RashRule,
} from "../api";
import { KONTR_FORM_IDS } from "../constants";
import { getRashRulesForForm, parseTotalColumn } from "../engine/rashEngine";
import { clearRowRashIndexCache } from "../engine/rowRashIndex";
import type { RashAddsum, RashThresholds } from "../types";
import { isBackendMode } from "../storage";
import { useAdminAccess } from "../components/AdminAccessGate";

const EMPTY_RULE: RashRule = {
  kod: 0,
  name: "",
  note: null,
  refRows: null,
  totalFormula: null,
  refA1Name: null,
  refA1Title: null,
  refA2Name: null,
  refA2Title: null,
  refA3Name: null,
  refA3Title: null,
  refA4Name: null,
  refA4Title: null,
};

const FLD_TYPES = ["Сумма", "Количество", "Текст", "Дата"] as const;

const SPECIAL_MODES: Record<number, string> = {
  0: "закрыта — нет ввода",
  1: "закрыта — вычисляемая",
  2: "только сумма, без расшифровки",
  3: "устаревший движок t_ras",
  4: "устаревший движок «прочие»",
  6: "устаревший движок ras_vn",
};

type DetailTab = "rule" | "addsum" | "placements";

export function RashEditorPage() {
  const backend = isBackendMode();
  const [stats, setStats] = useState<{
    total: number;
    addsum: number;
    withFormula: number;
  } | null>(null);
  const [thresholds, setThresholds] = useState<RashThresholds | null>(null);
  const [items, setItems] = useState<RashRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [selected, setSelected] = useState<RashRule | null>(null);
  const [draft, setDraft] = useState<RashRule>(EMPTY_RULE);
  const [addsumDraft, setAddsumDraft] = useState<RashAddsum[]>([]);
  const [placementsDraft, setPlacementsDraft] = useState<
    Array<{ formId: string; rowNo: string; columnKey: string }>
  >([]);
  const [tab, setTab] = useState<DetailTab>("rule");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const limit = 40;
  const adminOk = useAdminAccess().ok;

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (backend) {
        const [page, st, th] = await Promise.all([
          fetchRashPage({
            q: search || undefined,
            formId: formFilter || undefined,
            limit,
            offset,
          }),
          fetchRashStats(),
          fetchRashThresholds(),
        ]);
        setItems(page.items);
        setTotal(page.total);
        setStats(st);
        setThresholds(th);
      } else {
        const { loadRashRules } = await import("../api");
        const data = await loadRashRules();
        setThresholds(data.thresholds);
        setStats({
          total: data.total,
          addsum: data.addsum.length,
          withFormula: data.rules.filter((r) => r.totalFormula).length,
        });
        let filtered = data.rules;
        const q = search.toLowerCase().trim();
        if (q) {
          filtered = filtered.filter(
            (r) =>
              String(r.kod).includes(q) ||
              (r.name ?? "").toLowerCase().includes(q) ||
              (r.refRows ?? "").toLowerCase().includes(q)
          );
        }
        if (formFilter) {
          filtered = getRashRulesForForm(filtered, formFilter);
        }
        setTotal(filtered.length);
        setItems(filtered.slice(offset, offset + limit));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, offset]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const loadDetail = async (rule: RashRule) => {
    setSelected(rule);
    setDraft({ ...EMPTY_RULE, ...rule });
    setTab("rule");
    if (!backend) {
      const { loadRashRules } = await import("../api");
      const data = await loadRashRules();
      setAddsumDraft(data.addsum.filter((a) => a.kod === rule.kod));
      setPlacementsDraft([]);
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      const full = await fetchRashRule(rule.kod);
      setDraft({ ...EMPTY_RULE, ...full });
      setAddsumDraft(full.addsum ?? []);
      const places = await fetchRashPlacements(rule.kod);
      setPlacementsDraft(
        places.map((p) => ({
          formId: p.formId,
          rowNo: p.rowNo,
          columnKey: p.columnKey,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки правила");
      setAddsumDraft([]);
      setPlacementsDraft([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleNew = () => {
    setSelected(null);
    setDraft({ ...EMPTY_RULE });
    setAddsumDraft([]);
    setPlacementsDraft([]);
    setTab("rule");
  };

  const handleSaveRule = async () => {
    if (!draft.kod || !draft.name.trim()) {
      setError("Укажите код расшифровки и тип / привязку к форме");
      return;
    }
    if (!backend) {
      setError("Редактирование доступно при подключении к API");
      return;
    }
    try {
      if (selected) await saveRashRule(draft);
      else await createRashRule(draft);
      setStatus(`Правило ${draft.kod} сохранено`);
      setSelected(draft);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleSaveAddsum = async () => {
    if (!selected || !backend) return;
    try {
      const saved = await saveRashAddsum(
        selected.kod,
        addsumDraft.map((a, i) => ({
          kod: selected.kod,
          sort: a.sort ?? i,
          sumTitle: a.sumTitle,
          fldType: a.fldType || "Сумма",
        }))
      );
      setAddsumDraft(saved);
      setStatus(`Дополнительные графы правила ${selected.kod}: ${saved.length}`);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения addsum");
    }
  };

  const handleSavePlacements = async () => {
    if (!selected || !backend) return;
    try {
      const saved = await saveRashPlacements(selected.kod, placementsDraft);
      setPlacementsDraft(
        saved.map((p: RashPlacement) => ({
          formId: p.formId,
          rowNo: p.rowNo,
          columnKey: p.columnKey,
        }))
      );
      clearRowRashIndexCache();
      setStatus(`Привязок для кода ${selected.kod}: ${saved.length}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения привязок");
    }
  };

  const handleDelete = async () => {
    if (!selected || !backend) return;
    if (
      !confirm(
        `Удалить расшифровку с кодом ${selected.kod} вместе с доп. графами и привязками к форме?`
      )
    )
      return;
    try {
      await deleteRashRule(selected.kod);
      handleNew();
      clearRowRashIndexCache();
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (!backend) return;
    if (!confirm("Перезагрузить правила и доп. графы из файла rash-rules.json?")) return;
    try {
      const { reimported } = await reimportRashFromJson();
      setStatus(`Импортировано правил: ${reimported}`);
      handleNew();
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const handleReimportPlacements = async () => {
    if (!backend) return;
    if (!confirm("Перезагрузить привязки ячеек из row-rash-index.json?")) return;
    try {
      const { reimported } = await reimportRashPlacementsFromJson();
      clearRowRashIndexCache();
      setStatus(`Импортировано привязок: ${reimported}`);
      if (selected) await loadDetail(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта привязок");
    }
  };

  const handleSaveThresholds = async () => {
    if (!thresholds || !backend) return;
    try {
      await saveRashThresholds(thresholds);
      setStatus("Пороги сохранены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения порогов");
    }
  };

  const modeHint = SPECIAL_MODES[draft.kod];

  return (
    <div className="admin-editor-page">
      <h1>Конструктор расшифровок</h1>
      <p className="tools-intro">
        Конструктор методологии расшифровок: правило, дополнительные графы окна и привязка к
        ячейкам шаблона формы. Заполнение контрагентов на отчётной форме — отдельно, через кнопку
        «…» в ячейке.
      </p>

      {!backend && (
        <div className="status-bar">Режим только чтения. Подключите API для редактирования.</div>
      )}
      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      {stats && (
        <p className="tools-hint">
          Правил: <strong>{stats.total}</strong>, с формулой итога:{" "}
          <strong>{stats.withFormula}</strong>, доп. граф: <strong>{stats.addsum}</strong>
        </p>
      )}

      {thresholds && (
        <section className="tools-section">
          <h2>Пороги обязательной расшифровки (тыс. руб.)</h2>
          <div className="tools-grid">
            <label>
              Уровень 1 ({thresholds.labels[0]})
              <input
                type="number"
                value={thresholds.level1}
                onChange={(e) => setThresholds({ ...thresholds, level1: Number(e.target.value) })}
              />
            </label>
            <label>
              Уровень 2 ({thresholds.labels[1]})
              <input
                type="number"
                value={thresholds.level2}
                onChange={(e) => setThresholds({ ...thresholds, level2: Number(e.target.value) })}
              />
            </label>
            <label>
              Уровень 3 ({thresholds.labels[2]})
              <input
                type="number"
                value={thresholds.level3}
                onChange={(e) => setThresholds({ ...thresholds, level3: Number(e.target.value) })}
              />
            </label>
          </div>
          {backend && adminOk && (
            <button type="button" className="btn btn-secondary" onClick={() => void handleSaveThresholds()}>
              Сохранить пороги
            </button>
          )}
        </section>
      )}

      <div className="checks-toolbar">
        <input
          placeholder="Поиск…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={formFilter}
          onChange={(e) => {
            setFormFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Все формы</option>
          {[...KONTR_FORM_IDS].sort().map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {backend && adminOk && (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void handleReimport()}>
              Импорт правил
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReimportPlacements()}
            >
              Импорт привязок
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleNew}>
              Новое правило
            </button>
          </>
        )}
      </div>

      <div className="checks-editor-layout">
        <div className="checks-list-panel">
          {loading ? (
            <div className="loading">Загрузка…</div>
          ) : (
            <table className="checks-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Тип / форма</th>
                  <th>Измерения</th>
                  <th>Итог</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const dims = [r.refA1Name, r.refA2Name, r.refA3Name, r.refA4Name].filter(Boolean)
                    .length;
                  return (
                    <tr
                      key={r.kod}
                      className={selected?.kod === r.kod ? "selected" : ""}
                      onClick={() => void loadDetail(r)}
                    >
                      <td>{r.kod}</td>
                      <td>{r.name}</td>
                      <td className="mono-small">{dims || "—"}</td>
                      <td>{parseTotalColumn(r.totalFormula) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="pager">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ←
            </button>
            <span>
              {offset + 1}–{Math.min(offset + limit, total)} из {total}
            </span>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              →
            </button>
          </div>
        </div>

        <div className="checks-detail-panel">
          <h3>{selected ? `Правило ${selected.kod}` : "Новое правило"}</h3>
          {detailLoading && <p className="tools-hint">Загрузка деталей…</p>}

          <div className="toolbar-actions" style={{ marginBottom: "0.75rem", gap: "0.35rem" }}>
            <button
              type="button"
              className={`btn ${tab === "rule" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab("rule")}
            >
              1. Правило
            </button>
            <button
              type="button"
              className={`btn ${tab === "addsum" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab("addsum")}
              disabled={!selected}
            >
              2. Доп. графы
            </button>
            <button
              type="button"
              className={`btn ${tab === "placements" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab("placements")}
              disabled={!selected}
            >
              3. Привязки к форме
            </button>
          </div>

          {tab === "rule" && (
            <>
              {modeHint && (
                <p className="tools-hint">
                  Специальный режим (код {draft.kod}): <strong>{modeHint}</strong>
                </p>
              )}
              <div className="checks-form-grid">
                <label>
                  Код расшифровки
                  <input
                    type="number"
                    value={draft.kod || ""}
                    disabled={!!selected}
                    title="kod"
                    onChange={(e) => setDraft({ ...draft, kod: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Тип / привязка к форме
                  <input
                    value={draft.name}
                    title="rName"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="например N11_3_5"
                  />
                </label>
                <label className="full-width">
                  Примечание
                  <input
                    value={draft.note ?? ""}
                    title="rNote"
                    onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
                  />
                </label>
                <label className="full-width">
                  Формы или строки применения
                  <input
                    value={draft.refRows ?? ""}
                    title="ref_rows"
                    onChange={(e) => setDraft({ ...draft, refRows: e.target.value || null })}
                    placeholder="N06_11_1, N06_11_2 или номера строк"
                  />
                </label>
                <label className="full-width">
                  Формула итога
                  <input
                    value={draft.totalFormula ?? ""}
                    title="rItogo"
                    onChange={(e) =>
                      setDraft({ ...draft, totalFormula: e.target.value || null })
                    }
                    placeholder="L=B+C+D+E−F−G−H−I−J+K"
                  />
                </label>

                <span className="form-section-label">Измерение 1 — контрагент / фильтр справочника</span>
                <label className="full-width">
                  Справочник и фильтр
                  <input
                    value={draft.refA1Name ?? ""}
                    title="ref_a1_name"
                    onChange={(e) => setDraft({ ...draft, refA1Name: e.target.value || null })}
                    placeholder="Контрагент/1,2"
                  />
                </label>
                <label className="full-width">
                  Заголовок в окне расшифровки
                  <input
                    value={draft.refA1Title ?? ""}
                    title="ref_a1_title"
                    placeholder="например Контрагент"
                    onChange={(e) => setDraft({ ...draft, refA1Title: e.target.value || null })}
                  />
                </label>

                <span className="form-section-label">Измерение 2</span>
                <label className="full-width">
                  Справочник и фильтр
                  <input
                    value={draft.refA2Name ?? ""}
                    title="ref_a2_name"
                    onChange={(e) => setDraft({ ...draft, refA2Name: e.target.value || null })}
                    placeholder="Страна/RU,AM,…"
                  />
                </label>
                <label className="full-width">
                  Заголовок в окне расшифровки
                  <input
                    value={draft.refA2Title ?? ""}
                    title="ref_a2_title"
                    placeholder="например Страна фактической поставки"
                    onChange={(e) => setDraft({ ...draft, refA2Title: e.target.value || null })}
                  />
                </label>

                <span className="form-section-label">Измерение 3</span>
                <label className="full-width">
                  Справочник и фильтр
                  <input
                    value={draft.refA3Name ?? ""}
                    title="ref_a3_name"
                    placeholder="Валюта"
                    onChange={(e) => setDraft({ ...draft, refA3Name: e.target.value || null })}
                  />
                </label>
                <label className="full-width">
                  Заголовок в окне расшифровки
                  <input
                    value={draft.refA3Title ?? ""}
                    title="ref_a3_title"
                    placeholder="например Валюта контракта"
                    onChange={(e) => setDraft({ ...draft, refA3Title: e.target.value || null })}
                  />
                </label>

                <span className="form-section-label">Измерение 4</span>
                <label className="full-width">
                  Справочник и фильтр
                  <input
                    value={draft.refA4Name ?? ""}
                    title="ref_a4_name"
                    placeholder="Вид прочей выручки/116,104,…"
                    onChange={(e) => setDraft({ ...draft, refA4Name: e.target.value || null })}
                  />
                </label>
                <label className="full-width">
                  Заголовок в окне расшифровки
                  <input
                    value={draft.refA4Title ?? ""}
                    title="ref_a4_title"
                    placeholder="например Вид прочей выручки"
                    onChange={(e) => setDraft({ ...draft, refA4Title: e.target.value || null })}
                  />
                </label>
              </div>
              {backend && adminOk && (
                <div className="toolbar-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void handleSaveRule()}>
                    Сохранить правило
                  </button>
                  {selected && (
                    <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                      Удалить
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "addsum" && selected && (
            <>
              <p className="tools-hint">
                Дополнительные графы окна расшифровки для кода {selected.kod} (в Access — таблица
                таблица доп. граф).
              </p>
              <table className="checks-table">
                <thead>
                  <tr>
                    <th>Порядок</th>
                    <th>Заголовок графы</th>
                    <th>Тип поля</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {addsumDraft.map((row, idx) => (
                    <tr key={row.id ?? idx}>
                      <td>
                        <input
                          type="number"
                          value={row.sort}
                          style={{ width: "4rem" }}
                          onChange={(e) => {
                            const next = [...addsumDraft];
                            next[idx] = { ...row, sort: Number(e.target.value) };
                            setAddsumDraft(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={row.sumTitle}
                          onChange={(e) => {
                            const next = [...addsumDraft];
                            next[idx] = { ...row, sumTitle: e.target.value };
                            setAddsumDraft(next);
                          }}
                        />
                      </td>
                      <td>
                        <select
                          value={row.fldType}
                          onChange={(e) => {
                            const next = [...addsumDraft];
                            next[idx] = { ...row, fldType: e.target.value };
                            setAddsumDraft(next);
                          }}
                        >
                          {FLD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setAddsumDraft(addsumDraft.filter((_, i) => i !== idx))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {backend && adminOk && (
                <div className="toolbar-actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      setAddsumDraft([
                        ...addsumDraft,
                        {
                          kod: selected.kod,
                          sort: addsumDraft.length,
                          sumTitle: "",
                          fldType: "Сумма",
                        },
                      ])
                    }
                  >
                    Добавить графу
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSaveAddsum()}
                  >
                    Сохранить доп. графы
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "placements" && selected && (
            <>
              <p className="tools-hint">
                Где на шаблоне формы открывается эта расшифровка. Пустая графа — на всю строку;
                иначе буква графы (B, C, …), как в Access.
              </p>
              <table className="checks-table">
                <thead>
                  <tr>
                    <th>Форма</th>
                    <th>Номер строки</th>
                    <th>Графа</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {placementsDraft.map((row, idx) => (
                    <tr key={`${row.formId}-${row.rowNo}-${row.columnKey}-${idx}`}>
                      <td>
                        <input
                          value={row.formId}
                          placeholder="N01_1"
                          onChange={(e) => {
                            const next = [...placementsDraft];
                            next[idx] = { ...row, formId: e.target.value };
                            setPlacementsDraft(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={row.rowNo}
                          placeholder="1105"
                          style={{ width: "6rem" }}
                          onChange={(e) => {
                            const next = [...placementsDraft];
                            next[idx] = { ...row, rowNo: e.target.value };
                            setPlacementsDraft(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={row.columnKey}
                          placeholder="C или пусто"
                          style={{ width: "5rem" }}
                          onChange={(e) => {
                            const next = [...placementsDraft];
                            next[idx] = { ...row, columnKey: e.target.value.toUpperCase() };
                            setPlacementsDraft(next);
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            setPlacementsDraft(placementsDraft.filter((_, i) => i !== idx))
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {placementsDraft.length === 0 && (
                <p className="tools-hint">Нет привязок. Импортируйте карту или добавьте строку.</p>
              )}
              {backend && adminOk && (
                <div className="toolbar-actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      setPlacementsDraft([
                        ...placementsDraft,
                        { formId: "", rowNo: "", columnKey: "" },
                      ])
                    }
                  >
                    Добавить привязку
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSavePlacements()}
                  >
                    Сохранить привязки
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
