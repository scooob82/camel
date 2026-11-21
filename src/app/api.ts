/** Minimal JSON client for the Studio API (same origin, session cookie + CSRF header). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

declare global {
  interface Window {
    CAS_API_BASE?: string;
  }
}

export const API_BASE = (typeof window !== 'undefined' && window.CAS_API_BASE) || '/api/v1';

let csrf = '';
export const setCsrf = (t: string) => (csrf = t);

interface Options {
  keepalive?: boolean;
  retried?: boolean;
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'same-origin',
      keepalive: opts.keepalive,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the server. Check your connection.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ApiError(res.status || 0, 'unavailable', 'The server API is not available.');
  }
  const data = (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string; fields?: Record<string, string> } };
  if (typeof data.csrf === 'string') csrf = data.csrf;
  if (path === '/auth/csrf' && typeof data.token === 'string') csrf = data.token;
  if (!res.ok) {
    if (res.status === 419 && !opts.retried) {
      await api('GET', '/auth/csrf');
      return api<T>(method, path, body, { ...opts, retried: true });
    }
    throw new ApiError(res.status, data.error?.code ?? 'error', data.error?.message ?? `Request failed (${res.status})`, data.error?.fields ?? {});
  }
  return data as T;
}
