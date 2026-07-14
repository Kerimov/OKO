import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createAggEntry,
  deleteAggEntry,
  fetchAggStats,
  listAggEntries,
  reimportAggFromJson,
  updateAggEntry,
  type AggListEntry,
} from "../aggregationApi";
import { listOrganizations } from "../packagesApi";
import type { Organization } from "../types";
import { isBackendMode } from "../storage";
import { AdminAccessGate, useAdminAccess } from "../components/AdminAccessGate";

export function AggregationEditorPage() {
  const access = useAdminAccess();
  const backend = isBackendMode();
  const [stats, setStats] = useState<{ total: number; included: number; parents: number } | null>(
    null
  );
  const [entries, setEntries] = useState<AggListEntry[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [filterParent, setFilterParent] = useState<number | "">("");
  const [parentZid, setParentZid] = useState<number | "">("");
  const [childZid, setChildZid] = useState<number | "">("");
  const [included, setIncluded] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    try {
      const [st, orgList, list] = await Promise.all([
        fetchAggStats(),
        listOrganizations(),
        listAggEntries(filterParent === "" ? undefined : filterParent),
      ]);
      setStats(st);
      setOrgs(orgList);
      setEntries(list);
      if (parentZid === "" && orgList[0]) setParentZid(orgList[0].zid);
      if (childZid === "" && orgList[1]) setChildZid(orgList[1].zid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, filterParent, parentZid, childZid]);

  useEffect(() => {
    load();
  }, [load]);

  const parentOptions = useMemo(() => {
    const ids = new Set(entries.map((e) => e.parentZid));
    return orgs.filter((o) => ids.has(o.zid) || ids.size === 0);
  }, [entries, orgs]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (parentZid === "" || childZid === "") return;
    setStatus("");
    setError("");
    try {
      await createAggEntry({ parentZid, childZid, included });
      setStatus("Запись добавлена");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  };

  const toggleIncluded = async (entry: AggListEntry) => {
    setError("");
    try {
      await updateAggEntry(entry.id, {
        parentZid: entry.parentZid,
        childZid: entry.childZid,
        included: !entry.included,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить запись?")) return;
    setError("");
    try {
      await deleteAggEntry(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleReimport = async () => {
    if (!confirm("Перезагрузить из agg-list.json? Текущие записи будут заменены.")) return;
    setStatus("");
    setError("");
    try {
      const r = await reimportAggFromJson();
      setStatus(`Импортировано ${r.reimported} записей`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  if (!access.ok) {
    return <AdminAccessGate title="Агрегация" />;
  }

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Агрегация</h1>
        <div className="error-box">Требуется API-сервер.</div>
      </div>
    );
  }

  return (
    <div className="admin-page checks-editor">
      <header className="admin-header">
        <div>
          <h1>Конфигурация агрегации</h1>
          <p className="admin-desc">
            Аналог Access <code>frmAggrCfg</code> / таблица <code>a_tblAgg_List</code>: какие
            организации входят в свод головной. Флаг «включено» = Include?. Запуск свода — в{" "}
            <Link to="/tools?tab=aggregation">Сводка → Свод</Link>.
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void handleReimport()}>
            Импорт из файла
          </button>
          <Link to="/tools?tab=aggregation" className="btn btn-primary">
            Запустить свод
          </Link>
        </div>
      </header>

      {stats && (
        <p className="admin-desc">
          Записей: <strong>{stats.total}</strong> · включено: <strong>{stats.included}</strong> ·
          сводных организаций: <strong>{stats.parents}</strong>
        </p>
      )}
      {error && <div className="error-box">{error}</div>}
      {status && <div className="status-msg">{status}</div>}

      <section className="admin-section">
        <h2>Фильтр</h2>
        <label>
          Сводная организация
          <select
            value={filterParent}
            onChange={(e) =>
              setFilterParent(e.target.value === "" ? "" : Number(e.target.value))
            }
          >
            <option value="">Все</option>
            {parentOptions.map((o) => (
              <option key={o.zid} value={o.zid}>
                {o.name} {o.code ? `(${o.code})` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="admin-section">
        <h2>Добавить связь</h2>
        <form className="settings-form" onSubmit={handleAdd}>
          <label>
            Сводная организация
            <select value={parentZid} onChange={(e) => setParentZid(Number(e.target.value))}>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {o.name} (код {o.zid}{o.code ? `, ${o.code}` : ""})
                </option>
              ))}
            </select>
          </label>
          <label>
            Организация-участник
            <select value={childZid} onChange={(e) => setChildZid(Number(e.target.value))}>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {o.name} (код {o.zid}{o.code ? `, ${o.code}` : ""})
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={included}
              onChange={(e) => setIncluded(e.target.checked)}
            />
            Включить в свод
          </label>
          <button type="submit" className="btn btn-primary">
            Добавить
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Список ({entries.length})</h2>
        {loading ? (
          <p>Загрузка…</p>
        ) : entries.length === 0 ? (
          <p className="admin-desc">
            Нет записей. Импортируйте из <code>agg-list.json</code> или добавьте вручную.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Сводная</th>
                <th>Участник</th>
                <th>Включён</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.parentName ?? e.parentZid}
                    {e.parentCode ? ` (${e.parentCode})` : ""}
                  </td>
                  <td>
                    {e.childName ?? e.childZid}
                    {e.childCode ? ` (${e.childCode})` : ""}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void toggleIncluded(e)}
                    >
                      {e.included ? "да" : "нет"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleDelete(e.id)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
