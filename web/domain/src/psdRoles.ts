/**
 * PSD / RBAC permission catalog and role-code helpers.
 * Role→permission matrix for system roles is seeded into DB (see rbac.ts + migration 014).
 * Runtime checks use the DB-backed cache via rbac when loaded; otherwise fall back to SYSTEM_ROLE_PERMISSIONS.
 */

export type LegacyUserRole = "admin" | "org";

/** Built-in role codes (also used as seed). Custom roles use free-form codes. */
export type SystemPsdRole =
  | "business_process_manager"
  | "department_curator"
  | "subsidiary_specialist"
  | "support_specialist"
  | "auditor_readonly";

/** @deprecated Prefer RoleCode; kept as alias for system + custom codes. */
export type PsdRole = SystemPsdRole | string;

export type RoleCode = string;

export type PsdPermission =
  | "bp.view"
  | "bp.start"
  | "bp.assign_curator"
  | "bp.submit_for_approval"
  | "bp.curator_approve"
  | "bp.curator_return"
  | "bp.complete"
  | "bp.reopen"
  | "forms.read"
  | "forms.write"
  | "nsi.read"
  | "nsi.write"
  | "approval.explain"
  | "tech.configure"
  | "reports.build"
  | "audit.read_only"
  | "roles.manage"
  | "users.manage";

export const PSD_PERMISSIONS: readonly PsdPermission[] = [
  "bp.view",
  "bp.start",
  "bp.assign_curator",
  "bp.submit_for_approval",
  "bp.curator_approve",
  "bp.curator_return",
  "bp.complete",
  "bp.reopen",
  "forms.read",
  "forms.write",
  "nsi.read",
  "nsi.write",
  "approval.explain",
  "tech.configure",
  "reports.build",
  "audit.read_only",
  "roles.manage",
  "users.manage",
] as const;

export type PermissionGroup = "bp" | "forms" | "nsi" | "approval" | "tech" | "reports" | "audit" | "admin";

export interface PermissionCatalogEntry {
  code: PsdPermission;
  group: PermissionGroup;
  labelRu: string;
  labelEn: string;
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  { code: "bp.view", group: "bp", labelRu: "Просмотр БП", labelEn: "View BP" },
  { code: "bp.start", group: "bp", labelRu: "Запуск БП", labelEn: "Start BP" },
  { code: "bp.assign_curator", group: "bp", labelRu: "Назначить куратора", labelEn: "Assign curator" },
  { code: "bp.submit_for_approval", group: "bp", labelRu: "На согласование", labelEn: "Submit for approval" },
  { code: "bp.curator_approve", group: "bp", labelRu: "Согласовать", labelEn: "Curator approve" },
  { code: "bp.curator_return", group: "bp", labelRu: "Вернуть на доработку", labelEn: "Curator return" },
  { code: "bp.complete", group: "bp", labelRu: "Завершить БП", labelEn: "Complete BP" },
  { code: "bp.reopen", group: "bp", labelRu: "Открыть БП снова", labelEn: "Reopen BP" },
  { code: "forms.read", group: "forms", labelRu: "Чтение форм", labelEn: "Read forms" },
  { code: "forms.write", group: "forms", labelRu: "Запись форм", labelEn: "Write forms" },
  { code: "nsi.read", group: "nsi", labelRu: "Чтение НСИ", labelEn: "Read NSI" },
  { code: "nsi.write", group: "nsi", labelRu: "Запись НСИ", labelEn: "Write NSI" },
  { code: "approval.explain", group: "approval", labelRu: "Пояснения к проверкам", labelEn: "Check explanations" },
  { code: "tech.configure", group: "tech", labelRu: "Технастройки / методология", labelEn: "Tech configure" },
  { code: "reports.build", group: "reports", labelRu: "Отчёты", labelEn: "Build reports" },
  { code: "audit.read_only", group: "audit", labelRu: "Журнал аудита", labelEn: "Audit log" },
  { code: "roles.manage", group: "admin", labelRu: "Управление ролями", labelEn: "Manage roles" },
  { code: "users.manage", group: "admin", labelRu: "Управление пользователями", labelEn: "Manage users" },
];

export const PSD_ROLES: readonly SystemPsdRole[] = [
  "business_process_manager",
  "department_curator",
  "subsidiary_specialist",
  "support_specialist",
  "auditor_readonly",
] as const;

