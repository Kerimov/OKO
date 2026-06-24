import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="muted">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="muted">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return <>{children}</>;
}

export function LoginPage() {
  const { user, needsSetup, login, createInitialAdmin } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={from} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(loginName, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createInitialAdmin(loginName, displayName, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания администратора");
    } finally {
      setBusy(false);
    }
  };

  if (!window.oko) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>ОКО Заполнение</h1>
          <p className="error">Ошибка запуска приложения.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>ОКО Заполнение</h1>
        <p className="muted">
          {needsSetup
            ? "Первый запуск: создайте учётную запись администратора"
            : "Войдите в систему"}
        </p>

        {needsSetup ? (
          <form className="auth-form" onSubmit={(e) => void handleSetup(e)}>
            <label className="field">
              <span>Логин</span>
              <input
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                autoComplete="username"
                placeholder="ivanov"
                required
              />
            </label>
            <label className="field">
              <span>Отображаемое имя</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Иванов И.И."
              />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <label className="field">
              <span>Повтор пароля</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary auth-submit" disabled={busy}>
              Создать администратора
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(e) => void handleLogin(e)}>
            <label className="field">
              <span>Логин</span>
              <input
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary auth-submit" disabled={busy}>
              Войти
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
