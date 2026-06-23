import type { getAuthSnapshot } from "./auth";

type AuthState = ReturnType<typeof getAuthSnapshot>;

export function defaultAppPath(auth: AuthState): string {
  if (auth.user?.role === "org") return "/my";
  if (auth.user?.role === "admin" || auth.role === "admin") return "/package";
  return "/catalog";
}

export function needsAuthentication(backend: boolean, auth: AuthState): boolean {
  if (!backend) return false;
  if (auth.loginAvailable) return !auth.user;
  if (auth.authRequired) return !auth.role;
  return false;
}
