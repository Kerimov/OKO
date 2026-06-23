const TOKEN_KEY = "oko-api-token";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function getApiBase(): string {
  return API_BASE;
}

export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE && p.startsWith("/api/")) return `${API_BASE}${p}`;
  return p;
}

export function getApiToken(): string | null {
  try {
    const ls = localStorage.getItem(TOKEN_KEY);
    if (ls) return ls;
    const ss = sessionStorage.getItem(TOKEN_KEY);
    // one-time migration (older builds used sessionStorage)
    if (ss) {
      localStorage.setItem(TOKEN_KEY, ss);
      sessionStorage.removeItem(TOKEN_KEY);
      return ss;
    }
    return null;
  } catch {
    return null;
  }
}

export function setApiToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearApiToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function apiHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }
  return headers;
}

export async function apiFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(apiHeaders(init?.headers));
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetchRaw(path, init);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
