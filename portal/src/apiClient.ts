const TOKEN_KEY = "oko-api-token";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

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
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    throw new ApiError(res.status, parsed, formatApiError(res.status, text) || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function formatApiError(status: number, body: string): string {
  try {
    const data = JSON.parse(body) as {
      error?: string;
      authRequired?: boolean;
      message?: string | string[];
      result?: { failed?: number; skipped?: number };
    };
    if (status === 401 && data.authRequired) {
      return "Требуется вход в систему. Откройте главную страницу (/) и войдите под учётной записью администратора.";
    }
    if (status === 422 && (data.error === "checks_failed" || (data as { message?: { error?: string } }).message?.error === "checks_failed")) {
      const nested = (data as { message?: { result?: { failed?: number; skipped?: number } } }).message?.result;
      const result = data.result ?? nested;
      const failed = result?.failed ?? 0;
      const skipped = result?.skipped ?? 0;
      return `Сдача отклонена: не пройдены проверки увязки (ошибок: ${failed}, не разобрано: ${skipped}).`;
    }
    if (typeof data.message === "string") return data.message;
    if (Array.isArray(data.message)) return data.message.join("; ");
    return data.error ?? body;
  } catch {
    return body;
  }
}
