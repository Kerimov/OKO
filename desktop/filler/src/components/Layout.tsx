import { Outlet, Link, useNavigate } from "react-router-dom";
import { usePackage } from "../context/PackageContext";
import { formatPeriod } from "@portal/utils";

export function Layout() {
  const { session, userName } = usePackage();
  const navigate = useNavigate();

  if (!session) {
    return (
      <div className="center-page">
        <p>Комплект не открыт.</p>
        <button type="button" onClick={() => navigate("/")}>
          На главную
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/package" className="sidebar-brand">
          <span className="sidebar-brand-mark">ОКО</span>
          <span>Заполнение</span>
        </Link>
        <nav className="sidebar-nav">
          <Link to="/package">Комплект</Link>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">{userName}</div>
          <div className="sidebar-path" title={session.folderPath}>
            {session.folderPath}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="page-header compact">
          <div>
            <h1>{session.meta.organization}</h1>
            <p className="muted">
              ZID {session.meta.zid} · EID {session.meta.eid} ·{" "}
              {formatPeriod(session.meta.periodStart, session.meta.periodEnd)}
            </p>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
