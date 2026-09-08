import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../apiClient";
import { hasPsdPermission } from "../auth";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

type PermissionEntry = {
  code: string;
  group: string;
  labelRu: string;
  labelEn: string;
};

type RoleMemberDto = {
  id: number;
  username: string;
  displayName: string | null;
  active: boolean;
};

type RoleDto = {
  code: string;
  nameRu: string;
  nameEn: string | null;
  system: boolean;
  active: boolean;
  permissions: string[];
  userCount: number;
  members: RoleMemberDto[];
  createdAt: string;
  updatedAt: string;
};

const GROUP_LABELS: Record<string, string> = {
  bp: "Бизнес-процесс",
  forms: "Формы",
  nsi: "НСИ",
  approval: "Согласование",
  tech: "Методология и настройки",
  reports: "Отчёты",
  audit: "Аудит",
  admin: "Администрирование",
};

const GROUP_HELP: Record<string, string> = {
  bp: "Запуск, согласование и завершение комплекта.",
  forms: "Просмотр и редактирование форм отчётности.",
  nsi: "Справочники, контрагенты и периметр сбора.",
  approval: "Пояснения к непройденным проверкам.",
  tech: "Редакторы правил, форм и методологии.",
  reports: "Построение отчётов и сводов.",
  audit: "Просмотр журнала действий.",
  admin: "Пользователи, роли и доступы.",
};

type RoleDirectoryUser = {
  id: number;
  username: string;
  displayName: string | null;
  active: boolean;
  roleCode: string | null;
  roleNameRu: string | null;
};

const ROLE_CODE_PATTERN = "[a-z][a-z0-9_]{1,63}";
const FALLBACK_ROLE = "subsidiary_specialist";

