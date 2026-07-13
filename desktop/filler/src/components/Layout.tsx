import { Outlet, Link, useNavigate, useMatch } from "react-router-dom";

import { useEffect, useState } from "react";

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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("oko-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const [packageSidebarHidden, setPackageSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem("oko-package-sidebar-hidden") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("oko-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("oko-package-sidebar-hidden", packageSidebarHidden ? "1" : "0");
    } catch {
      // ignore
    }
  }, [packageSidebarHidden]);



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

      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>

        <Link to="/package" className="sidebar-brand" title="ОКО Заполнение">

          <span className="sidebar-brand-mark">ОКО</span>

          <span>Заполнение</span>

        </Link>

        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
          title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
          onClick={() => setSidebarCollapsed((v) => !v)}
        >
          {sidebarCollapsed ? "→" : "←"}
        </button>

        <nav className="sidebar-nav">

          <Link to="/package" title={sidebarCollapsed ? "Комплект" : undefined}>
            Комплект
          </Link>

          {isCoordinator && (
            <Link to="/assignments" title={sidebarCollapsed ? "Назначения" : undefined}>
              Назначения
            </Link>
          )}

          {isAdmin && (
            <Link to="/admin" title={sidebarCollapsed ? "Пользователи" : undefined}>
              Пользователи
            </Link>
          )}

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

          <div className="page-header-left">
            <button
              type="button"
              className="header-menu-btn"
              aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
              title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              Меню
            </button>

            {selectedInstanceId && (
              <button
                type="button"
                className="header-menu-btn"
                aria-label={packageSidebarHidden ? "Показать список форм" : "Скрыть список форм"}
                title={packageSidebarHidden ? "Показать список форм" : "Скрыть список форм"}
                onClick={() => setPackageSidebarHidden((v) => !v)}
              >
                Список
              </button>
            )}

            <div className="page-title">

              <h1>{session.meta.organization}</h1>

              <p className="muted">

                ZID {session.meta.zid} · EID {session.meta.eid} ·{" "}

                {formatPeriod(session.meta.periodStart, session.meta.periodEnd)}

              </p>

            </div>
          </div>

        </header>

        <div className={`workspace${selectedInstanceId ? " workspace-split" : ""}`}>

          {selectedInstanceId && (
            <PackageSidebar
              selectedInstanceId={selectedInstanceId}
              hidden={packageSidebarHidden}
            />
          )}

          <div className="workspace-main">

            <Outlet />

          </div>

        </div>

        <SyncStatusBar />

      </main>

    </div>

  );

}

