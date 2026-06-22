import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  loadCatalog,
  loadSchema,
  reimportFormsFromJson,
  saveFormSchema,
} from "../api";
import { FormTable } from "../components/FormTable";
import type { FormCatalog, FormColumn, FormRowTemplate, FormSchema } from "../types";
import { buildInitialRows } from "../utils";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";

type Tab = "meta" | "columns" | "rows" | "preview";

export function FormsEditorPage() {
  const backend = isBackendMode();
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [formId, setFormId] = useState("");
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [tab, setTab] = useState<Tab>("meta");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, string | number>[]>([]);

  const loadCatalogList = useCallback(async () => {
    try {
      const c = await loadCatalog();
      setCatalog(c);
      if (!formId && c.forms.length) setFormId(c.forms[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка каталога");
    }
  }, [formId]);

  const loadForm = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const s = await loadSchema(id);
      setSchema(s);
      setPreviewRows(buildInitialRows(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки формы");
      setSchema(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogList();
  }, [loadCatalogList]);

  useEffect(() => {
    if (formId) loadForm(formId);
  }, [formId, loadForm]);

  const filteredForms = useMemo(() => {
    if (!catalog) return [];
    const q = search.toLowerCase().trim();
    return catalog.forms.filter(
      (f) =>
        !q ||
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q)
    );
  }, [catalog, search]);

  const handleSave = async () => {
    if (!schema || !backend) return;
    try {
      const saved = await saveFormSchema(schema);
      setSchema(saved);
      setPreviewRows(buildInitialRows(saved));
      setStatus(`Форма ${schema.id} сохранена в БД`);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleReimport = async () => {
    if (!confirm("Перезаписать все шаблоны форм из JSON? Изменения в БД будут потеряны.")) {
      return;
    }
    try {
      const r = await reimportFormsFromJson();
      setStatus(`Импортировано ${r.reimported} форм`);
      await loadCatalogList();
      if (formId) await loadForm(formId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const updateColumn = (idx: number, patch: Partial<FormColumn>) => {
    if (!schema) return;
    const columns = schema.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setSchema({ ...schema, columns });
  };

  const addColumn = () => {
    if (!schema) return;
    const key = `X${schema.columns.length}`;
    setSchema({
      ...schema,
      columns: [
        ...schema.columns,
        { key, label: `Графа ${key}`, type: "number", width: 100 },
      ],
    });
  };

  const removeColumn = (idx: number) => {
    if (!schema) return;
    setSchema({ ...schema, columns: schema.columns.filter((_, i) => i !== idx) });
  };

  const updateRow = (idx: number, patch: Partial<FormRowTemplate>) => {
    if (!schema) return;
    const rows = schema.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setSchema({ ...schema, rows });
  };

  const addRow = () => {
    if (!schema) return;
    setSchema({
      ...schema,
      rows: [...schema.rows, { name: "Новая строка", num: "" }],
    });
  };

  const removeRow = (idx: number) => {
    if (!schema) return;
    setSchema({ ...schema, rows: schema.rows.filter((_, i) => i !== idx) });
  };

  const moveRow = (idx: number, dir: -1 | 1) => {
    if (!schema) return;
    const next = idx + dir;
    if (next < 0 || next >= schema.rows.length) return;
    const rows = [...schema.rows];
    [rows[idx], rows[next]] = [rows[next], rows[idx]];
    setSchema({ ...schema, rows });
  };

  const access = useAdminAccess();
  if (!access.ok) {
    return <AdminAccessGate title="Конструктор форм" />;
  }

  return (
    <div className="admin-page forms-editor">
      <header className="admin-header">
        <div>
          <h1>Конструктор форм</h1>
          <p className="admin-desc">
            Аналог таблиц <code>a_stblROWs</code> и <code>a_stblFIELDs</code> в z261.mdb.
          </p>
        </div>
        <div className="checks-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReimport}>
            Импорт из JSON
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={!schema}
          >
            Сохранить в БД
          </button>
        </div>
      </header>

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="forms-editor-layout">
        <aside className="forms-sidebar">
          <input
            type="search"
            className="search-input"
            placeholder="Поиск формы…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="forms-sidebar-list">
            {filteredForms.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={formId === f.id ? "active" : ""}
                  onClick={() => setFormId(f.id)}
                >
                  <span className="form-card-id">{f.id}</span>
                  <span className="forms-sidebar-title">{f.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="forms-main">
          {loading || !schema ? (
            <p className="loading">Загрузка формы…</p>
          ) : (
            <>
              <div className="forms-tabs">
                {(["meta", "columns", "rows", "preview"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t === "meta" && "Свойства"}
                    {t === "columns" && `Графы (${schema.columns.length})`}
                    {t === "rows" && `Строки (${schema.rows.length})`}
                    {t === "preview" && "Превью"}
                  </button>
                ))}
              </div>

              {tab === "meta" && (
                <section className="checks-edit-panel">
                  <div className="checks-form">
                    <label>
                      Код формы
                      <input value={schema.id} readOnly />
                    </label>
                    <label>
                      Название
                      <input
                        value={schema.title}
                        onChange={(e) => setSchema({ ...schema, title: e.target.value })}
                      />
                    </label>
                    <label>
                      Раздел
                      <input value={schema.category} readOnly />
                    </label>
                    <label>
                      Страниц
                      <input
                        type="number"
                        min={1}
                        value={schema.pages}
                        onChange={(e) =>
                          setSchema({ ...schema, pages: Number(e.target.value) || 1 })
                        }
                      />
                    </label>
                    <label className="check-flag">
                      <input
                        type="checkbox"
                        checked={!!schema.allowAddRows}
                        onChange={(e) =>
                          setSchema({ ...schema, allowAddRows: e.target.checked })
                        }
                      />
                      Разрешить добавление строк (контрагенты)
                    </label>
                    <label>
                      Подписи (через запятую)
                      <input
                        value={schema.signatures.join(", ")}
                        onChange={(e) =>
                          setSchema({
                            ...schema,
                            signatures: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    {schema.pdfFile && (
                      <p className="period-hint">
                        <a href={`/pdf/${schema.pdfFile}`} target="_blank" rel="noreferrer">
                          Образец PDF
                        </a>
                      </p>
                    )}
                  </div>
                </section>
              )}

              {tab === "columns" && (
                <section>
                  <div className="editor-toolbar">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addColumn}>
                      + Графа
                    </button>
                  </div>
                  <div className="table-wrap editor-table-wrap">
                    <table className="checks-table">
                      <thead>
                        <tr>
                          <th>Ключ</th>
                          <th>Заголовок</th>
                          <th>Тип</th>
                          <th>Ширина</th>
                          <th>Закр.</th>
                          <th>Только чт.</th>
                          <th>FTotal</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {schema.columns.map((col, i) => (
                          <tr key={`${col.key}-${i}`}>
                            <td>
                              <input
                                value={col.key}
                                onChange={(e) => updateColumn(i, { key: e.target.value })}
                                className="mono-input"
                              />
                            </td>
                            <td>
                              <input
                                value={col.label}
                                onChange={(e) => updateColumn(i, { label: e.target.value })}
                              />
                            </td>
                            <td>
                              <select
                                value={col.type}
                                onChange={(e) =>
                                  updateColumn(i, {
                                    type: e.target.value as "text" | "number",
                                  })
                                }
                              >
                                <option value="number">number</option>
                                <option value="text">text</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                value={col.width ?? 100}
                                onChange={(e) =>
                                  updateColumn(i, { width: Number(e.target.value) })
                                }
                                style={{ width: 70 }}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!col.frozen}
                                onChange={(e) => updateColumn(i, { frozen: e.target.checked })}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!col.readonly}
                                onChange={(e) => updateColumn(i, { readonly: e.target.checked })}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!col.fTotal}
                                onChange={(e) =>
                                  updateColumn(i, {
                                    fTotal: e.target.checked,
                                    readonly: e.target.checked ? true : col.readonly,
                                  })
                                }
                                title="Итоговая графа (FTotal)"
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-icon"
                                onClick={() => removeColumn(i)}
                                title="Удалить"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === "rows" && (
                <section>
                  <div className="editor-toolbar">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
                      + Строка
                    </button>
                  </div>
                  <div className="table-wrap editor-table-wrap">
                    <table className="checks-table">
                      <thead>
                        <tr>
                          <th>№</th>
                          <th>Код</th>
                          <th>Наименование</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {schema.rows.map((row, i) => (
                          <tr key={i}>
                            <td>
                              <input
                                value={row.num ?? ""}
                                onChange={(e) => updateRow(i, { num: e.target.value })}
                                style={{ width: 80 }}
                              />
                            </td>
                            <td>
                              <input
                                value={row.code ?? ""}
                                onChange={(e) => updateRow(i, { code: e.target.value })}
                                className="mono-input"
                              />
                            </td>
                            <td>
                              <input
                                value={row.name}
                                onChange={(e) => updateRow(i, { name: e.target.value })}
                              />
                            </td>
                            <td className="row-actions">
                              <button type="button" className="btn-icon" onClick={() => moveRow(i, -1)}>
                                ↑
                              </button>
                              <button type="button" className="btn-icon" onClick={() => moveRow(i, 1)}>
                                ↓
                              </button>
                              <button type="button" className="btn-icon" onClick={() => removeRow(i)}>
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === "preview" && (
                <section>
                  <p className="period-hint">
                    Превью таблицы после сохранения будет использоваться при создании новых экземпляров.
                    <Link to="/"> Создать форму в каталоге</Link>
                  </p>
                  <FormTable
                    columns={schema.columns}
                    rows={previewRows}
                    onChange={setPreviewRows}
                    allowAddRows={schema.allowAddRows}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
