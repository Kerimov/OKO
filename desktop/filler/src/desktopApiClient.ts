/**
 * Замена portal/apiClient.ts в десктопе: статика через IPC (fetch file:// не работает).
 */
export function getApiBase(): string {
  return "";
}

export function apiUrl(path: string): string {
  return path;
}

export function getApiToken(): string | null {
  return null;
}

export function setApiToken(_token: string): void {}

export function clearApiToken(): void {}

export function apiHeaders(extra?: HeadersInit): HeadersInit {
  return extra ?? {};
}

function toRelative(path: string): string {
  return path.replace(/^\/+/, "");
}

export async function apiFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  if (path.startsWith("/api/")) {
    return new Response(null, { status: 503, statusText: "Desktop offline" });
  }
  if (init?.method && init.method !== "GET") {
    return new Response(null, { status: 405, statusText: "Read only" });
  }
  try {
    const data = await window.oko.readPublicJson(toRelative(path));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка чтения файла";
    return new Response(JSON.stringify({ error: msg }), {
      status: 404,
      statusText: msg,
    });
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetchRaw(path, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${path}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