export function RolesAdminPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const canManage =
    !auth.authRequired ||
    hasPsdPermission("roles.manage") ||
    hasPsdPermission("tech.configure") ||
    auth.role === "admin";

  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [catalog, setCatalog] = useState<PermissionEntry[]>([]);
  const [directory, setDirectory] = useState<RoleDirectoryUser[]>([]);
  const [selected, setSelected] = useState<RoleDto | null>(null);
  const [nameRu, setNameRu] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [active, setActive] = useState(true);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [newCode, setNewCode] = useState("");
  const [newNameRu, setNewNameRu] = useState("");
  const [query, setQuery] = useState("");
  const [addUserId, setAddUserId] = useState<number | "">("");
  const [removeToRole, setRemoveToRole] = useState(FALLBACK_ROLE);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);

  const applyRole = useCallback((role: RoleDto) => {
    setSelected(role);
    setNameRu(role.nameRu);
    setNameEn(role.nameEn ?? "");
    setActive(role.active);
    setPerms(new Set(role.permissions));
    setAddUserId("");
    setRemoveToRole(role.code === FALLBACK_ROLE ? "support_specialist" : FALLBACK_ROLE);
    setStatus("");
    setError("");
  }, []);

  const load = useCallback(
    async (keepCode?: string) => {
      if (!backend || !canManage) return;
      setLoading(true);
      setError("");
      try {
        const [roleList, permList, userList] = await Promise.all([
          apiFetch<RoleDto[]>("/api/roles"),
          apiFetch<PermissionEntry[]>("/api/permissions"),
          apiFetch<RoleDirectoryUser[]>("/api/role-directory"),
        ]);
        const normalized = roleList.map((r) => ({ ...r, members: r.members ?? [] }));
        setRoles(normalized);
        setCatalog(permList);
        setDirectory(userList);
        setSelected((prev) => {
          const pick =
            (keepCode && normalized.find((r) => r.code === keepCode)) ||
            (prev && normalized.find((r) => r.code === prev.code)) ||
            normalized[0] ||
            null;
          if (pick) {
            setNameRu(pick.nameRu);
            setNameEn(pick.nameEn ?? "");
            setActive(pick.active);
            setPerms(new Set(pick.permissions));
            setRemoveToRole(pick.code === FALLBACK_ROLE ? "support_specialist" : FALLBACK_ROLE);
          }
          return pick;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    },
    [backend, canManage]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionEntry[]>();
    for (const p of catalog) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  }, [catalog]);

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => {
      const haystack = [
        r.nameRu,
        r.nameEn ?? "",
        r.code,
        r.system ? "системная" : "своя",
        ...r.members.flatMap((m) => [m.username, m.displayName ?? ""]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [roles, query]);

  const memberLabel = (m: RoleMemberDto | RoleDirectoryUser) =>
    m.displayName?.trim() || m.username;

  const candidates = useMemo(() => {
    if (!selected) return [];
    const memberIds = new Set(selected.members.map((m) => m.id));
    return directory.filter((u) => u.active && !memberIds.has(u.id));
  }, [directory, selected]);

  const otherRoles = useMemo(() => {
    if (!selected) return roles;
    return roles.filter((r) => r.active && r.code !== selected.code);
  }, [roles, selected]);

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || addUserId === "") return;
    setMemberBusy(true);
    setError("");
    setStatus("");
    try {
      await apiFetch(`/api/roles/${encodeURIComponent(selected.code)}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addUserId }),
      });
      setAddUserId("");
      setStatus("Пользователь добавлен в роль");
      await load(selected.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить");
    } finally {
      setMemberBusy(false);
    }
  };

  const handleRemoveMember = async (userId: number, label: string) => {
    if (!selected) return;
    const target = removeToRole || FALLBACK_ROLE;
    if (target === selected.code) {
      setError("Выберите другую роль для перевода");
      return;
    }
    if (!confirm(`Убрать «${label}» из роли «${selected.nameRu}» и перевести в другую роль?`)) {
      return;
    }
    setMemberBusy(true);
    setError("");
    setStatus("");
    try {
      const qs = new URLSearchParams({ toRole: target });
      await apiFetch(
        `/api/roles/${encodeURIComponent(selected.code)}/members/${userId}?${qs}`,
        { method: "DELETE" }
      );
      setStatus(`«${label}» переведён в другую роль`);
      await load(selected.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось убрать");
    } finally {
      setMemberBusy(false);
    }
  };

  const roleStats = useMemo(
    () => ({
      system: roles.filter((r) => r.system).length,
      custom: roles.filter((r) => !r.system).length,
      inactive: roles.filter((r) => !r.active).length,
    }),
    [roles]
  );

  const selectedPermCount = perms.size;
  const totalPermCount = catalog.length;
  const isDirty =
    !!selected &&
    (nameRu !== selected.nameRu ||
      (nameEn || "") !== (selected.nameEn || "") ||
      active !== selected.active ||
      selected.permissions.length !== perms.size ||
      selected.permissions.some((p) => !perms.has(p)));

  const togglePerm = (code: string) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const setGroup = (items: PermissionEntry[], checked: boolean) => {
    setPerms((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (checked) next.add(item.code);
        else next.delete(item.code);
      }
      return next;
    });
  };

  const setAllPermissions = (checked: boolean) => {
    setPerms(checked ? new Set(catalog.map((p) => p.code)) : new Set());
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      await apiFetch(`/api/roles/${encodeURIComponent(selected.code)}`, {
        method: "PUT",
        body: JSON.stringify({
          nameRu,
          nameEn: nameEn || null,
          active: selected.system ? true : active,
        }),
      });
      await apiFetch(`/api/roles/${encodeURIComponent(selected.code)}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: [...perms] }),
      });
      setStatus(`Роль «${nameRu}» сохранена`);
      await load(selected.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("");
    setError("");
    try {
      const created = await apiFetch<RoleDto>("/api/roles", {
        method: "POST",
        body: JSON.stringify({
          code: newCode,
          nameRu: newNameRu,
          permissions: [],
        }),
      });
      setNewCode("");
      setNewNameRu("");
      setStatus(`Роль «${created.nameRu}» создана`);
      await load(created.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    }
  };

  const handleDelete = async () => {
    if (!selected || selected.system) return;
    if (!confirm(`Удалить роль «${selected.nameRu}»?`)) return;
    setError("");
    try {
      await apiFetch(`/api/roles/${encodeURIComponent(selected.code)}`, {
        method: "DELETE",
      });
      setStatus("Роль удалена");
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Роли</h1>
        <div className="error-box">Требуется API-сервер.</div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="admin-page">
        <h1>Роли</h1>
        <div className="error-box">
          Недостаточно прав. <Link to="/desktop">На рабочий стол</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page roles-editor">
      <header className="admin-header roles-editor-header">
        <div>
          <h1>Роли и права</h1>
          <p className="admin-desc">
            Администратор настраивает роли через готовый каталог прав. Новые коды прав не
            создаются в интерфейсе.
          </p>
        </div>
        <div className="roles-stats" aria-label="Статистика ролей">
          <span>{roles.length} ролей</span>
          <span>{roleStats.system} системных</span>
          <span>{roleStats.custom} своих</span>
          {roleStats.inactive > 0 ? <span>{roleStats.inactive} отключено</span> : null}
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {status && <div className="status-msg">{status}</div>}

      <div className="roles-workspace">
        <aside className="roles-sidebar">
          <section className="roles-card roles-create-card">
            <div className="roles-card-title">
              <h2>Новая роль</h2>
              <span>своя</span>
            </div>
            <form className="roles-create-form" onSubmit={handleCreate}>
              <label>
                Код
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="branch_reviewer"
                  required
                  pattern={ROLE_CODE_PATTERN}
                  title="Латиница snake_case, например branch_reviewer"
                />
              </label>
              <label>
                Название
                <input
                  value={newNameRu}
                  onChange={(e) => setNewNameRu(e.target.value)}
                  placeholder="Ревьюер филиала"
                  required
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Создать роль
              </button>
            </form>
          </section>

          <section className="roles-card roles-list-card">
            <div className="roles-card-title">
              <h2>Роли</h2>
              <span>{filteredRoles.length}</span>
            </div>
            <label className="roles-search">
              Поиск
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название или код"
              />
            </label>
            {loading ? (
              <p className="tools-hint">Загрузка…</p>
            ) : filteredRoles.length === 0 ? (
              <p className="tools-hint">Ничего не найдено.</p>
            ) : (
              <div className="roles-list" role="list">
                {filteredRoles.map((r) => (
                  <button
                    key={r.code}
                    type="button"
                    className={`roles-list-item ${
                      selected?.code === r.code ? "is-selected" : ""
                    }`}
                    onClick={() => applyRole(r)}
                    title={r.code}
                  >
                    <span className="roles-list-name">{r.nameRu}</span>
                    <span className="roles-list-meta">
                      {r.system ? "Системная" : "Своя"} · {r.permissions.length} прав ·{" "}
                      {r.members.length} участн.
                    </span>
                    {!r.active ? <span className="roles-list-badge">Отключена</span> : null}
                    <span className="roles-list-members">
                      {r.members.length === 0 ? (
                        <span className="roles-member-empty">Нет участников</span>
                      ) : (
                        r.members.map((m) => (
                          <span
                            key={m.id}
                            className={`roles-member-chip ${m.active ? "" : "is-inactive"}`}
                            title={m.active ? m.username : `${m.username} · отключён`}
                          >
                            {memberLabel(m)}
                          </span>
                        ))
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className="roles-editor-panel">
          {!selected ? (
            <section className="roles-empty-state">
              <h2>Выберите роль</h2>
              <p>Слева выберите существующую роль или создайте новую.</p>
            </section>
          ) : (
            <form onSubmit={handleSave}>
              <section className="roles-card roles-details-card">
                <div className="roles-detail-header">
                  <div>
                    <div className="roles-eyebrow">Редактирование роли</div>
                    <h2>{selected.nameRu}</h2>
                    <p title={selected.code}>{selected.code}</p>
                  </div>
                  <div className="roles-detail-badges">
                    <span className={selected.system ? "role-pill role-pill-system" : "role-pill"}>
                      {selected.system ? "Системная" : "Своя"}
                    </span>
                    <span className={active ? "role-pill role-pill-active" : "role-pill"}>
                      {active ? "Активна" : "Отключена"}
                    </span>
                  </div>
                </div>

                <div className="roles-form-grid">
                  <label>
                    Название на русском
                    <input value={nameRu} onChange={(e) => setNameRu(e.target.value)} required />
                  </label>
                  <label>
                    Название на английском
                    <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
                  </label>
                  {!selected.system && (
                    <label className="roles-switch">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                      />
                      Роль активна и доступна для назначения
                    </label>
                  )}
                </div>

                <div className="roles-members-block">
                  <div className="roles-members-heading">
                    <h3>Участники</h3>
                    <span>{selected.members.length}</span>
                  </div>

                  <form className="roles-members-add" onSubmit={handleAddMember}>
                    <label>
                      Добавить пользователя
                      <select
                        value={addUserId === "" ? "" : String(addUserId)}
                        onChange={(e) =>
                          setAddUserId(e.target.value ? Number(e.target.value) : "")
                        }
                        disabled={memberBusy || candidates.length === 0}
                      >
                        <option value="">
                          {candidates.length === 0
                            ? "Нет доступных пользователей"
                            : "Выберите пользователя…"}
                        </option>
                        {candidates.map((u) => (
                          <option key={u.id} value={u.id}>
                            {memberLabel(u)}
                            {u.roleNameRu ? ` · сейчас: ${u.roleNameRu}` : ""}
                            {` (${u.username})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={memberBusy || addUserId === ""}
                    >
                      {memberBusy ? "…" : "Добавить"}
                    </button>
                  </form>

                  {otherRoles.length > 0 ? (
                    <label className="roles-members-reassign">
                      При снятии перевести в
                      <select
                        value={removeToRole}
                        onChange={(e) => setRemoveToRole(e.target.value)}
                        disabled={memberBusy}
                      >
                        {otherRoles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.nameRu}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {selected.members.length === 0 ? (
                    <p className="tools-hint">В этой роли пока никого нет.</p>
                  ) : (
                    <ul className="roles-members-list">
                      {selected.members.map((m) => (
                        <li key={m.id} className={!m.active ? "is-inactive" : undefined}>
                          <div className="roles-member-meta">
                            <strong>{memberLabel(m)}</strong>
                            <span>{m.username}</span>
                            {!m.active ? <em>отключён</em> : null}
                          </div>
                          <button
                            type="button"
                            className="btn"
                            disabled={memberBusy || !m.active || otherRoles.length === 0}
                            onClick={() => void handleRemoveMember(m.id, memberLabel(m))}
                          >
                            Убрать
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="tools-hint roles-members-footnote">
                    Назначить роль можно и на странице{" "}
                    <Link to="/admin/users">Пользователи</Link>.
                  </p>
                </div>
              </section>

              <section className="roles-card roles-permissions-card">
                <div className="roles-permissions-toolbar">
                  <div>
                    <h3>Права доступа</h3>
                    <p>
                      Выбрано {selectedPermCount} из {totalPermCount}. После сохранения пользователи
                      увидят изменения после нового входа.
                    </p>
                  </div>
                  <div className="roles-toolbar-actions">
                    <button type="button" className="btn" onClick={() => setAllPermissions(true)}>
                      Выбрать всё
                    </button>
                    <button type="button" className="btn" onClick={() => setAllPermissions(false)}>
                      Снять всё
                    </button>
                  </div>
                </div>

                <div className="roles-permission-groups">
                  {grouped.map(([group, items]) => {
                    const selectedInGroup = items.filter((p) => perms.has(p.code)).length;
                    const allInGroup = selectedInGroup === items.length;
                    return (
                      <section key={group} className="roles-perm-group">
                        <header>
                          <div>
                            <h4>{GROUP_LABELS[group] ?? group}</h4>
                            <p>{GROUP_HELP[group] ?? "Набор связанных прав."}</p>
                          </div>
                          <div className="roles-group-actions">
                            <span>
                              {selectedInGroup}/{items.length}
                            </span>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setGroup(items, !allInGroup)}
                            >
                              {allInGroup ? "Снять" : "Выбрать"}
                            </button>
                          </div>
                        </header>
                        <div className="roles-perm-list">
                          {items.map((p) => (
                            <label
                              key={p.code}
                              className={`roles-permission ${
                                perms.has(p.code) ? "is-checked" : ""
                              }`}
                              title={p.code}
                            >
                              <input
                                type="checkbox"
                                checked={perms.has(p.code)}
                                onChange={() => togglePerm(p.code)}
                              />
                              <span>{p.labelRu}</span>
                            </label>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>

              <div className="roles-sticky-actions">
                <div>
                  {isDirty ? (
                    <span>Есть несохранённые изменения</span>
                  ) : (
                    <span>Изменений нет</span>
                  )}
                </div>
                <div className="roles-toolbar-actions">
                  {!selected.system && (
                    <button type="button" className="btn" onClick={handleDelete}>
                      Удалить
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={saving || !isDirty}>
                    {saving ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
