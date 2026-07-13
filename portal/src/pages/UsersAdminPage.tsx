import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../apiClient";
import type { UserDto } from "../auth";
import { listOrganizations } from "../packagesApi";
import type { Organization } from "../types";
import { isBackendMode } from "../storage";
import { roleLabel } from "../uiLabels";
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
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"admin" | "org">("org");
  const [zid, setZid] = useState<number | "">("");

  const [selected, setSelected] = useState<UserDto | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "org">("org");
  const [editZid, setEditZid] = useState<number | "">("");
  const [editActive, setEditActive] = useState(true);

  const applyUserToEdit = (user: UserDto) => {
    setSelected(user);
    setEditDisplayName(user.displayName ?? "");
    setEditPassword("");
    setEditRole(user.role);
    setEditZid(user.zid ?? "");
    setEditActive(user.active);
    setStatus("");
    setError("");
  };

  const load = useCallback(async (keepSelectedId?: number) => {
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
      setZid((prev) => (prev === "" && orgList[0] ? orgList[0].zid : prev));
      if (keepSelectedId != null) {
        const updated = userList.find((u) => u.id === keepSelectedId);
        if (updated) applyUserToEdit(updated);
        else setSelected(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, admin]);

  useEffect(() => {
    load();
  }, [load]);

  const selectUser = (user: UserDto) => {
    applyUserToEdit(user);
  };

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

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (editRole === "org" && (editZid === "" || orgs.length === 0)) {
      setError("Выберите организацию для пользователя");
      return;
    }
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const body: Record<string, unknown> = {
        displayName: editDisplayName.trim() || null,
        role: editRole,
        zid: editRole === "org" ? editZid : null,
        active: editActive,
      };
      if (editPassword.trim()) body.password = editPassword.trim();

      const updated = await apiFetch<UserDto>(`/api/users/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setStatus(`Пользователь «${updated.username}» сохранён`);
      setEditPassword("");
      setSelected(updated);
      await load(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
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
    <div className="admin-page checks-editor users-editor">
      <header className="admin-header">
        <div>
          <h1>Пользователи организаций</h1>
          <p className="admin-desc">
            Учётные записи для личных кабинетов (логин/пароль). Пользователь организации видит
            только формы своей организации.
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
                      {o.name} (код {o.zid})
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

      <div className="checks-layout">
        <section className="checks-list-panel">
          <h2>Список ({users.length})</h2>
          {loading ? (
            <p>Загрузка…</p>
          ) : users.length === 0 ? (
            <p className="tools-hint">Пользователей пока нет.</p>
          ) : (
            <table className="checks-table data-table">
              <thead>
                <tr>
                  <th>Логин</th>
                  <th>Имя</th>
                  <th>Роль</th>
                  <th>Организация</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={selected?.id === u.id ? "selected" : ""}
                    onClick={() => selectUser(u)}
                  >
                    <td>{u.username}</td>
                    <td>{u.displayName ?? "—"}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td>{u.organizationName ?? (u.role === "admin" ? "—" : "?")}</td>
                    <td>{u.active ? "активен" : "отключён"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="checks-detail-panel">
          {selected ? (
            <>
              <h2>Редактирование: {selected.username}</h2>
              <form className="checks-form-grid" onSubmit={handleSaveEdit}>
                <label>
                  Логин
                  <input value={selected.username} disabled />
                </label>
                <label>
                  Новый пароль
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Оставьте пустым, чтобы не менять"
                    minLength={6}
                  />
                </label>
                <label>
                  Отображаемое имя
                  <input
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                  />
                </label>
                <label>
                  Роль
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as "admin" | "org")}
                  >
                    <option value="org">Организация</option>
                    <option value="admin">Администратор</option>
                  </select>
                </label>
                {editRole === "org" && (
                  <label>
                    Организация
                    {orgs.length === 0 ? (
                      <p className="tools-hint">
                        Нет организаций в справочнике.{" "}
                        <Link to="/package">Добавить в комплекте</Link>.
                      </p>
                    ) : (
                      <select
                        value={editZid}
                        onChange={(e) => setEditZid(Number(e.target.value))}
                        required
                      >
                        {orgs.map((o) => (
                          <option key={o.zid} value={o.zid}>
                            {o.name} (код {o.zid})
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                )}
                <label className="check-flag">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                  />
                  Учётная запись активна
                </label>
                <div className="checks-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={saving || (editRole === "org" && orgs.length === 0)}
                  >
                    {saving ? "Сохранение…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={saving}
                    onClick={() => setSelected(null)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <h2>Редактирование</h2>
              <p className="tools-hint">Выберите пользователя в списке слева.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
