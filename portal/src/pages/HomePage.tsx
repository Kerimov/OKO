import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadCatalog, loadSchema } from "../api";
import type { FormCatalog } from "../types";
import { countInstances, createInstance } from "../storage";
import { categoryLabel } from "../utils";

export function HomePage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [myCount, setMyCount] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((e) => setError(e.message));
    setMyCount(countInstances());
  }, []);

  const handleCreate = async (templateId: string) => {
    setCreating(templateId);
    setError("");
    try {
      const schema = await loadSchema(templateId);
      const instance = createInstance(schema);
      setMyCount(countInstances());
      navigate(`/my/${instance.instanceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать форму");
      setCreating(null);
    }
  };

  const categories = useMemo(() => {
    if (!catalog) return [];
    const cats = new Set(catalog.forms.map((f) => f.category));
    return Array.from(cats).sort();
  }, [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.toLowerCase().trim();
    return catalog.forms.filter((f) => {
      if (category !== "all" && f.category !== category) return false;
      if (!q) return true;
      return (
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q)
      );
    });
  }, [catalog, search, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const f of filtered) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return map;
  }, [filtered]);

  if (error && !catalog) {
    return <div className="error-box">{error}</div>;
  }

  if (!catalog) {
    return <div className="loading">Загрузка каталога форм…</div>;
  }

  return (
    <div className="home">
      <section className="hero">
        <h1>Каталог шаблонов форм</h1>
        <p>
          Выберите шаблон и нажмите «Создать» — форма сохранится отдельно в разделе{" "}
          <Link to="/my">Мои формы ОКО</Link>.
        </p>
        <div className="stats">
          <span className="stat">{catalog.forms.length} шаблонов</span>
          <Link to="/my" className="stat stat-link">
            {myCount} в «Мои формы ОКО»
          </Link>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <div className="filters">
        <input
          type="search"
          placeholder="Поиск по коду или названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="category-select"
        >
          <option value="all">Все разделы</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(catalog.categories, c)} ({c})
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">Формы не найдены</p>
      ) : (
        Array.from(grouped.entries()).map(([cat, forms]) => (
          <section key={cat} className="form-section">
            <h2>
              <span className="cat-code">{cat}</span>
              {categoryLabel(catalog.categories, cat)}
              <span className="cat-count">{forms.length}</span>
            </h2>
            <div className="form-grid">
              {forms.map((f) => (
                <div key={f.id} className="form-card form-card-template">
                  <span className="form-card-id">{f.id}</span>
                  <span className="form-card-title">{f.title}</span>
                  <span className="form-card-meta">{f.pages} стр. · шаблон</span>
                  <div className="form-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={creating === f.id}
                      onClick={() => handleCreate(f.id)}
                    >
                      {creating === f.id ? "Создание…" : "Создать"}
                    </button>
                    {f.pdfFile && (
                      <a
                        href={`/pdf/${f.pdfFile}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-outline btn-sm"
                      >
                        PDF
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
