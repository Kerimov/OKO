import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicUser, UserRole } from "../types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  coordinator: "Координатор",
  executor: "Исполнитель",
};

export function AdminPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [login, setLogin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("executor");

  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const list = await window.oko.authListUsers();
      setUsers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(""), 3000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await window.oko.authCreateUser({ login, displayName, password, role });
      setLogin("");
      setDisplayName("");
      setPassword("");
      setRole("executor");
      flash("Пользователь создан");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (user: PublicUser) => {
    setError("");
    try {
      await window.oko.authUpdateUser({ id: user.id, active: !user.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleRoleChange = async (user: PublicUser, nextRole: UserRole) => {
    setError("");
    try {
      await window.oko.authUpdateUser({ id: user.id, role: nextRole });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    setBusy(true);
    setError("");
    try {
      await window.oko.authResetPassword(resetUserId, resetPassword);
      setResetUserId(null);
      setResetPassword("");
      flash("Пароль обновлён");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (user: PublicUser) => {
    if (!confirm(`Удалить пользователя «${user.login}»?`)) return;
    setError("");
    try {
      await window.oko.authDeleteUser(user.id);
      flash("Пользователь удалён");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <div className="page admin-page">
      <div className="page-toolbar">
        <h2>Администрирование пользователей</h2>
        <Link to="/" className="btn btn-secondary">
          ← К комплекту
        </Link>
      </div>

      {status && <p className="status-ok">{status}</p>}
      {error && <p className="error">{error}</p>}

      <section className="admin-section">
        <h3>Новый пользователь</h3>
        <form className="admin-create-form" onSubmit={(e) => void handleCreate(e)}>
          <label className="field">
            <span>Логин</span>
            <input value={login} onChange={(e) => setLogin(e.target.value)} required />
          </label>
          <label className="field">
            <span>Имя</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Как в форме и назначениях"
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Роль</span>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="executor">Исполнитель</option>
              <option value="coordinator">Координатор</option>
              <option value="admin">Администратор</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Добавить
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h3>Пользователи ({users.length})</h3>
        <table className="assignments-table admin-users-table">
          <thead>
            <tr>
              <th>Логин</th>
              <th>Имя</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.active ? "" : "admin-user-inactive"}>
                <td>{user.login}</td>
                <td>{user.displayName}</td>
                <td>
                  <select
                    value={user.role}
                    onChange={(e) => void handleRoleChange(user, e.target.value as UserRole)}
                  >
                    <option value="executor">{ROLE_LABELS.executor}</option>
                    <option value="coordinator">{ROLE_LABELS.coordinator}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                  </select>
                </td>
                <td>{user.active ? "Активен" : "Отключён"}</td>
                <td className="admin-actions">
                  <button type="button" onClick={() => void handleToggleActive(user)}>
                    {user.active ? "Отключить" : "Включить"}
                  </button>
                  <button type="button" onClick={() => setResetUserId(user.id)}>
                    Сброс пароля
                  </button>
                  <button type="button" className="btn-danger-text" onClick={() => void handleDelete(user)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {resetUserId && (
        <div className="modal-backdrop" onClick={() => setResetUserId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Новый пароль</h3>
            <form onSubmit={(e) => void handleResetPassword(e)}>
              <label className="field">
                <span>Пароль</span>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setResetUserId(null)}>
                  Отмена
                </button>
                <button type="submit" className="primary" disabled={busy}>
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
