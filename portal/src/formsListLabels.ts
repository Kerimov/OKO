import type { AuthSnapshot } from "./auth";
import { isOfflineKitMode } from "./offlineMode";

export function isOrgFormsUser(auth: AuthSnapshot): boolean {
  return auth.user?.role === "org";
}

/** Администратор ЦО: видит все формы, не «мои». */
export function isAdminFormsView(auth: AuthSnapshot): boolean {
  if (isOfflineKitMode()) return false;
  if (isOrgFormsUser(auth)) return false;
  return !auth.authRequired || auth.role === "admin";
}

export function formsListNavLabel(auth: AuthSnapshot): string {
  return isAdminFormsView(auth) ? "Формы" : "Мои формы";
}

export function formsListTitle(auth: AuthSnapshot): string {
  return isAdminFormsView(auth) ? "Формы отчётности" : "Мои формы ОКО";
}

export function formsListBackLabel(auth: AuthSnapshot): string {
  return isAdminFormsView(auth) ? "← Формы" : "← Мои формы ОКО";
}

function numId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function instanceMatchesPackage(
  inst: { zid?: number | null; eid?: number | null },
  zid: number | "",
  eid: number | ""
): boolean {
  if (zid !== "" && numId(inst.zid) !== zid) return false;
  if (eid !== "" && numId(inst.eid) !== eid) return false;
  return true;
}
