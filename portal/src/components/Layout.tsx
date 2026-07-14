import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { logout } from "../auth";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";
import { roleLabel } from "../uiLabels";

const SIDEBAR_COLLAPSED_KEY = "oko-portal-sidebar-collapsed";
const SIDEBAR_SECTIONS_KEY = "oko-portal-sidebar-sections";

type NavItem = {
  to: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

type NavSection = {
  id: string;
  title?: string;
  items: NavItem[];
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readSectionCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function SidebarLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const active = item.isActive(pathname);
  return (
    <li>
      <Link to={item.to} className={active ? "active" : ""}>
        {item.label}
      </Link>
    </li>
  );
}

function SidebarSection({
  section,
  collapsed,
  onToggle,
}: {
  section: NavSection;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { pathname } = useLocation();
  const hasActive = section.items.some((item) => item.isActive(pathname));

  if (!section.title) {
    return (
      <div className="sidebar-section">
        <ul className="sidebar-nav">
          {section.items.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={`sidebar-section${collapsed ? " is-collapsed" : ""}${hasActive ? " has-active" : ""}`}>
      <button
        type="button"
        className="sidebar-section-toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="sidebar-section-title">{section.title}</span>
        <span className="sidebar-section-chevron" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>
      {!collapsed && (
        <ul className="sidebar-nav">
          {section.items.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Layout() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const adminNav =
    isBackendMode() && (!auth.authRequired || auth.role === "admin");
  const orgUser = auth.user?.role === "org";
  const user = auth.user;
  const formsNavLabel = formsListNavLabel(auth);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  const [sectionCollapsed, setSectionCollapsed] = useState(readSectionCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sectionCollapsed));
    } catch {
      /* ignore */
    }
  }, [sectionCollapsed]);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const sections: NavSection[] = useMemo(() => {
    const list: NavSection[] = [
      {
        id: "work",
        title: "Работа",
        items: [
          { to: "/catalog", label: "Каталог", isActive: (p) => p === "/catalog" },
          { to: "/my", label: formsNavLabel, isActive: (p) => p.startsWith("/my") },
          { to: "/package", label: "Комплект", isActive: (p) => p === "/package" },
        ],
      },
    ];

    if (!orgUser) {
      list.push({
        id: "ops",
        title: "Операции",
        items: [
          { to: "/tools", label: "Сводка и импорт", isActive: (p) => p === "/tools" },
        ],
      });
    }

    if (adminNav) {
      list.push({
        id: "editors",
        title: "Редакторы",
        items: [
          { to: "/admin/forms", label: "Формы", isActive: (p) => p === "/admin/forms" },
          {
            to: "/admin/checks",
            label: "Увязки",
            isActive: (p) => p.startsWith("/admin/checks"),
          },
          { to: "/admin/saldo", label: "Сальдо", isActive: (p) => p === "/admin/saldo" },
          { to: "/admin/excel", label: "Маппинг Excel", isActive: (p) => p === "/admin/excel" },
          { to: "/admin/rash", label: "Расшифровки", isActive: (p) => p === "/admin/rash" },
          { to: "/admin/refs", label: "Справочники", isActive: (p) => p.startsWith("/admin/refs") || p === "/admin/kontr" },
          {
            to: "/admin/aggregation",
            label: "Агрегация",
            isActive: (p) => p === "/admin/aggregation",
          },
        ],
      });
      list.push({
        id: "admin",
        title: "Администрирование",
        items: [
          {
            to: "/admin/packages",
            label: "Комплекты",
            isActive: (p) => p === "/admin/packages",
          },
          { to: "/admin/users", label: "Пользователи", isActive: (p) => p === "/admin/users" },
          { to: "/admin/audit", label: "Аудит", isActive: (p) => p === "/admin/audit" },
        ],
      });
    }

    list.push({
      id: "misc",
      items: [
        { to: "/instructions", label: "Инструкция", isActive: (p) => p === "/instructions" },
        { to: "/settings", label: "Настройки", isActive: (p) => p === "/settings" },
      ],
    });

    return list;
  }, [adminNav, formsNavLabel, orgUser]);

  // Keep the section with the current page open.
  useEffect(() => {
    const active = sections.find((s) => s.items.some((item) => item.isActive(pathname)));
    if (!active?.id) return;
    setSectionCollapsed((prev) => {
      if (!prev[active.id]) return prev;
      const next = { ...prev };
      delete next[active.id];
      return next;
    });
  }, [pathname, sections]);

  const toggleSection = (id: string) => {
    setSectionCollapsed((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className={`app${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}>
      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-top">
          <Link to="/catalog" className="sidebar-brand" title="ОКО Портал">
            <span className="sidebar-brand-mark">ОКО</span>
            <span className="sidebar-brand-text">
              <span className="sidebar-brand-title">Портал</span>
              <span className="sidebar-brand-sub">Корп. отчётность</span>
            </span>
          </Link>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label="Свернуть меню"
            title="Свернуть меню"
            onClick={() => setSidebarCollapsed(true)}
          >
            ←
          </button>
        </div>

        <nav className="sidebar-menu">
          {sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              collapsed={!!sectionCollapsed[section.id]}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          {isBackendMode() && auth.authRequired && !auth.role && (
            <Link to="/" className="sidebar-login">
              Войти
            </Link>
          )}
          {isBackendMode() && auth.legacyToken && (
            <div className="sidebar-auth-note">
              Подключено по токену · {roleLabel(auth.role)}
            </div>
          )}
          {user && (
            <div className="sidebar-user" title={user.username}>
              <span className="sidebar-user-name">{user.displayName || user.username}</span>
              {user.organizationName && (
                <span className="sidebar-user-org">{user.organizationName}</span>
              )}
            </div>
          )}
          {isBackendMode() && auth.role && auth.loginAvailable && (
            <button type="button" className="sidebar-logout" onClick={handleLogout}>
              Выйти
            </button>
          )}
        </div>
      </aside>

      <div className="app-main">
        {sidebarCollapsed && (
          <div className="sidebar-reopen-bar">
            <button
              type="button"
              className="header-menu-btn"
              aria-label="Развернуть меню"
              title="Развернуть меню"
              onClick={() => setSidebarCollapsed(false)}
            >
              Меню
            </button>
          </div>
        )}
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">Формы корпоративной отчётности · 76 форм</footer>
      </div>
    </div>
  );
}
