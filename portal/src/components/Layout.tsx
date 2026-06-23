import { Link, Outlet, useLocation } from "react-router-dom";
import {
  logout,
} from "../auth";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";
import { isOfflineKitMode } from "../offlineMode";

type NavItem = {
  to: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

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

function SidebarSection({ section }: { section: NavSection }) {
  return (
    <div className="sidebar-section">
      {section.title && <div className="sidebar-section-title">{section.title}</div>}
      <ul className="sidebar-nav">
        {section.items.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </ul>
    </div>
  );
}

export function Layout() {
  const auth = useAuth();
  const offlineKit = isOfflineKitMode();
  const adminNav =
    !offlineKit && isBackendMode() && (!auth.authRequired || auth.role === "admin");
  const orgUser = auth.user?.role === "org";
  const user = auth.user;

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const workSection: NavSection = {
    title: "Работа",
    items: offlineKit
      ? [
          { to: "/my", label: "Мои формы", isActive: (p) => p.startsWith("/my") },
          { to: "/catalog", label: "Каталог", isActive: (p) => p === "/catalog" },
          { to: "/export", label: "Отправить в ЦО", isActive: (p) => p === "/export" },
        ]
      : [
          { to: "/catalog", label: "Каталог", isActive: (p) => p === "/catalog" },
          { to: "/my", label: "Мои формы", isActive: (p) => p.startsWith("/my") },
          { to: "/package", label: "Комплект", isActive: (p) => p === "/package" },
        ],
  };

  const sections: NavSection[] = [workSection];

  if (!offlineKit && !orgUser) {
    sections.push({
      title: "Операции",
      items: [
        { to: "/tools", label: "Сводка и импорт", isActive: (p) => p === "/tools" },
      ],
    });
  }

  if (adminNav) {
    sections.push({
      title: "Редакторы",
      items: [
        { to: "/admin/forms", label: "Формы", isActive: (p) => p === "/admin/forms" },
        {
          to: "/admin/checks",
          label: "Увязки",
          isActive: (p) => p.startsWith("/admin/checks"),
        },
        { to: "/admin/saldo", label: "Сальдо", isActive: (p) => p === "/admin/saldo" },
        { to: "/admin/excel", label: "Excel", isActive: (p) => p === "/admin/excel" },
        { to: "/admin/rash", label: "Расшифровки", isActive: (p) => p === "/admin/rash" },
        {
          to: "/admin/aggregation",
          label: "Агрегация",
          isActive: (p) => p === "/admin/aggregation",
        },
      ],
    });
    sections.push({
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

  if (!offlineKit) {
    sections.push({
      items: [
        { to: "/instructions", label: "Инструкция", isActive: (p) => p === "/instructions" },
        { to: "/settings", label: "Настройки", isActive: (p) => p === "/settings" },
      ],
    });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to={offlineKit ? "/my" : "/catalog"} className="sidebar-brand">
          <span className="sidebar-brand-mark">ОКО</span>
          <span className="sidebar-brand-text">
            <span className="sidebar-brand-title">Портал</span>
            <span className="sidebar-brand-sub">Корп. отчётность</span>
          </span>
        </Link>

        <nav className="sidebar-menu">
          {sections.map((section, i) => (
            <SidebarSection key={section.title ?? `section-${i}`} section={section} />
          ))}
        </nav>

        <div className="sidebar-footer">
          {offlineKit && (
            <div className="sidebar-auth-note">Офлайн · без связи с ЦО</div>
          )}
          {isBackendMode() && auth.authRequired && !auth.role && (
            <Link to="/" className="sidebar-login">
              Войти
            </Link>
          )}
          {isBackendMode() && auth.legacyToken && (
            <div className="sidebar-auth-note">
              Подключено по токену · роль {auth.role}
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
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">Формы корпоративной отчётности · 76 форм</footer>
      </div>
    </div>
  );
}
