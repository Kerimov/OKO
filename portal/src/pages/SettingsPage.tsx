import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadGlobalMeta, saveGlobalMeta } from "../storage";
import type { GlobalMeta } from "../storage";
import {
  getApiRole,
  getCurrentUser,
  isAuthRequired,
  isLoginAvailable,
  logout,
  refreshAuthRole,
  removeApiToken,
  saveApiToken,
} from "../auth";
import { getApiToken } from "../apiClient";

const emptyMeta: GlobalMeta = {
  organization: "",
  enterpriseCode: "1@1",
  periodStart: "",
  periodEnd: "",
  unit: "тыс.руб.",
};

export function SettingsPage() {
  const [meta, setMeta] = useState<GlobalMeta>(emptyMeta);
  const [apiToken, setApiToken] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const user = getCurrentUser();
  const loginMode = isLoginAvailable();

  useEffect(() => {
    loadGlobalMeta().then((m) => {
      setMeta(m);
      setApiToken(getApiToken() ?? "");
      setRole(getApiRole());
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    await saveGlobalMeta(meta);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveToken = async () => {
    if (apiToken.trim()) saveApiToken(apiToken);
    else removeApiToken();
    const r = await refreshAuthRole();
    setRole(r);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  if (loading) {
    return <div className="loading">Загрузка настроек…</div>;
  }

  return (
    <div className="settings-page">
      <h1>Настройки организации</h1>
      <p className="settings-desc">
        Эти значения подставляются по умолчанию во все новые формы.
      </p>
      <div className="settings-form">
        <label>
          Код предприятия
          <input
            value={meta.enterpriseCode}
            onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
          />
        </label>
        <label>
          Организация
          <input
            value={meta.organization}
            onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
            placeholder="Полное наименование"
          />
        </label>
        <label>
          Начало отчётного периода
          <input
            type="date"
            value={meta.periodStart}
            onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
          />
        </label>
        <label>
          Конец отчётного периода
          <input
            type="date"
            value={meta.periodEnd}
            onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
          />
        </label>
        <label>
          Единица измерения
          <input
            value={meta.unit}
            onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          Сохранить настройки
        </button>
        {saved && <span className="saved-msg">Сохранено</span>}
      </div>

      {loginMode && user ? (
        <>
          <h2 style={{ marginTop: "2rem" }}>Учётная запись</h2>
          <p className="settings-desc">
            Вы вошли как <strong>{user.displayName || user.username}</strong>
            {user.organizationName ? ` (${user.organizationName})` : ""}. Роль API:{" "}
            <strong>{role}</strong>.
          </p>
          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Выйти
          </button>
        </>
      ) : (
        <>
          <h2 style={{ marginTop: "2rem" }}>Подключение к API</h2>
          <p className="settings-desc">
            {loginMode ? (
              <>
                Вход по логину и паролю — на странице <Link to="/login">/login</Link>.
              </>
            ) : (
              <>
                Токен для доступа к API-серверу (Bearer). Admin — редакторы метаданных; user —
                только заполнение форм. В dev без <code>OKO_ADMIN_TOKEN</code> и без учётных
                записей авторизация не требуется.
              </>
            )}
          </p>
          {!loginMode && (
            <div className="settings-form">
              <label>
                API-токен
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Bearer-токен из .env сервера"
                  autoComplete="off"
                />
              </label>
              {role && (
                <p className="settings-desc">
                  Текущая роль: <strong>{role}</strong>
                  {isAuthRequired() ? "" : " (auth отключён на сервере)"}
                </p>
              )}
              <button type="button" className="btn btn-secondary" onClick={handleSaveToken}>
                Сохранить токен
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
