import { Link, Outlet, useLocation } from "react-router-dom";
import {
  getApiRole,
  getCurrentUser,
  isAdminRole,
  isLoginAvailable,
  isOrgUser,
  logout,
} from "../auth";
import { isBackendMode } from "../storage";

export function Layout() {
  const { pathname } = useLocation();
  const adminNav = isBackendMode() && isAdminRole();
  const orgUser = isOrgUser();
  const user = getCurrentUser();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="logo">
          <span className="logo-mark">ОКО</span>
          <span className="logo-text">Портал форм корпоративной отчётности</span>
        </Link>
        <nav className="header-nav">
          <Link to="/" className={pathname === "/" ? "active" : ""}>
            Каталог шаблонов
          </Link>
          <Link
            to="/my"
            className={pathname.startsWith("/my") ? "active" : ""}
          >
            Мои формы ОКО
          </Link>
          {!orgUser && (
            <Link to="/tools" className={pathname === "/tools" ? "active" : ""}>
              Администрирование
            </Link>
          )}
          <Link to="/package" className={pathname === "/package" ? "active" : ""}>
            Комплект
          </Link>
          {adminNav && (
            <>
              <Link
                to="/admin/forms"
                className={pathname === "/admin/forms" ? "active" : ""}
              >
                Конструктор
              </Link>
              <Link
                to="/admin/checks"
                className={pathname.startsWith("/admin/checks") ? "active" : ""}
              >
                Увязки
              </Link>
              <Link
                to="/admin/saldo"
                className={pathname === "/admin/saldo" ? "active" : ""}
              >
                Сальдо
              </Link>
              <Link
                to="/admin/excel"
                className={pathname === "/admin/excel" ? "active" : ""}
              >
                Excel
              </Link>
              <Link
                to="/admin/rash"
                className={pathname === "/admin/rash" ? "active" : ""}
              >
                Расшифровки
              </Link>
              <Link
                to="/admin/users"
                className={pathname === "/admin/users" ? "active" : ""}
              >
                Пользователи
              </Link>
              <Link
                to="/admin/audit"
                className={pathname === "/admin/audit" ? "active" : ""}
              >
                Аудит
              </Link>
            </>
          )}
          <Link to="/settings" className={pathname === "/settings" ? "active" : ""}>
            Настройки
          </Link>
          {isBackendMode() && getApiRole() && isLoginAvailable() && (
            <button type="button" className="header-logout" onClick={handleLogout}>
              Выйти
            </button>
          )}
        </nav>
        {user && (
          <div className="header-user" title={user.username}>
            {user.displayName || user.username}
            {user.organizationName ? ` · ${user.organizationName}` : ""}
          </div>
        )}
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        Формы корпоративной (специализированной) отчётности · 76 форм
      </footer>
    </div>
  );
}
