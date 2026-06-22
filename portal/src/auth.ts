import { apiFetch, clearApiToken, getApiToken, setApiToken } from "./apiClient";

export type ApiRole = "admin" | "user";
export type UserAccountRole = "admin" | "org";

export interface UserProfile {
  id: number;
  username: string;
  displayName: string | null;
  role: UserAccountRole;
  zid: number | null;
  organizationName: string | null;
}

export interface UserDto extends UserProfile {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

let currentRole: ApiRole | null = null;
let currentUser: UserProfile | null = null;
let authRequired = false;
let loginAvailable = false;
let authMode: string = "none";

export function getApiRole(): ApiRole | null {
  return currentRole;
}

export function getCurrentUser(): UserProfile | null {
  return currentUser;
}

export function isAuthRequired(): boolean {
  return authRequired;
}

export function isLoginAvailable(): boolean {
  return loginAvailable;
}

export function isAdminRole(): boolean {
  if (!authRequired) return true;
  return currentRole === "admin";
}

export function isOrgUser(): boolean {
  return currentUser?.role === "org";
}

export async function initAuth(): Promise<void> {
  try {
    const health = await apiFetch<{
      auth?: { authRequired?: boolean; loginAvailable?: boolean; authMode?: string };
    }>("/api/health");
    authRequired = !!health.auth?.authRequired;
    loginAvailable = !!health.auth?.loginAvailable;
    authMode = health.auth?.authMode ?? "none";
  } catch {
    authRequired = false;
    loginAvailable = false;
  }

  if (!getApiToken()) {
    currentRole = authRequired ? null : "admin";
    currentUser = null;
    return;
  }

  try {
    const me = await apiFetch<{
      role: ApiRole | null;
      authRequired: boolean;
      loginAvailable?: boolean;
      authMode?: string;
      user?: UserProfile | null;
    }>("/api/auth/me");
    authRequired = me.authRequired;
    loginAvailable = !!me.loginAvailable;
    authMode = me.authMode ?? authMode;
    currentRole = me.role;
    currentUser = me.user ?? null;
  } catch {
    currentRole = null;
    currentUser = null;
  }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await apiFetch<{
    token: string;
    role: ApiRole;
    user: UserProfile;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setApiToken(res.token);
  currentRole = res.role;
  currentUser = res.user;
  authRequired = true;
  loginAvailable = true;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  clearApiToken();
  currentRole = authRequired ? null : "admin";
  currentUser = null;
}

export function saveApiToken(token: string): void {
  setApiToken(token);
}

export function removeApiToken(): void {
  clearApiToken();
  currentRole = authRequired ? null : "admin";
  currentUser = null;
}

export async function refreshAuthRole(): Promise<ApiRole | null> {
  await initAuth();
  return currentRole;
}

export function getAuthMode(): string {
  return authMode;
}
