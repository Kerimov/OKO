import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../apiClient";
import type { UserDto } from "../auth";
import { listOrganizations } from "../packagesApi";
import type { Organization } from "../types";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function UsersAdminPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const [users, setUsers] = useState<UserDto[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"admin" | "org">("org");
  const [zid, setZid] = useState<number | "">("");

  const load = useCallback(async () => {
    if (!backend || !admin) return;
    setLoading(true);
    setError("");
    try {
      const [userList, orgList] = await Promise.all([
        apiFetch<UserDto[]>("/api/users"),
        listOrganizations(),
      ]);
      setUsers(userList);
      setOrgs(orgList);
      if (orgList[0] && zid === "") setZid(orgList[0].zid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, admin]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("");
    setError("");
    try {
      await apiFetch<UserDto>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          displayName: displayName || undefined,
          role,
          zid: role === "org" ? zid : null,
        }),
      });
      setUsername("");
      setPassword("");
      setDisplayName("");
      setStatus("Пользователь создан");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    }
  };

  const toggleActive = async (user: UserDto) => {
    setError("");
    try {
      await apiFetch<UserDto>(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !user.active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    }
  };

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Пользователи</h1>
        <div className="error-box">Требуется API-сервер.</div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="admin-page">
        <h1>Пользователи</h1>
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
          <h1>Пользователи организаций</h1>
          <p className="admin-desc">
            Учётные записи для личных кабинетов (логин/пароль). Пользователь организации видит
            только формы своей организации (zid).
          </p>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {status && <div className="status-msg">{status}</div>}

      <section className="admin-section">
        <h2>Новый пользователь</h2>
        <form className="settings-form" onSubmit={handleCreate}>
          <label>
            Логин
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Пароль (мин. 6 символов)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label>
            Отображаемое имя
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Роль
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "org")}>
              <option value="org">Организация</option>
              <option value="admin">Администратор</option>
            </select>
          </label>
          {role === "org" && (
            <label>
              Организация
              {orgs.length === 0 ? (
                <p className="tools-hint">
                  В справочнике нет организаций. Создайте запись на странице{" "}
                  <Link to="/package">Комплект</Link> (раздел «Добавить организацию») — не
                  путать с полем «Организация» в <Link to="/settings">Настройках</Link>.
                </p>
              ) : (
                <select
                  value={zid}
                  onChange={(e) => setZid(Number(e.target.value))}
                  required
                >
                  {orgs.map((o) => (
                    <option key={o.zid} value={o.zid}>
                      {o.name} (zid={o.zid})
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={role === "org" && orgs.length === 0}
          >
            Создать
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Список ({users.length})</h2>
        {loading ? (
          <p>Загрузка…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Имя</th>
                <th>Роль</th>
                <th>Организация</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName ?? "—"}</td>
                  <td>{u.role}</td>
                  <td>{u.organizationName ?? (u.role === "admin" ? "—" : "?")}</td>
                  <td>{u.active ? "активен" : "отключён"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleActive(u)}
                    >
                      {u.active ? "Отключить" : "Включить"}
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
