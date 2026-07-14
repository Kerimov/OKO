import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteReportPackage, fetchPackagesDashboard } from "../packagesApi";
import type { PackageDashboardRow } from "../types";
import { formatPeriod, packageWorkflowLabel } from "../utils";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function PackagesDashboardPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const [rows, setRows] = useState<PackageDashboardRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!backend || !admin) return;
    setLoading(true);
    setError("");
    try {
      setRows(await fetchPackagesDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, admin]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.organizationName.toLowerCase().includes(q) ||
        (r.organizationCode ?? "").toLowerCase().includes(q) ||
        r.periodName.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        packages: acc.packages + 1,
        filled: acc.filled + r.filled,
        submitted: acc.submitted + r.submitted,
        forms: acc.forms + r.total,
      }),
      { packages: 0, filled: 0, submitted: 0, forms: 0 }
    );
  }, [filtered]);

  const handleDelete = async (r: PackageDashboardRow) => {
    const label = `${r.organizationName} — ${r.periodName}`;
    const formsPart =
      r.filled > 0
        ? `Будут удалены все формы комплекта (${r.filled}).\n`
        : "Форм в комплекте нет.\n";
    if (
      !confirm(
        `Удалить комплект «${label}»?\n\n${formsPart}Отчётный период будет удалён. Действие необратимо.`
      )
    ) {
      return;
    }
    const key = `${r.zid}-${r.eid}`;
    setDeletingKey(key);
    setError("");
    try {
      await deleteReportPackage(r.zid, r.eid);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setDeletingKey(null);
    }
  };

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Комплекты организаций</h1>
        <div className="error-box">Требуется API-сервер.</div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="admin-page">
        <h1>Комплекты организаций</h1>
        <div className="error-box">
          Доступ только для администратора. <Link to="/settings">Настройки</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page checks-editor">
      <header className="admin-header">
        <div>
          <h1>Комплекты организаций</h1>
          <p className="admin-desc">
            Обзор комплектов по организациям и периодам (организация и период).{" "}
            <strong>Заведено</strong> — сколько форм создано из каталога (черновик или сдано).{" "}
            <strong>Сдано</strong> — только со статусом «сдано».
          </p>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="checks-filters">
        <input
          type="search"
          placeholder="Поиск по организации или периоду…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      {filtered.length > 0 && (
        <p className="admin-desc">
          Комплектов: <strong>{totals.packages}</strong> · форм заведено:{" "}
          <strong>
            {totals.filled}/{totals.forms}
          </strong>{" "}
          · сдано: <strong>{totals.submitted}</strong>
        </p>
      )}

      {loading ? (
        <p>Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="admin-desc">Нет периодов или комплектов. Создайте организации на /package.</p>
      ) : (
        <table className="data-table packages-dashboard-table">
          <thead>
            <tr>
              <th>Организация</th>
              <th>Период</th>
              <th>Статус</th>
              <th>Заведено</th>
              <th>Черновики</th>
              <th>Сдано</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.zid}-${r.eid}`}>
                <td>
                  <div>{r.organizationName}</div>
                  {r.organizationCode && (
                    <div className="table-sub">{r.organizationCode}</div>
                  )}
                </td>
                <td>
                  <div>{r.periodName}</div>
                  <div className="table-sub">
                    {formatPeriod(r.periodStart ?? "", r.periodEnd ?? "")}
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${r.packageStatus ?? "draft"}`}>
                    {packageWorkflowLabel(r.packageStatus)}
                  </span>
                </td>
                <td>
                  <div className="completeness-inline" title="Доля заведённых форм из каталога">
                    <div
                      className="completeness-fill"
                      style={{ width: `${r.percent}%` }}
                    />
                  </div>
                  <span>
                    {r.filled}/{r.total} ({r.percent}%)
                  </span>
                </td>
                <td>{r.draft}</td>
                <td>
                  <span className={r.submitted > 0 ? "status-badge submitted" : ""}>
                    {r.submitted}
                    {r.total > 0 && (
                      <> · {Math.round((r.submitted / r.total) * 100)}%</>
                    )}
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    <Link
                      to={`/package?zid=${r.zid}&eid=${r.eid}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Открыть
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      disabled={deletingKey === `${r.zid}-${r.eid}`}
                      onClick={() => void handleDelete(r)}
                    >
                      {deletingKey === `${r.zid}-${r.eid}` ? "Удаление…" : "Удалить"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
