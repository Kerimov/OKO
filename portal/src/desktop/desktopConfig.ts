import type { PortalPsdPermission, PsdRole } from "../auth";
import { hasPsdPermission } from "../auth";
import { isBackendMode } from "../storage";

export type DesktopWidgetId =
  | "myForms"
  | "packageCompleteness"
  | "bpQueue"
  | "packagesSummary"
  | "integrations"
  | "packagesReadOnly";

export type DesktopKpiId =
  | "drafts"
  | "submitted"
  | "completenessPct"
  | "pendingApproval"
  | "withBlockers"
  | "perimeterPct"
  | "packagesCount"
  | "avgPct"
  | "openBp"
  | "integrationsOk"
  | "aggIncluded";

export type DesktopQuickAction = {
  to: string;
  label: string;
  /** Require this PSD permission when auth is on. */
  permission?: PortalPsdPermission;
  backendOnly?: boolean;
  /** Hide for auditor_readonly. */
  mutateOnly?: boolean;
};

export type DesktopRoleConfig = {
  kpis: DesktopKpiId[];
  widgets: DesktopWidgetId[];
  actions: DesktopQuickAction[];
};

const CONFIG: Record<PsdRole, DesktopRoleConfig> = {
  subsidiary_specialist: {
    kpis: ["drafts", "submitted", "completenessPct"],
    widgets: ["myForms", "packageCompleteness"],
    actions: [
      { to: "/my", label: "Мои формы" },
      { to: "/package", label: "Комплект" },
      { to: "/catalog", label: "Каталог" },
      { to: "/bp", label: "Бизнес-процесс", backendOnly: true, permission: "bp.view" },
    ],
  },
  department_curator: {
    kpis: ["pendingApproval", "withBlockers", "perimeterPct"],
    widgets: ["bpQueue", "packagesSummary"],
    actions: [
      { to: "/bp", label: "Мониторинг БП", backendOnly: true, permission: "bp.view" },
      { to: "/package", label: "Комплекты" },
      {
        to: "/check-explanations",
        label: "Пояснения",
        backendOnly: true,
        permission: "approval.explain",
      },
      { to: "/admin/refs", label: "Справочники", backendOnly: true, permission: "nsi.read" },
    ],
  },
  business_process_manager: {
    kpis: ["packagesCount", "avgPct", "openBp"],
    widgets: ["packagesSummary", "bpQueue"],
    actions: [
      { to: "/package", label: "Комплекты" },
      { to: "/bp", label: "Мониторинг БП", backendOnly: true, permission: "bp.view" },
      {
        to: "/psd-reports",
        label: "Отчёты ПСД",
        backendOnly: true,
        permission: "reports.build",
      },
      {
        to: "/admin/forms",
        label: "Шаблоны форм",
        backendOnly: true,
        permission: "tech.configure",
      },
      {
        to: "/admin/checks",
        label: "Увязки",
        backendOnly: true,
        permission: "tech.configure",
      },
    ],
  },
  support_specialist: {
    kpis: ["packagesCount", "avgPct", "openBp", "integrationsOk"],
    widgets: ["packagesSummary", "integrations", "bpQueue"],
    actions: [
      { to: "/package", label: "Комплекты" },
      { to: "/admin/users", label: "Пользователи", backendOnly: true, permission: "tech.configure" },
      {
        to: "/admin/forms",
        label: "Редакторы",
        backendOnly: true,
        permission: "tech.configure",
      },
      {
        to: "/integrations",
        label: "Интеграции",
        backendOnly: true,
        permission: "tech.configure",
      },
      {
        to: "/admin/audit",
        label: "Аудит",
        backendOnly: true,
        permission: "tech.configure",
      },
      {
        to: "/admin/aggregation",
        label: "Агрегация",
        backendOnly: true,
        permission: "tech.configure",
      },
    ],
  },
  auditor_readonly: {
    kpis: ["packagesCount", "submitted", "openBp"],
    widgets: ["packagesReadOnly", "bpQueue"],
    actions: [
      { to: "/package", label: "Комплекты" },
      { to: "/bp", label: "Мониторинг БП", backendOnly: true, permission: "bp.view" },
      {
        to: "/admin/audit",
        label: "Аудит",
        backendOnly: true,
        permission: "audit.read_only",
      },
      { to: "/admin/refs", label: "Справочники", backendOnly: true, permission: "nsi.read" },
    ],
  },
};

const OFFLINE_CONFIG: DesktopRoleConfig = {
  kpis: ["drafts", "submitted"],
  widgets: ["myForms"],
  actions: [
    { to: "/my", label: "Мои формы" },
    { to: "/catalog", label: "Каталог" },
    { to: "/package", label: "Комплекты" },
  ],
};

export function getDesktopConfig(role: PsdRole): DesktopRoleConfig {
  if (!isBackendMode()) return OFFLINE_CONFIG;
  return CONFIG[role];
}

export function filterDesktopActions(
  actions: DesktopQuickAction[],
  opts: { auditorReadonly: boolean }
): DesktopQuickAction[] {
  return actions.filter((a) => {
    if (a.backendOnly && !isBackendMode()) return false;
    if (a.mutateOnly && opts.auditorReadonly) return false;
    if (a.permission && !hasPsdPermission(a.permission)) return false;
    return true;
  });
}
