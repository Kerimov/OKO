import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  hasPsdPermission,
  isAuditorReadonly,
  logout,
  psdRoleLabelRu,
  resolveUiPsdRole,
} from "../auth";
import { t } from "../i18n";
import { breadcrumbsForPath } from "../breadcrumbs";
import { isBackendMode } from "../storage";
import { useAuth } from "../useAuth";
import { formsListNavLabel } from "../formsListLabels";
import { roleLabel } from "../uiLabels";
import { CommandPalette, type CommandItem } from "./CommandPalette";
import { SidebarIcon, type SidebarIconName } from "./SidebarIcons";
import { StatusBadge } from "./ui";

const SIDEBAR_COLLAPSED_KEY = "oko-portal-sidebar-collapsed";
const SIDEBAR_SECTIONS_KEY = "oko-portal-sidebar-sections";

type NavItem = {
  to: string;
  label: string;
  description?: string;
  icon: SidebarIconName;
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
        <span className="sidebar-nav-icon" aria-hidden>
          <SidebarIcon name={item.icon} />
        </span>
        <span className="sidebar-nav-copy">
          <span className="sidebar-nav-label">{item.label}</span>
        </span>
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
  const techNav = isBackendMode() && (!auth.authRequired || hasPsdPermission("tech.configure"));
  const nsiNav = isBackendMode() && (!auth.authRequired || hasPsdPermission("nsi.read"));
  const reportsNav = isBackendMode() && (!auth.authRequired || hasPsdPermission("reports.build"));
  const auditNav = isBackendMode() && (!auth.authRequired || hasPsdPermission("audit.read_only") || hasPsdPermission("tech.configure"));
  const orgUser = auth.user?.role === "org";
  const user = auth.user;
  const psdRole = resolveUiPsdRole(user);
  const formsNavLabel = formsListNavLabel(auth);
  const auditorRo = isAuditorReadonly();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  const [sectionCollapsed, setSectionCollapsed] = useState(readSectionCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          {
            to: "/catalog",
            label: "Каталог",
            description: "Шаблоны и создание форм",
            icon: "catalog",
            isActive: (p) => p === "/catalog",
          },
          {
            to: "/my",
            label: formsNavLabel,
            description: "Заполнение и сдача",
            icon: "forms",
            isActive: (p) => p.startsWith("/my"),
          },
          {
            to: "/package",
            label: "Комплекты",
            description: "Периоды, БП и контроль",
            icon: "packages",
            isActive: (p) => p === "/package" || p === "/admin/packages",
          },
          ...(isBackendMode()
            ? [
                {
                  to: "/bp",
                  label: t("nav.bpMonitor"),
                  description: "Согласование комплектов",
                  icon: "bp" as const,
                  isActive: (p: string) => p === "/bp",
                },
              ]
            : []),
        ],
      },
    ];

    if (!orgUser || techNav) {
      list.push({
        id: "ops",
        title: "Операции",
        items: [
          {
            to: "/tools",
            label: "Обмен",
            description: "Загрузка, выгрузка, сверка",
            icon: "exchange",
            isActive: (p) => p === "/tools",
          },
        ],
      });
    }

    if (techNav) {
      list.push({
        id: "editors",
        title: "Редакторы",
        items: [
          {
            to: "/admin/forms",
            label: "Формы",
            description: "Структура шаблонов",
            icon: "templates",
            isActive: (p) => p === "/admin/forms",
          },
          {
            to: "/admin/checks",
            label: "Увязки",
            description: "Контрольные правила",
            icon: "checks",
            isActive: (p) => p.startsWith("/admin/checks"),
          },
          {
            to: "/admin/saldo",
            label: "Сальдо",
            description: "Начальные остатки",
            icon: "saldo",
            isActive: (p) => p === "/admin/saldo",
          },
          {
            to: "/admin/excel",
            label: "Excel",
            description: "Импорт и экспорт",
            icon: "excel",
            isActive: (p) => p === "/admin/excel",
          },
          {
            to: "/admin/rash",
            label: "Расшифровки",
            description: "Контрагенты и детализация",
            icon: "rash",
            isActive: (p) => p === "/admin/rash",
          },
          {
            to: "/admin/aggregation",
            label: "Агрегация",
            description: "Сборные отчёты",
            icon: "aggregation",
            isActive: (p) => p === "/admin/aggregation",
          },
        ],
      });
    }

    if (nsiNav || techNav || reportsNav || auditNav) {
      const adminItems: NavItem[] = [];
      if (techNav) {
        adminItems.push(
          {
            to: "/admin/users",
            label: "Пользователи",
            description: "Роли и доступ",
            icon: "users",
            isActive: (p) => p === "/admin/users",
          }
        );
      }
      if (auditNav) {
        adminItems.push({
          to: "/admin/audit",
          label: "Аудит",
          description: "Журнал действий",
          icon: "audit",
          isActive: (p) => p === "/admin/audit",
        });
      }
      if (nsiNav) {
        adminItems.push(
          {
            to: "/admin/refs",
            label: "Справочники",
            description: "НСИ и контрагенты",
            icon: "refs",
            isActive: (p) => p.startsWith("/admin/refs") || p === "/admin/kontr",
          },
          {
            to: "/perimeter",
            label: t("nav.perimeter"),
            description: "Периметр организаций",
            icon: "perimeter",
            isActive: (p) => p === "/perimeter",
          },
          {
            to: "/collection-units",
            label: "Единицы сбора",
            description: "Участники отчётности",
            icon: "units",
            isActive: (p) => p === "/collection-units",
          }
        );
      }
      if (techNav) {
        adminItems.push({
          to: "/integrations",
          label: t("nav.integrations"),
          description: "Подключения и сервисы",
          icon: "integrations",
          isActive: (p) => p === "/integrations",
        });
      }
      if (reportsNav) {
        adminItems.push({
          to: "/psd-reports",
          label: t("nav.psdReports"),
          description: "Отчёты ПСД",
          icon: "reports",
          isActive: (p) => p === "/psd-reports",
        });
      }
      adminItems.push({
        to: "/check-explanations",
        label: "Объяснения проверок",
        description: "Работа с блокерами",
        icon: "explanations",
        isActive: (p) => p === "/check-explanations",
      });
      list.push({
        id: "admin",
        title: "Администрирование",
        items: adminItems,
      });
    } else if (!isBackendMode()) {
      list.push({
        id: "editors-offline",
        title: "Редакторы",
        items: [
          {
            to: "/admin/refs",
            label: "Справочники (local)",
            description: "Локальные данные",
            icon: "refs",
            isActive: (p) => p.startsWith("/admin/refs") || p === "/admin/kontr",
          },
        ],
      });
    }

    list.push({
      id: "misc",
      items: [
        {
          to: "/instructions",
          label: "Инструкция",
          description: "Как работать в системе",
          icon: "help",
          isActive: (p) => p === "/instructions",
        },
        {
          to: "/settings",
          label: "Настройки",
          description: "Режимы и параметры",
          icon: "settings",
          isActive: (p) => p === "/settings",
        },
      ],
    });

    return list;
  }, [techNav, nsiNav, reportsNav, auditNav, formsNavLabel, orgUser]);

  const commandItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];
    for (const section of sections) {
      for (const item of section.items) {
        items.push({
          id: item.to,
          label: item.label,
          hint: section.title,
          to: item.to,
        });
      }
    }
    return items;
  }, [sections]);

  const crumbs = useMemo(
    () => breadcrumbsForPath(pathname, formsNavLabel),
    [pathname, formsNavLabel]
  );
  const currentItem = useMemo(() => {
    for (const section of sections) {
      const item = section.items.find((candidate) => candidate.isActive(pathname));
      if (item) return { ...item, sectionTitle: section.title };
    }
    return null;
  }, [pathname, sections]);

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
          <Link to="/catalog" className="sidebar-brand" title="ОКО — портал отчётности">
            <span className="sidebar-brand-mark">ОКО</span>
            <span className="sidebar-brand-text">
              <span className="sidebar-brand-title">Портал отчётности</span>
              <span className="sidebar-brand-sub">ПСД-контроль</span>
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

        {isBackendMode() && auth.legacyToken && (
          <div className="sidebar-footer">
            <div className="sidebar-auth-note">
              Подключено по токену · {roleLabel(auth.role)}
            </div>
          </div>
        )}
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="app-header-left">
            {sidebarCollapsed && (
              <button
                type="button"
                className="header-menu-btn"
                aria-label="Развернуть меню"
                title="Развернуть меню"
                onClick={() => setSidebarCollapsed(false)}
              >
                Меню
              </button>
            )}
            <nav className="breadcrumbs" aria-label="Навигация">
              {crumbs.map((crumb, idx) => {
                const last = idx === crumbs.length - 1;
                return (
                  <span key={`${crumb.label}-${idx}`} className="breadcrumb-item">
                    {idx > 0 && <span className="breadcrumb-sep" aria-hidden>/</span>}
                    {crumb.to && !last ? (
                      <Link to={crumb.to}>{crumb.label}</Link>
                    ) : (
                      <span className={last ? "breadcrumb-current" : undefined}>
                        {crumb.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </nav>
            <div className="app-header-context">
              <span className="app-header-context-kicker">
                {currentItem?.sectionTitle ?? "Раздел"}
              </span>
              <span className="app-header-context-title">
                {currentItem?.label ?? crumbs[crumbs.length - 1]?.label ?? "ОКО"}
              </span>
              {currentItem?.description ? (
                <span className="app-header-context-desc">{currentItem.description}</span>
              ) : null}
            </div>
          </div>
          <div className="app-header-right">
            <button
              type="button"
              className="header-search-btn"
              onClick={() => setPaletteOpen(true)}
              title="Быстрый переход (Ctrl+K)"
            >
              <span className="header-search-label">Поиск</span>
              <kbd className="header-search-kbd">Ctrl+K</kbd>
            </button>
            {isBackendMode() && auth.authRequired && !auth.role && (
              <Link to="/" className="app-header-login">
                Войти
              </Link>
            )}
            {user && (
              <div className="app-header-user" title={user.username}>
                <span className="app-header-avatar" aria-hidden>
                  {(user.displayName || user.username || "О")
                    .trim()
                    .charAt(0)
                    .toUpperCase()}
                </span>
                <span className="app-header-user-meta">
                  <span className="app-header-user-name">
                    {user.displayName || user.username}
                  </span>
                  <span className="header-user-chips">
                    {isBackendMode() && (
                      <span className="role-chip role-chip--psd" title="Роль ПСД">
                        {psdRoleLabelRu(psdRole)}
                      </span>
                    )}
                    {auditorRo && (
                      <StatusBadge
                        tone="warning"
                        label={t("badge.readonly")}
                        title="Аудитор: мутации недоступны"
                      />
                    )}
                  </span>
                  {user.organizationName && (
                    <span className="app-header-user-org">{user.organizationName}</span>
                  )}
                </span>
              </div>
            )}
            {isBackendMode() && auth.role && auth.loginAvailable && (
              <button type="button" className="btn btn-ghost btn-sm app-header-logout" onClick={handleLogout}>
                Выйти
              </button>
            )}
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">
          <span>ОКО · корпоративная отчётность</span>
          <span>Единая витрина комплектов, проверок и обмена</span>
        </footer>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={commandItems}
      />
    </div>
  );
}
