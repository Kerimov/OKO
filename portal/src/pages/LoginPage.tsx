import { FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, refreshAuthRole, saveApiToken } from "../auth";
import { defaultAppPath, needsAuthentication } from "../authRouting";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const fromState = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const from =
    fromState && fromState !== "/" && fromState !== "/login"
      ? fromState
      : defaultAppPath(auth);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const legacyOnly = auth.authRequired && !auth.loginAvailable;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoError = params.get("sso_error");
    if (ssoError) {
      setError(ssoError);
      params.delete("sso_error");
      const next = params.toString();
      navigate({ pathname: "/login", search: next ? `?${next}` : "" }, { replace: true });
      return;
    }
    const ssoToken = params.get("sso_token");
    if (!ssoToken) return;
    setSsoBusy(true);
    setError("");
    void (async () => {
      try {
        saveApiToken(ssoToken);
        const role = await refreshAuthRole();
        if (!role) throw new Error("SSO-сессия не принята сервером");
        params.delete("sso_token");
        const next = params.toString();
        navigate(
          { pathname: from, search: next ? `?${next}` : "" },
          { replace: true }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка SSO");
        setSsoBusy(false);
      }
    })();
  }, [location.search, navigate, from]);

  if (ssoBusy) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>ОКО</h1>
          <p className="login-desc">Завершение входа через SSO…</p>
        </div>
      </div>
    );
  }

  if (!needsAuthentication(isBackendMode(), auth) && auth.role) {
    return <Navigate to={defaultAppPath(auth)} replace />;
  }

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      let msg = "Ошибка входа";
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as { error?: string };
          msg = parsed.error ?? err.message;
        } catch {
          msg = err.message;
        }
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleTokenLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      saveApiToken(apiToken.trim());
      const role = await refreshAuthRole();
      if (!role) {
        throw new Error("Неверный API-токен");
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный API-токен");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>ОКО</h1>
        <p className="login-desc">Вход в портал корпоративной отчётности</p>
        {legacyOnly ? (
          <form className="login-form" onSubmit={handleTokenLogin}>
            <label>
              Токен API
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="OKO_ADMIN_TOKEN из .env сервера"
                autoComplete="off"
                required
                autoFocus
              />
            </label>
            {error && <div className="error-box">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Проверка…" : "Войти"}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handlePasswordLogin}>
            <label>
              Логин
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <div className="error-box">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Вход…" : "Войти"}
            </button>
            <OidcLoginButton />
            <p className="login-desc" style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
              Локальная разработка: логин и пароль из{" "}
              <code>OKO_BOOTSTRAP_ADMIN_USER</code> / <code>OKO_BOOTSTRAP_ADMIN_PASSWORD</code> в
              файле <code>.env</code>. Чтобы отключить авторизацию, задайте{" "}
              <code>OKO_AUTH_DISABLED=1</code> и перезапустите API.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function OidcLoginButton() {
  const [oidc, setOidc] = useState<{ enabled?: boolean; status?: string } | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/oidc/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOidc(d))
      .catch(() => setOidc(null));
  }, []);

  if (!oidc?.enabled) return null;

  return (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ marginTop: "0.75rem", width: "100%" }}
      disabled={starting}
      onClick={() => {
        setStarting(true);
        void fetch("/api/auth/oidc/start")
          .then(async (r) => {
            const data = (await r.json()) as { authorizationUrl?: string; error?: string };
            if (!r.ok || !data.authorizationUrl) {
              throw new Error(data.error || "OIDC start failed");
            }
            window.location.href = data.authorizationUrl;
          })
          .catch(() => setStarting(false));
      }}
    >
      {starting ? "Переход к SSO…" : "Войти через SSO (OIDC)"}
    </button>
  );
}
