import type { AuthSnapshot } from "./auth";

type AuthState = AuthSnapshot;

export function defaultAppPath(_auth: AuthState): string {
  return "/desktop";
}

export function needsAuthentication(backend: boolean, auth: AuthState): boolean {
  if (!backend) return false;
  if (auth.loginAvailable) {
    if (auth.user) return false;
    if (auth.legacyToken) return false;
    return true;
  }
  if (auth.authRequired) return !auth.role;
  return false;
}
