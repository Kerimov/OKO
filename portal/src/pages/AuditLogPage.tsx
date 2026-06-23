import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAuditPage, type AuditLogItem } from "../api";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function AuditLogPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const limit = 50;

  const loadPage = useCallback(async () => {
    if (!backend || !admin) return;
    setLoading(true);
    setError("");
    try {
      const page = await fetchAuditPage({ q: search || undefined, limit, offset });
      setItems(page.items);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, admin, search, offset]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Журнал аудита</h1>
        <div className="error-box">Требуется API-сервер.</div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="admin-page">
        <h1>Журнал аудита</h1>
        <div className="error-box">
          Доступ только для роли <strong>admin</strong>.{" "}
          {auth.loginAvailable ? (
            <>
              Войдите через <Link to="/login">/login</Link>.
            </>
          ) : (
            <>
              Укажите admin-токен в <Link to="/settings">настройках</Link>.
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page checks-editor">
      <header className="admin-header">
        <div>
          <h1>Журнал аудита</h1>
          <p className="admin-desc">
            Таблица <code>report_log</code> — изменения метаданных (увязки, формы, сальдо, Excel).
          </p>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="checks-filters">
        <input
          type="search"
          placeholder="Поиск по действию, деталям…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="search-input"
        />
      </div>

      {loading ? (
        <p className="loading">Загрузка…</p>
      ) : (
        <>
          <table className="checks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Время</th>
                <th>Действие</th>
                <th>Сущность</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.created_at}</td>
                  <td className="expr-cell" title={r.details ?? ""}>
                    {r.action}
                  </td>
                  <td>
                    {r.entity_type ?? "—"}
                    {r.entity_id ? ` / ${r.entity_id}` : ""}
                  </td>
                  <td>{r.actor ?? "—"}</td>
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

      {auth.authRequired && (
        <p className="admin-desc" style={{ marginTop: "1rem" }}>
          Записи появляются при сохранении метаданных под токеном admin.
        </p>
      )}
    </div>
  );
}
