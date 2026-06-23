import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login } from "../auth";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!needsAuthentication(isBackendMode(), auth) && auth.role) {
    return <Navigate to={defaultAppPath(auth)} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
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

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>ОКО</h1>
        <p className="login-desc">Вход в портал корпоративной отчётности</p>
        <form className="login-form" onSubmit={handleSubmit}>
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
        </form>
      </div>
    </div>
  );
}
