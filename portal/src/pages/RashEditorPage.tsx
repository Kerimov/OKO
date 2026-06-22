import { useCallback, useEffect, useState } from "react";
import {
  createRashRule,
  deleteRashRule,
  fetchRashPage,
  fetchRashStats,
  fetchRashThresholds,
  reimportRashFromJson,
  saveRashRule,
  saveRashThresholds,
  type RashRule,
} from "../api";
import { KONTR_FORM_IDS } from "../constants";
import { parseTotalColumn } from "../engine/rashEngine";
import type { RashThresholds } from "../types";
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
};

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
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 40;

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
          filtered = filtered.filter((r) => (r.refRows ?? "").includes(formFilter));
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
    loadPage();
  }, [loadPage]);

  const selectRule = (rule: RashRule) => {
    setSelected(rule);
    setDraft({ ...rule });
  };

  const handleSave = async () => {
    if (!draft.kod || !draft.name.trim()) {
      setError("Укажите kod и название");
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

  const handleDelete = async () => {
    if (!selected || !backend) return;
    if (!confirm(`Удалить расшифровку kod=${selected.kod}?`)) return;
    try {
      await deleteRashRule(selected.kod);
      setSelected(null);
      setDraft(EMPTY_RULE);
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (!backend) return;
    if (!confirm("Перезагрузить sp_rash из rash-rules.json?")) return;
    try {
      const { reimported } = await reimportRashFromJson();
      setStatus(`Импортировано правил: ${reimported}`);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
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

  const adminOk = useAdminAccess().ok;

  return (
    <div className="admin-editor-page">
        <h1>Расшифровки (sp_rash)</h1>
        <p className="tools-intro">
          Справочник расшифровок контрагентов из <code>sp_rash</code> и доп. граф{" "}
          <code>sp_rash_addsum</code>. Применяется к формам N06/N09 при заполнении.
        </p>

        {!backend && (
          <div className="status-bar">
            Режим только чтения (JSON). Подключите API для редактирования.
          </div>
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
            <h2>Пороги расшифровки (тыс. руб.)</h2>
            <div className="tools-grid">
              <label>
                Уровень 1 ({thresholds.labels[0]})
                <input
                  type="number"
                  value={thresholds.level1}
                  onChange={(e) =>
                    setThresholds({ ...thresholds, level1: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Уровень 2 ({thresholds.labels[1]})
                <input
                  type="number"
                  value={thresholds.level2}
                  onChange={(e) =>
                    setThresholds({ ...thresholds, level2: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Уровень 3 ({thresholds.labels[2]})
                <input
                  type="number"
                  value={thresholds.level3}
                  onChange={(e) =>
                    setThresholds({ ...thresholds, level3: Number(e.target.value) })
                  }
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
            <button type="button" className="btn btn-secondary" onClick={() => void handleReimport()}>
              Импорт из JSON
            </button>
          )}
          {backend && adminOk && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSelected(null);
                setDraft({ ...EMPTY_RULE });
              }}
            >
              Новое правило
            </button>
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
                    <th>kod</th>
                    <th>Тип</th>
                    <th>Формы</th>
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr
                      key={r.kod}
                      className={selected?.kod === r.kod ? "selected" : ""}
                      onClick={() => selectRule(r)}
                    >
                      <td>{r.kod}</td>
                      <td>{r.name}</td>
                      <td className="mono-small">{(r.refRows ?? "").slice(0, 40)}</td>
                      <td>{parseTotalColumn(r.totalFormula) ?? "—"}</td>
                    </tr>
                  ))}
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
            <div className="checks-form-grid">
              <label>
                kod
                <input
                  type="number"
                  value={draft.kod || ""}
                  disabled={!!selected}
                  onChange={(e) => setDraft({ ...draft, kod: Number(e.target.value) })}
                />
              </label>
              <label>
                Тип (rName)
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="full-width">
                Примечание
                <input
                  value={draft.note ?? ""}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
                />
              </label>
              <label className="full-width">
                ref_rows (формы)
                <input
                  value={draft.refRows ?? ""}
                  onChange={(e) => setDraft({ ...draft, refRows: e.target.value || null })}
                  placeholder="N06_11_1,N06_11_2"
                />
              </label>
              <label className="full-width">
                Формула итога (rItogo)
                <input
                  value={draft.totalFormula ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, totalFormula: e.target.value || null })
                  }
                  placeholder="L=B+C+D+E-F-G-H-I-J+K"
                />
              </label>
              <label>
                Измерение 1 (имя)
                <input
                  value={draft.refA1Name ?? ""}
                  onChange={(e) => setDraft({ ...draft, refA1Name: e.target.value || null })}
                />
              </label>
              <label>
                Измерение 1 (заголовок)
                <input
                  value={draft.refA1Title ?? ""}
                  onChange={(e) => setDraft({ ...draft, refA1Title: e.target.value || null })}
                />
              </label>
            </div>
            {backend && adminOk && (
              <div className="toolbar-actions">
                <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
                  Сохранить
                </button>
                {selected && (
                  <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                    Удалить
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
