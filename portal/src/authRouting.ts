import type { AuthSnapshot } from "./auth";
import { isOfflineKitMode } from "./offlineMode";

type AuthState = AuthSnapshot;

export function defaultAppPath(auth: AuthState): string {
  if (isOfflineKitMode()) return "/my";
  if (auth.user?.role === "org") return "/my";
  if (auth.user?.role === "admin" || auth.role === "admin") return "/package";
  return "/catalog";
}

export function needsAuthentication(backend: boolean, auth: AuthState): boolean {
  if (isOfflineKitMode()) return false;
  if (!backend) return false;
  if (auth.loginAvailable) {
    if (auth.user) return false;
    if (auth.legacyToken) return false;
    return true;
  }
  if (auth.authRequired) return !auth.role;
  return false;
}
