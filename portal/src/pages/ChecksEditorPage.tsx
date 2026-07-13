import { useCallback, useEffect, useState } from "react";
import {
  createCheckRule,
  deleteCheckRule,
  fetchChecksPage,
  fetchChecksStats,
  reimportChecksFromJson,
  saveCheckRule,
} from "../api";
import type { CheckRule } from "../engine/checkEngine";
import {
  combineCheckExpression,
  evaluateCheckExpression,
  CheckParseError,
} from "../engine/cellExpression";
import {
  evalContextFromInstances,
  latestInstancePerTemplate,
  loadInstancesForCheck,
} from "../engine/instanceIndex";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";

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

export function ChecksEditorPage() {
  const backend = isBackendMode();
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    periodActive: number;
    aggrOnly: number;
  } | null>(null);
  const [items, setItems] = useState<CheckRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [onlyPeriod, setOnlyPeriod] = useState(false);
  const [selected, setSelected] = useState<CheckRule | null>(null);
  const [draft, setDraft] = useState<CheckRule>(EMPTY_RULE);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const limit = 40;

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

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const selectRule = (rule: CheckRule) => {
    setSelected(rule);
    setDraft({ ...rule });
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
    if (!confirm("Перезаписать все увязки из checks.json? Текущие изменения в БД будут потеряны.")) {
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
        setTestResult(`OK — условие выполнено (лево=${result.left}, право=${result.right})`);
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
            Правила межформенных проверок (аналог таблицы увязок исходного комплекта). Изменения
            сохраняются в базе портала.
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

      <div className="checks-layout">
        <section className="checks-list-panel">
          <div className="checks-filters">
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
            <input
              placeholder="Форма, напр. N01_1"
              value={formFilter}
              onChange={(e) => {
                setFormFilter(e.target.value);
                setOffset(0);
              }}
              className="category-select"
            />
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimport}>
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
              + Новая
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
                    <th>Выражение</th>
                    <th>П</th>
                    <th>А</th>
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
                      <td className="expr-cell" title={r.expression}>
                        {r.expression.slice(0, 80)}
                        {(r.expression?.length ?? 0) > 80 ? "…" : ""}
                      </td>
                      <td>{r.periodActive ? "✓" : ""}</td>
                      <td>{r.active ? "✓" : ""}</td>
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

        <section className="checks-edit-panel">
          <h2>{selected ? `Увязка №${selected.number}` : "Новая увязка"}</h2>
          <div className="checks-form">
            <label>
              Номер
              <input
                type="number"
                value={draft.number || ""}
                disabled={!!selected}
                onChange={(e) => setDraft({ ...draft, number: Number(e.target.value) })}
              />
            </label>
            <label className="full-width">
              Основное выражение
              <textarea
                rows={4}
                value={draft.expression}
                onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
                placeholder='Cell("N01_1","B",1371)>=0'
              />
            </label>
            <label className="full-width">
              Дополнительное выражение
              <textarea
                rows={2}
                value={draft.expressionAlt ?? ""}
                onChange={(e) => setDraft({ ...draft, expressionAlt: e.target.value || null })}
              />
            </label>
            <label className="full-width">
              Сообщение об ошибке
              <input
                value={draft.message ?? ""}
                onChange={(e) => setDraft({ ...draft, message: e.target.value || null })}
              />
            </label>
            <div className="checks-flags">
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.periodActive}
                  onChange={(e) => setDraft({ ...draft, periodActive: e.target.checked })}
                />
                Учитывать в проверке за период
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Активно
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.forAggrOnly}
                  onChange={(e) => setDraft({ ...draft, forAggrOnly: e.target.checked })}
                />
                Только для агрегации
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.firstLevel}
                  onChange={(e) => setDraft({ ...draft, firstLevel: e.target.checked })}
                />
                Первый уровень
              </label>
            </div>
            <div className="checks-actions">
              <button type="button" className="btn btn-secondary" onClick={handleTest}>
                Проверить на данных
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave}>
                Сохранить
              </button>
              {selected && (
                <button type="button" className="btn btn-danger-outline" onClick={handleDelete}>
                  Удалить
                </button>
              )}
            </div>
            {testResult && <p className="test-result">{testResult}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
