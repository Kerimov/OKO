import { Link, Outlet, useLocation } from "react-router-dom";

export function Layout() {
  const { pathname } = useLocation();

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
          <Link to="/settings" className={pathname === "/settings" ? "active" : ""}>
            Настройки
          </Link>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        Формы корпоративной (специализированной) отчётности · 75 форм
      </footer>
    </div>
  );
}
