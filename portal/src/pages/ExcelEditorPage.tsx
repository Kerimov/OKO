import { useCallback, useEffect, useState } from "react";
import {
  deleteExcelMapping,
  fetchExcelPage,
  fetchExcelStats,
  reimportExcelFromJson,
  saveExcelMapping,
  type ExcelMapping,
} from "../api";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";

const EMPTY_MAPPING: ExcelMapping = {
  formName: "",
  sheetName: null,
  excelRow: null,
  excelColumn: null,
  formColumn: null,
  formRow: null,
  period: false,
  addText: null,
};

export function ExcelEditorPage() {
  const backend = isBackendMode();
  const [stats, setStats] = useState<{ total: number; formsCount: number } | null>(null);
  const [items, setItems] = useState<ExcelMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [selected, setSelected] = useState<ExcelMapping | null>(null);
  const [draft, setDraft] = useState<ExcelMapping>(EMPTY_MAPPING);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 40;

  const loadPage = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const [page, st] = await Promise.all([
        fetchExcelPage({
          q: search || undefined,
          formName: formFilter || undefined,
          limit,
          offset,
        }),
        fetchExcelStats(),
      ]);
      setItems(page.items);
      setTotal(page.total);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, offset]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const selectItem = (item: ExcelMapping) => {
    setSelected(item);
    setDraft({ ...item });
  };

  const handleSave = async () => {
    if (!draft.formName.trim()) {
      setError("Укажите formName");
      return;
    }
    try {
      const saved = await saveExcelMapping(draft);
      setStatus(selected ? `Запись #${saved.id} сохранена` : "Запись создана");
      setSelected(saved);
      setDraft({ ...saved });
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDelete = async () => {
    if (!selected?.id) return;
    if (!confirm(`Удалить маппинг #${selected.id}?`)) return;
    try {
      await deleteExcelMapping(selected.id);
      setSelected(null);
      setDraft(EMPTY_MAPPING);
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (!confirm("Перезаписать все маппинги из excel-export.json?")) return;
    try {
      const r = await reimportExcelFromJson();
      setStatus(`Импортировано ${r.reimported} записей`);
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const access = useAdminAccess();
  if (!access.ok) {
    return <AdminAccessGate title="Excel-маппинг" />;
  }

  return (
    <div className="admin-page checks-editor excel-editor">
      <header className="admin-header">
        <div>
          <h1>Excel-маппинг</h1>
          <p className="admin-desc">
            Аналог <code>tblExcelExport</code> в z261.mdb — соответствие ячеек форм и листов Excel.
          </p>
        </div>
        {stats && (
          <div className="admin-stats">
            <span>Всего: {stats.total}</span>
            <span>Форм: {stats.formsCount}</span>
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
              placeholder="Поиск…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              className="search-input"
            />
            <input
              placeholder="formName"
              value={formFilter}
              onChange={(e) => {
                setFormFilter(e.target.value);
                setOffset(0);
              }}
              className="category-select"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimport}>
              Импорт из JSON
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setSelected(null);
                setDraft({ ...EMPTY_MAPPING });
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
                    <th>#</th>
                    <th>Форма</th>
                    <th>Лист</th>
                    <th>Excel</th>
                    <th>Форма</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      className={selected?.id === r.id ? "selected" : ""}
                      onClick={() => selectItem(r)}
                    >
                      <td>{r.id}</td>
                      <td>{r.formName}</td>
                      <td className="expr-cell">{r.sheetName ?? "—"}</td>
                      <td>
                        {r.excelRow ?? "?"},{r.excelColumn ?? "?"}
                      </td>
                      <td>
                        {r.formColumn ?? "—"}
                        {r.formRow != null ? ` R${r.formRow}` : ""}
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
          <h2>{selected ? `Запись #${selected.id}` : "Новая запись"}</h2>
          <div className="checks-form-grid">
            <p className="form-section-label">Форма</p>
            <label>
              Код формы (formName)
              <input
                value={draft.formName}
                onChange={(e) => setDraft({ ...draft, formName: e.target.value })}
                placeholder="N01_1"
              />
            </label>
            <label>
              Лист Excel (sheetName)
              <input
                value={draft.sheetName ?? ""}
                onChange={(e) => setDraft({ ...draft, sheetName: e.target.value || null })}
              />
            </label>
            <p className="form-section-label">Ячейка Excel</p>
            <label>
              Строка (excelRow)
              <input
                type="number"
                value={draft.excelRow ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    excelRow: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              Колонка (excelColumn)
              <input
                value={draft.excelColumn ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({
                    ...draft,
                    excelColumn: v === "" ? null : /^\d+$/.test(v) ? Number(v) : v,
                  });
                }}
              />
            </label>
            <p className="form-section-label">Поле формы</p>
            <label>
              Колонка (formColumn)
              <input
                value={draft.formColumn ?? ""}
                onChange={(e) => setDraft({ ...draft, formColumn: e.target.value || null })}
              />
            </label>
            <label>
              Строка (formRow)
              <input
                type="number"
                value={draft.formRow ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    formRow: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              Доп. текст (addText)
              <input
                value={draft.addText ?? ""}
                onChange={(e) => setDraft({ ...draft, addText: e.target.value || null })}
              />
            </label>
            <div className="checks-flags">
            <label className="check-flag">
              <input
                type="checkbox"
                checked={!!draft.period}
                onChange={(e) => setDraft({ ...draft, period: e.target.checked })}
              />
              Привязка к периоду (period)
            </label>
            </div>
          </div>
          <div className="checks-actions">
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              Сохранить
            </button>
            {selected?.id && (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Удалить
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
