/**
 * PSD role model and permission matrix (server-side source of truth).
 * Legacy users.role admin|org is preserved; psd_role is the process role.
 */

export type LegacyUserRole = "admin" | "org";

export type PsdRole =
  | "business_process_manager"
  | "department_curator"
  | "subsidiary_specialist"
  | "support_specialist"
  | "auditor_readonly";

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
  | "audit.read_only";

export const PSD_ROLES: readonly PsdRole[] = [
  "business_process_manager",
  "department_curator",
  "subsidiary_specialist",
  "support_specialist",
  "auditor_readonly",
] as const;

const ROLE_PERMISSIONS: Record<PsdRole, readonly PsdPermission[]> = {
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
  ],
  auditor_readonly: ["bp.view", "forms.read", "nsi.read", "audit.read_only"],
};

export function isPsdRole(value: unknown): value is PsdRole {
  return typeof value === "string" && (PSD_ROLES as readonly string[]).includes(value);
}

/** Map legacy role → default PSD role (migration / fallback). */
export function legacyToPsdRole(legacy: LegacyUserRole | string | null | undefined): PsdRole {
  if (legacy === "admin") return "support_specialist";
  return "subsidiary_specialist";
}

export function resolvePsdRole(input: {
  legacyRole?: LegacyUserRole | string | null;
  psdRole?: string | null;
}): PsdRole {
  if (isPsdRole(input.psdRole)) return input.psdRole;
  return legacyToPsdRole(input.legacyRole);
}

export function permissionsFor(role: PsdRole): ReadonlySet<PsdPermission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function hasPermission(role: PsdRole, permission: PsdPermission): boolean {
  return permissionsFor(role).has(permission);
}

export function assertPermission(role: PsdRole, permission: PsdPermission): void {
  if (!hasPermission(role, permission)) {
    const err = new Error(`Permission denied: ${permission}`);
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function isReadOnlyPsdRole(role: PsdRole): boolean {
  return role === "auditor_readonly";
}

/** API role (admin|user) derived from legacy + PSD for existing guards. */
export function apiRoleFromAccounts(legacyRole: LegacyUserRole, psdRole: PsdRole): "admin" | "user" {
  if (legacyRole === "admin" || psdRole === "support_specialist" || psdRole === "business_process_manager") {
    return "admin";
  }
  return "user";
}

export const PSD_ROLE_LABELS_RU: Record<PsdRole, string> = {
  business_process_manager: "Руководитель БП",
  department_curator: "Куратор подразделения",
  subsidiary_specialist: "Специалист ДО",
  support_specialist: "Сопровождение",
  auditor_readonly: "Аудитор (только чтение)",
};

export const PSD_ROLE_LABELS_EN: Record<PsdRole, string> = {
  business_process_manager: "Business process manager",
  department_curator: "Department curator",
  subsidiary_specialist: "Subsidiary specialist",
  support_specialist: "Support specialist",
  auditor_readonly: "Auditor (read-only)",
};
