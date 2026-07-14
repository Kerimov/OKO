import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadGlobalMeta, saveGlobalMeta } from "../storage";
import type { GlobalMeta } from "../storage";
import {
  logout,
  logoutAllDevices,
  removeApiToken,
  refreshAuthRole,
  saveApiToken,
} from "../auth";
import { roleLabel } from "../uiLabels";
import { getApiToken } from "../apiClient";
import { useAuth } from "../useAuth";

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
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const auth = useAuth();
  const user = auth.user;
  const loginMode = auth.loginAvailable;

  useEffect(() => {
    loadGlobalMeta().then((m) => {
      setMeta(m);
      setApiToken(getApiToken() ?? "");
      setLoading(false);
    });
  }, []);

  const canEditGlobalMeta = !auth.authRequired || auth.role === "admin";

  const handleSave = async () => {
    if (!canEditGlobalMeta) return;
    await saveGlobalMeta(meta);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };
  const handleLogoutAll = async () => {
    await logoutAllDevices();
    window.location.href = "/";
  };
  const handleClearToken = () => {
    removeApiToken();
    setApiToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveToken = async () => {
    saveApiToken(apiToken.trim());
    await refreshAuthRole();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!canEditGlobalMeta}
        >
          Сохранить настройки
        </button>
        {saved && <span className="saved-msg">Сохранено</span>}
        {!canEditGlobalMeta && (
          <p className="settings-desc">
            Глобальные реквизиты меняет только администратор. Рабочий комплект — в разделе
            «Комплект».
          </p>
        )}
      </div>

      {loginMode && user ? (
        <>
          <h2 style={{ marginTop: "2rem" }}>Учётная запись</h2>
          <p className="settings-desc">
            Вы вошли как <strong>{user.displayName || user.username}</strong>
            {user.organizationName ? ` (${user.organizationName})` : ""}. Роль:{" "}
            <strong>{roleLabel(auth.role)}</strong>.
          </p>
          <div className="toolbar-actions" style={{ gap: "0.5rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()}>
              Выйти
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleLogoutAll()}
              title="Инвалидирует все сессии пользователя на сервере"
            >
              Выйти везде
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ marginTop: "2rem" }}>Подключение к API</h2>
          <p className="settings-desc">
            {loginMode ? (
              <>
                Вход по логину и паролю — на <Link to="/">главной странице</Link>.
              </>
            ) : (
              <>
                Токен для доступа к API-серверу. Администратор — редакторы метаданных; организация —
                только заполнение форм. В dev без <code>OKO_ADMIN_TOKEN</code> и без учётных
                записей авторизация не требуется.
              </>
            )}
          </p>
          {loginMode && auth.legacyToken && (
            <div className="error-box" style={{ marginTop: "0.75rem" }}>
              В браузере сохранён служебный токен (устаревший режим), поэтому вы видите роль{" "}
              <strong>{roleLabel(auth.role)}</strong> и урезанный функционал. Нажмите «Сбросить токен» и
              войдите на <Link to="/">главной странице</Link>.
              <div style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" onClick={handleClearToken}>
                  Сбросить токен
                </button>
              </div>
            </div>
          )}
          {!loginMode && (
            <div className="settings-form">
              <label>
                API-токен
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Токен из настроек сервера"
                  autoComplete="off"
                />
              </label>
              {auth.role && (
                <p className="settings-desc">
                  Текущая роль: <strong>{roleLabel(auth.role)}</strong>
                  {auth.authRequired ? "" : " (вход на сервере отключён)"}
                </p>
              )}
              <div className="toolbar-actions" style={{ gap: "0.5rem" }}>
                <button type="button" className="btn btn-primary" onClick={handleSaveToken}>
                  Сохранить токен
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleClearToken}>
                  Удалить токен
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