/** Default matrix for system roles (seed + fallback before cache load). */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemPsdRole, readonly PsdPermission[]> = {
  business_process_manager: [
    "bp.view",
    "bp.start",
    "bp.assign_curator",
    "bp.complete",
    "bp.reopen",
    "forms.read",
    "nsi.read",
    "tech.configure",
    "reports.build",
  ],
  department_curator: [
    "bp.view",
    "bp.curator_approve",
    "bp.curator_return",
    "forms.read",
    "nsi.read",
    "approval.explain",
  ],
  subsidiary_specialist: [
    "bp.view",
    "bp.submit_for_approval",
    "forms.read",
    "forms.write",
    "nsi.read",
    "nsi.write",
    "approval.explain",
  ],
  support_specialist: [
    "bp.view",
    "bp.start",
    "bp.assign_curator",
    "bp.submit_for_approval",
    "bp.curator_approve",
    "bp.curator_return",
    "bp.complete",
    "bp.reopen",
    "forms.read",
    "forms.write",
    "nsi.read",
    "nsi.write",
    "approval.explain",
    "tech.configure",
    "reports.build",
    "roles.manage",
    "users.manage",
  ],
  auditor_readonly: ["bp.view", "forms.read", "nsi.read", "audit.read_only"],
};

export const PSD_ROLE_LABELS_RU: Record<SystemPsdRole, string> = {
  business_process_manager: "Руководитель БП",
  department_curator: "Куратор подразделения",
  subsidiary_specialist: "Специалист ДО",
  support_specialist: "Сопровождение",
  auditor_readonly: "Аудитор (только чтение)",
};

export const PSD_ROLE_LABELS_EN: Record<SystemPsdRole, string> = {
  business_process_manager: "Business process manager",
  department_curator: "Department curator",
  subsidiary_specialist: "Subsidiary specialist",
  support_specialist: "Support specialist",
  auditor_readonly: "Auditor (read-only)",
};

export function isPsdPermission(value: unknown): value is PsdPermission {
  return typeof value === "string" && (PSD_PERMISSIONS as readonly string[]).includes(value);
}

export function isSystemPsdRole(value: unknown): value is SystemPsdRole {
  return typeof value === "string" && (PSD_ROLES as readonly string[]).includes(value);
}

/** @deprecated Use isSystemPsdRole; custom roles are free-form codes. */
export function isPsdRole(value: unknown): value is SystemPsdRole {
  return isSystemPsdRole(value);
}

export function legacyToPsdRole(legacy: LegacyUserRole | string | null | undefined): SystemPsdRole {
  if (legacy === "admin") return "support_specialist";
  return "subsidiary_specialist";
}

export function resolvePsdRole(input: {
  legacyRole?: LegacyUserRole | string | null;
  psdRole?: string | null;
}): RoleCode {
  if (typeof input.psdRole === "string" && input.psdRole.trim()) {
    return input.psdRole.trim();
  }
  return legacyToPsdRole(input.legacyRole);
}

/** Sync permission lookup — uses rbac cache when loaded. */
let cacheGetter: ((role: RoleCode) => ReadonlySet<PsdPermission> | null) | null = null;

export function setPermissionCacheGetter(
  fn: ((role: RoleCode) => ReadonlySet<PsdPermission> | null) | null
): void {
  cacheGetter = fn;
}

export function permissionsFor(role: RoleCode): ReadonlySet<PsdPermission> {
  const fromCache = cacheGetter?.(role);
  if (fromCache) return fromCache;
  if (isSystemPsdRole(role)) return new Set(SYSTEM_ROLE_PERMISSIONS[role]);
  return new Set();
}

export function hasPermission(role: RoleCode, permission: PsdPermission): boolean {
  return permissionsFor(role).has(permission);
}

export function assertPermission(role: RoleCode, permission: PsdPermission): void {
  if (!hasPermission(role, permission)) {
    const err = new Error(`Permission denied: ${permission}`);
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function isReadOnlyPsdRole(role: RoleCode): boolean {
  if (role === "auditor_readonly") return true;
  return isEffectivelyReadOnly(role);
}

/** True when role has no mutating permissions (safe for RejectReadOnlyGuard). */
export function isEffectivelyReadOnly(role: RoleCode): boolean {
  const perms = permissionsFor(role);
  if (perms.size === 0) return true;
  for (const p of perms) {
    if (p === "bp.view" || p === "forms.read" || p === "nsi.read" || p === "audit.read_only") {
      continue;
    }
    return false;
  }
  return true;
}

export function apiRoleFromAccounts(legacyRole: LegacyUserRole, _psdRole: RoleCode): "admin" | "user" {
  void _psdRole;
  if (legacyRole === "admin") return "admin";
  return "user";
}

export function listPermissionsCatalog(): PermissionCatalogEntry[] {
  return [...PERMISSION_CATALOG];
}

export function roleLabelRu(code: RoleCode): string {
  if (isSystemPsdRole(code)) return PSD_ROLE_LABELS_RU[code];
  return code;
}

export function roleLabelEn(code: RoleCode): string {
  if (isSystemPsdRole(code)) return PSD_ROLE_LABELS_EN[code];
  return code;
}
