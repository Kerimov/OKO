import { Outlet, Link, useNavigate, useMatch } from "react-router-dom";

import { usePackage } from "../context/PackageContext";

import { useAuth } from "../context/AuthContext";

import { formatPeriod } from "@portal/utils";

import { PackageSidebar } from "./PackageSidebar";

import { SyncStatusBar } from "../context/SyncContext";

import { useCoordinator } from "../context/CoordinatorContext";



export function Layout() {

  const { session, userName } = usePackage();

  const { isCoordinator } = useCoordinator();

  const { isAdmin, logout } = useAuth();

  const navigate = useNavigate();

  const formMatch = useMatch("/form/:instanceId");

  const selectedInstanceId = formMatch?.params.instanceId;



  const handleLogout = () => {

    void logout().then(() => navigate("/login"));

  };



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

          {isCoordinator && <Link to="/assignments">Назначения</Link>}

          {isAdmin && <Link to="/admin">Пользователи</Link>}

        </nav>

        <div className="sidebar-footer">

          <div className="sidebar-user" title={userName}>

            {userName}

          </div>

          <div className="sidebar-path" title={session.folderPath}>

            {session.folderPath}

          </div>

          <button type="button" className="sidebar-logout" onClick={handleLogout}>

            Выйти

          </button>

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

        <div className={`workspace${selectedInstanceId ? " workspace-split" : ""}`}>

          {selectedInstanceId && <PackageSidebar selectedInstanceId={selectedInstanceId} />}

          <div className="workspace-main">

            <Outlet />

          </div>

        </div>

        <SyncStatusBar />

      </main>

    </div>

  );

}

