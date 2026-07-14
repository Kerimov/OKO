import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  archiveForm,
  createForm,
  fetchFormDependencies,
  loadCatalog,
  loadSchema,
  previewFormsImport,
  reimportFormsFromJson,
  saveFormSchema,
} from "../api";
import { FormTable } from "../components/FormTable";
import type { FormCatalog, FormColumn, FormRowTemplate, FormSchema } from "../types";
import { buildInitialRows } from "../utils";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";
import {
  defaultColumn,
  isSystemColumn,
  moveItem,
  parseExcelPaste,
  schemaFingerprint,
  suggestNextColumnKey,
  validateFormSchema,
} from "./formsEditor/validateDraft";

type Tab = "meta" | "columns" | "rows" | "deps" | "preview";

export function FormsEditorPage() {
  const backend = isBackendMode();
  const access = useAdminAccess();
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [formId, setFormId] = useState("");
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [savedFp, setSavedFp] = useState("");
  const [tab, setTab] = useState<Tab>("meta");
  const [search, setSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deps, setDeps] = useState<Awaited<ReturnType<typeof fetchFormDependencies>> | null>(
    null
  );
  const [importPreview, setImportPreview] = useState<{
    added: string[];
    removed: string[];
    changed: string[];
    unchanged: number;
    jsonTotal: number;
    dbTotal: number;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createId, setCreateId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createClone, setCreateClone] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const dirty = useMemo(() => {
    if (!schema || !savedFp) return false;
    return schemaFingerprint(schema) !== savedFp;
  }, [schema, savedFp]);

  const validation = useMemo(
    () => (schema ? validateFormSchema(schema) : []),
    [schema]
  );
  const hasErrors = validation.some((v) => v.level === "error");

  const previewRows = useMemo(
    () => (schema ? buildInitialRows(schema) : []),
    [schema]
  );

  const loadCatalogList = useCallback(async () => {
    try {
      const c = await loadCatalog();
      setCatalog(c);
      if (!formId && c.forms.length) {
        const first = c.forms.find((f) => !f.archived) ?? c.forms[0];
        setFormId(first.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка каталога");
    }
  }, [formId]);

  const loadForm = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    setSelectedRows(new Set());
    try {
      const s = await loadSchema(id);
      setSchema(s);
      setSavedFp(schemaFingerprint(s));
      if (backend) {
        try {
          setDeps(await fetchFormDependencies(id));
        } catch {
          setDeps(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки формы");
      setSchema(null);
      setDeps(null);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    void loadCatalogList();
  }, [loadCatalogList]);

  useEffect(() => {
    if (formId) void loadForm(formId);
  }, [formId, loadForm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, backend, hasErrors]);

  const filteredForms = useMemo(() => {
    if (!catalog) return [];
    const q = search.toLowerCase().trim();
    return catalog.forms.filter((f) => {
      if (!showArchived && f.archived) return false;
      if (!q) return true;
      return f.id.toLowerCase().includes(q) || f.title.toLowerCase().includes(q);
    });
  }, [catalog, search, showArchived]);

  const selectForm = (id: string) => {
    if (id === formId) return;
    if (dirty && !confirm("Есть несохранённые изменения. Перейти без сохранения?")) return;
    setFormId(id);
  };

  const handleSave = async () => {
    if (!schema || !backend) return;
    if (hasErrors) {
      setError("Исправьте ошибки валидации перед сохранением");
      setTab("meta");
      return;
    }
    try {
      const saved = await saveFormSchema(schema);
      setSchema(saved);
      setSavedFp(schemaFingerprint(saved));
      setStatus(`Форма ${saved.id} сохранена (версия ${saved.schemaVersion ?? "—"})`);
      await loadCatalogList();
      setDeps(await fetchFormDependencies(saved.id).catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDiscard = () => {
    if (!formId) return;
    if (dirty && !confirm("Отменить все несохранённые изменения?")) return;
    void loadForm(formId);
  };

  const handleImportPreview = async () => {
    try {
      setImportPreview(await previewFormsImport());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка предпросмотра");
    }
  };

  const handleConfirmImport = async () => {
    if (!confirm("Перезаписать шаблоны из JSON? Изменения в БД будут потеряны.")) return;
    try {
      const r = await reimportFormsFromJson();
      setStatus(`Импортировано ${r.reimported} форм`);
      setImportPreview(null);
      await loadCatalogList();
      if (formId) await loadForm(formId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const handleCreate = async () => {
    if (!createId.trim()) return;
    try {
      const created = await createForm({
        id: createId.trim(),
        title: createTitle.trim() || createId.trim(),
        cloneFrom: createClone && formId ? formId : undefined,
        category: schema?.category,
      });
      setCreateOpen(false);
      setCreateId("");
      setCreateTitle("");
      setCreateClone(false);
      await loadCatalogList();
      setFormId(created.id);
      setStatus(`Создана форма ${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    }
  };

  const handleArchive = async () => {
    if (!schema) return;
    const next = !schema.archived;
    if (next && !confirm(`Архивировать форму ${schema.id}?`)) return;
    try {
      const saved = await archiveForm(schema.id, next);
      setSchema(saved);
      setSavedFp(schemaFingerprint(saved));
      setStatus(next ? "Форма в архиве" : "Форма восстановлена");
      await loadCatalogList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка архивации");
    }
  };

  const updateColumn = (idx: number, patch: Partial<FormColumn>) => {
    if (!schema) return;
    const columns = schema.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setSchema({ ...schema, columns });
  };

  const renameColumnKey = async (idx: number, nextKey: string) => {
    if (!schema) return;
    const prev = schema.columns[idx];
    if (!prev || prev.key === nextKey) {
      updateColumn(idx, { key: nextKey });
      return;
    }
    if (isSystemColumn(prev.key)) {
      setError("Системные графы num/name переименовывать нельзя");
      return;
    }
    if (backend) {
      try {
        const d = await fetchFormDependencies(schema.id, { columnKey: prev.key });
        const related = Object.values(d.totals).reduce((a, b) => a + b, 0);
        if (related > 0) {
          const ok = confirm(
            `Графа ${prev.key} упоминается в зависимостях:\n` +
              Object.entries(d.totals)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") +
              `\n\nПереименовать в ${nextKey}? Ссылки не обновятся автоматически.`
          );
          if (!ok) return;
        }
      } catch {
        /* ignore */
      }
    }
    updateColumn(idx, { key: nextKey });
  };

  const addColumn = () => {
    if (!schema) return;
    const key = suggestNextColumnKey(schema.columns.map((c) => c.key));
    setSchema({
      ...schema,
      columns: [...schema.columns, defaultColumn(key)],
    });
  };

  const removeColumn = async (idx: number) => {
    if (!schema) return;
    const col = schema.columns[idx];
    if (isSystemColumn(col.key)) {
      setError("Нельзя удалить системную графу num/name");
      return;
    }
    if (backend) {
      try {
        const d = await fetchFormDependencies(schema.id, { columnKey: col.key });
        const n = Object.values(d.totals).reduce((a, b) => a + b, 0);
        if (n > 0) {
          const ok = confirm(
            `Графа ${col.key} используется (${Object.entries(d.totals)
              .map(([k, v]) => `${k}:${v}`)
              .join(", ")}). Удалить?`
          );
          if (!ok) return;
        }
      } catch {
        /* ignore */
      }
    }
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
      rows: [...schema.rows, { name: "Новая строка", num: "", kind: "data" }],
    });
  };

  const removeRow = async (idx: number) => {
    if (!schema) return;
    const row = schema.rows[idx];
    if (backend && row.num) {
      try {
        const d = await fetchFormDependencies(schema.id, { rowNo: String(row.num) });
        const n = Object.values(d.totals).reduce((a, b) => a + b, 0);
        if (n > 0) {
          const ok = confirm(
            `Строка ${row.num} используется (${Object.entries(d.totals)
              .map(([k, v]) => `${k}:${v}`)
              .join(", ")}). Удалить?`
          );
          if (!ok) return;
        }
      } catch {
        /* ignore */
      }
    }
    setSchema({ ...schema, rows: schema.rows.filter((_, i) => i !== idx) });
    setSelectedRows(new Set());
  };

  const removeSelectedRows = () => {
    if (!schema || selectedRows.size === 0) return;
    if (!confirm(`Удалить выбранные строки (${selectedRows.size})?`)) return;
    setSchema({
      ...schema,
      rows: schema.rows.filter((_, i) => !selectedRows.has(i)),
    });
    setSelectedRows(new Set());
  };

  const duplicateSelectedRows = () => {
    if (!schema || selectedRows.size === 0) return;
    const extras = [...selectedRows]
      .sort((a, b) => a - b)
      .map((i) => ({ ...schema.rows[i], name: `${schema.rows[i].name} (копия)` }));
    setSchema({ ...schema, rows: [...schema.rows, ...extras] });
  };

  const applyPaste = () => {
    if (!schema) return;
    const rows = parseExcelPaste(pasteText);
    if (!rows.length) return;
    setSchema({ ...schema, rows: [...schema.rows, ...rows] });
    setPasteOpen(false);
    setPasteText("");
    setTab("rows");
  };

  const visibleRows = useMemo(() => {
    if (!schema) return [] as Array<{ row: FormRowTemplate; idx: number }>;
    const q = rowSearch.toLowerCase().trim();
    return schema.rows
      .map((row, idx) => ({ row, idx }))
      .filter(
        ({ row }) =>
          !q ||
          String(row.num ?? "").includes(q) ||
          (row.code ?? "").toLowerCase().includes(q) ||
          row.name.toLowerCase().includes(q)
      );
  }, [schema, rowSearch]);

  if (!access.ok) {
    return <AdminAccessGate title="Конструктор форм" />;
  }

  return (
    <div className="admin-page forms-editor">
      <header className="admin-header">
        <div>
          <h1>Конструктор форм</h1>
          <p className="admin-desc">
            Шаблоны строк и граф с валидацией, зависимостями и безопасным импортом.
          </p>
        </div>
        <div className="checks-actions">
          {backend && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>
                Новая / клон
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleImportPreview()}>
                Импорт…
              </button>
              {schema && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleArchive()}>
                  {schema.archived ? "Из архива" : "В архив"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!dirty}
                onClick={handleDiscard}
              >
                Отменить
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSave()}
                disabled={!schema || hasErrors}
                title="Ctrl/Cmd+S"
              >
                Сохранить
              </button>
            </>
          )}
        </div>
      </header>

      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}
      {dirty && <div className="status-bar warn-bar">Есть несохранённые изменения</div>}

      <div className="forms-editor-layout">
        <aside className="forms-sidebar">
          <input
            type="search"
            className="search-input"
            placeholder="Поиск формы…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="rash-check" style={{ marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Показать архив
          </label>
          <ul className="forms-sidebar-list">
            {filteredForms.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={formId === f.id ? "active" : ""}
                  onClick={() => selectForm(f.id)}
                >
                  <span className="form-card-id">
                    {f.id}
                    {f.archived ? " · арх." : ""}
                  </span>
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
                {(
                  [
                    ["meta", "Свойства"],
                    ["columns", `Графы (${schema.columns.length})`],
                    ["rows", `Строки (${schema.rows.length})`],
                    ["deps", "Зависимости"],
                    ["preview", "Просмотр"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {validation.length > 0 && (
                <ul className="rash-validation">
                  {validation.map((v, i) => (
                    <li key={i} className={v.level === "error" ? "err" : "warn"}>
                      {v.level === "error" ? "Ошибка" : "Внимание"}: {v.message}
                    </li>
                  ))}
                </ul>
              )}

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
                      <input
                        value={schema.category}
                        list="form-categories"
                        onChange={(e) => setSchema({ ...schema, category: e.target.value })}
                      />
                      <datalist id="form-categories">
                        {catalog &&
                          Object.entries(catalog.categories).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                      </datalist>
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
                    <label>
                      Единица измерения
                      <input
                        value={schema.meta.unit}
                        onChange={(e) =>
                          setSchema({
                            ...schema,
                            meta: { ...schema.meta, unit: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      PDF образец (имя файла)
                      <input
                        value={schema.pdfFile ?? ""}
                        onChange={(e) =>
                          setSchema({ ...schema, pdfFile: e.target.value || undefined })
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
                    <label className="check-flag">
                      <input
                        type="checkbox"
                        checked={!!schema.kontrForm}
                        onChange={(e) => setSchema({ ...schema, kontrForm: e.target.checked })}
                      />
                      Форма с расшифровками контрагентов (kontrForm)
                    </label>
                    <div className="full-width">
                      <span className="form-section-label">Подписи</span>
                      {schema.signatures.map((sig, i) => (
                        <div key={i} className="rash-formula-term" style={{ marginBottom: "0.35rem" }}>
                          <input
                            value={sig}
                            onChange={(e) => {
                              const signatures = [...schema.signatures];
                              signatures[i] = e.target.value;
                              setSchema({ ...schema, signatures });
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() =>
                              setSchema({
                                ...schema,
                                signatures: schema.signatures.filter((_, j) => j !== i),
                              })
                            }
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setSchema({
                            ...schema,
                            signatures: [...schema.signatures, "Новая подпись"],
                          })
                        }
                      >
                        + Подпись
                      </button>
                    </div>
                    <p className="period-hint">
                      Версия схемы: <strong>{schema.schemaVersion ?? 1}</strong>
                      {schema.pdfFile && (
                        <>
                          {" · "}
                          <a href={`/pdf/${schema.pdfFile}`} target="_blank" rel="noreferrer">
                            Образец PDF
                          </a>
                        </>
                      )}
                      {" · "}
                      <Link to={`/admin/rash`}>Конструктор расшифровок</Link>
                    </p>
                  </div>
                </section>
              )}

              {tab === "columns" && (
                <section>
                  <div className="editor-toolbar">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addColumn}>
                      + Графа
                    </button>
                    <span className="muted">Ключ новой: свободная буква (B…Z)</span>
                  </div>
                  <div className="table-wrap editor-table-wrap">
                    <table className="checks-table">
                      <thead>
                        <tr>
                          <th />
                          <th>Ключ</th>
                          <th>Заголовок</th>
                          <th>Тип</th>
                          <th>Шир.</th>
                          <th>Выравн.</th>
                          <th>Зн.</th>
                          <th>Закр.</th>
                          <th>Чт.</th>
                          <th>Итог</th>
                          <th>Скр.</th>
                          <th>Формула / подсказка</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {schema.columns.map((col, i) => (
                          <tr key={`${col.key}-${i}`}>
                            <td className="row-actions">
                              <button type="button" className="btn-icon" onClick={() => setSchema({ ...schema, columns: moveItem(schema.columns, i, i - 1) })}>↑</button>
                              <button type="button" className="btn-icon" onClick={() => setSchema({ ...schema, columns: moveItem(schema.columns, i, i + 1) })}>↓</button>
                            </td>
                            <td>
                              <input
                                value={col.key}
                                disabled={isSystemColumn(col.key)}
                                onChange={(e) => void renameColumnKey(i, e.target.value)}
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
                                  updateColumn(i, { type: e.target.value as "text" | "number" })
                                }
                              >
                                <option value="number">Число</option>
                                <option value="text">Текст</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                value={col.width ?? 100}
                                onChange={(e) => updateColumn(i, { width: Number(e.target.value) })}
                                style={{ width: 64 }}
                              />
                            </td>
                            <td>
                              <select
                                value={col.align ?? ""}
                                onChange={(e) =>
                                  updateColumn(i, {
                                    align: (e.target.value || null) as FormColumn["align"],
                                  })
                                }
                              >
                                <option value="">авт.</option>
                                <option value="left">лево</option>
                                <option value="center">центр</option>
                                <option value="right">право</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                value={col.decimals ?? ""}
                                placeholder="—"
                                style={{ width: 48 }}
                                onChange={(e) =>
                                  updateColumn(i, {
                                    decimals: e.target.value === "" ? null : Number(e.target.value),
                                  })
                                }
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
                                title="Итоговая графа (FTotal): обычно readonly"
                                onChange={(e) =>
                                  updateColumn(i, {
                                    fTotal: e.target.checked,
                                    readonly: e.target.checked ? true : col.readonly,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!col.hidden}
                                onChange={(e) => updateColumn(i, { hidden: e.target.checked })}
                              />
                            </td>
                            <td>
                              <input
                                value={col.formula ?? ""}
                                placeholder="формула"
                                onChange={(e) => updateColumn(i, { formula: e.target.value || null })}
                              />
                              <input
                                value={col.helpText ?? ""}
                                placeholder="подсказка"
                                onChange={(e) =>
                                  updateColumn(i, { helpText: e.target.value || null })
                                }
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn-icon"
                                disabled={isSystemColumn(col.key)}
                                onClick={() => void removeColumn(i)}
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
                  <div className="editor-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
                      + Строка
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPasteOpen(true)}>
                      Вставка из Excel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={selectedRows.size === 0}
                      onClick={duplicateSelectedRows}
                    >
                      Дублировать
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={selectedRows.size === 0}
                      onClick={removeSelectedRows}
                    >
                      Удалить выбранные
                    </button>
                    <input
                      type="search"
                      placeholder="Фильтр строк…"
                      value={rowSearch}
                      onChange={(e) => setRowSearch(e.target.value)}
                    />
                    {schema.kontrForm && (
                      <Link className="btn btn-secondary btn-sm" to="/admin/rash">
                        Настроить расшифровку…
                      </Link>
                    )}
                  </div>
                  <div className="table-wrap editor-table-wrap">
                    <table className="checks-table">
                      <thead>
                        <tr>
                          <th />
                          <th />
                          <th>№</th>
                          <th>Код</th>
                          <th>Тип</th>
                          <th>Ур.</th>
                          <th>Наименование</th>
                          <th>Чт.</th>
                          <th>Формула</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map(({ row, idx }) => (
                          <tr key={idx}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedRows.has(idx)}
                                onChange={(e) => {
                                  const next = new Set(selectedRows);
                                  if (e.target.checked) next.add(idx);
                                  else next.delete(idx);
                                  setSelectedRows(next);
                                }}
                              />
                            </td>
                            <td className="row-actions">
                              <button type="button" className="btn-icon" onClick={() => setSchema({ ...schema, rows: moveItem(schema.rows, idx, idx - 1) })}>↑</button>
                              <button type="button" className="btn-icon" onClick={() => setSchema({ ...schema, rows: moveItem(schema.rows, idx, idx + 1) })}>↓</button>
                            </td>
                            <td>
                              <input
                                value={row.num ?? ""}
                                onChange={(e) => updateRow(idx, { num: e.target.value })}
                                style={{ width: 72 }}
                              />
                            </td>
                            <td>
                              <input
                                value={row.code ?? ""}
                                onChange={(e) => updateRow(idx, { code: e.target.value })}
                                className="mono-input"
                              />
                            </td>
                            <td>
                              <select
                                value={row.kind ?? "data"}
                                onChange={(e) =>
                                  updateRow(idx, {
                                    kind: e.target.value as FormRowTemplate["kind"],
                                  })
                                }
                              >
                                <option value="data">данные</option>
                                <option value="header">заголовок</option>
                                <option value="section">раздел</option>
                                <option value="total">итог</option>
                                <option value="hidden">скрытая</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                value={row.level ?? 0}
                                style={{ width: 48 }}
                                onChange={(e) => updateRow(idx, { level: Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <input
                                value={row.name}
                                onChange={(e) => updateRow(idx, { name: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!row.readonly}
                                onChange={(e) => updateRow(idx, { readonly: e.target.checked })}
                              />
                            </td>
                            <td>
                              <input
                                value={row.formula ?? ""}
                                onChange={(e) =>
                                  updateRow(idx, { formula: e.target.value || null })
                                }
                              />
                            </td>
                            <td>
                              <button type="button" className="btn-icon" onClick={() => void removeRow(idx)}>
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

              {tab === "deps" && (
                <section className="tools-section">
                  <h2>Зависимости {schema.id}</h2>
                  {!deps ? (
                    <p className="muted">Нет данных (нужен API).</p>
                  ) : (
                    <>
                      <p>
                        {Object.entries(deps.totals)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ") || "Связей не найдено"}
                      </p>
                      <table className="checks-table">
                        <thead>
                          <tr>
                            <th>Тип</th>
                            <th>Ссылка</th>
                            <th>Детали</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deps.hits.map((h, i) => (
                            <tr key={i}>
                              <td>{h.kind}</td>
                              <td>{h.ref}</td>
                              <td>{h.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="tools-hint">
                        Перед удалением/переименованием строки или графы система предупредит о
                        зависимостях. Ссылки в проверках и сальдо не правятся автоматически.
                      </p>
                    </>
                  )}
                </section>
              )}

              {tab === "preview" && (
                <section>
                  <p className="period-hint">
                    Живой предпросмотр текущего черновика (до сохранения).
                    <Link to="/catalog"> Открыть каталог</Link>
                    {schema.pdfFile && (
                      <>
                        {" · "}
                        <a href={`/pdf/${schema.pdfFile}`} target="_blank" rel="noreferrer">
                          PDF рядом
                        </a>
                      </>
                    )}
                  </p>
                  <FormTable
                    columns={schema.columns.filter((c) => !c.hidden)}
                    rows={previewRows}
                    onChange={() => undefined}
                    allowAddRows={schema.allowAddRows}
                    readOnly
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="rash-modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="rash-modal" onClick={(e) => e.stopPropagation()}>
            <header className="rash-modal-header">
              <h2>Новая форма</h2>
              <button type="button" className="btn-icon" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </header>
            <div className="checks-form">
              <label>
                Код формы
                <input value={createId} onChange={(e) => setCreateId(e.target.value)} placeholder="N99_1" />
              </label>
              <label>
                Название
                <input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} />
              </label>
              <label className="check-flag">
                <input
                  type="checkbox"
                  checked={createClone}
                  onChange={(e) => setCreateClone(e.target.checked)}
                />
                Клонировать текущую ({formId || "—"})
              </label>
            </div>
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
                Создать
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="rash-modal-backdrop" onClick={() => setImportPreview(null)}>
          <div className="rash-modal" onClick={(e) => e.stopPropagation()}>
            <header className="rash-modal-header">
              <h2>Предпросмотр импорта шаблонов</h2>
              <button type="button" className="btn-icon" onClick={() => setImportPreview(null)}>
                ×
              </button>
            </header>
            <p>
              JSON: {importPreview.jsonTotal} · БД: {importPreview.dbTotal} · без изменений:{" "}
              {importPreview.unchanged}
            </p>
            <p>
              <strong>Новые ({importPreview.added.length}):</strong>{" "}
              {importPreview.added.slice(0, 40).join(", ") || "—"}
            </p>
            <p>
              <strong>Изменённые ({importPreview.changed.length}):</strong>{" "}
              {importPreview.changed.slice(0, 40).join(", ") || "—"}
            </p>
            <p>
              <strong>Удаляемые ({importPreview.removed.length}):</strong>{" "}
              {importPreview.removed.slice(0, 40).join(", ") || "—"}
            </p>
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-danger" onClick={() => void handleConfirmImport()}>
                Применить импорт
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {pasteOpen && (
        <div className="rash-modal-backdrop" onClick={() => setPasteOpen(false)}>
          <div className="rash-modal" onClick={(e) => e.stopPropagation()}>
            <header className="rash-modal-header">
              <h2>Вставка строк из Excel</h2>
              <button type="button" className="btn-icon" onClick={() => setPasteOpen(false)}>
                ×
              </button>
            </header>
            <p className="tools-hint">Колонки через Tab: №, код, наименование (или № + наименование).</p>
            <textarea
              rows={10}
              style={{ width: "100%" }}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-primary" onClick={applyPaste}>
                Добавить строки
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setPasteOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
