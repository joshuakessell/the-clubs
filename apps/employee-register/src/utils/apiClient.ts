import { getApiUrl } from '@the-clubs/shared';

/**
 * Centralized API client for the employee-register app.
 *
 * Injects the auth token, sets Content-Type, parses JSON, and
 * throws on non-OK responses — eliminating boilerplate from
 * every store action.
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = globalThis.__authToken;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(getApiUrl(endpoint), { ...options, headers });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.error ?? `HTTP ${res.status}`) as Error & {
      status: number;
      data: Record<string, unknown>;
    };
    err.status = res.status;
    err.data = errorData;
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return null as T;
  return res.json();
}

/**
 * Same as apiFetch but uses a specific auth token instead of globalThis.__authToken.
 * Useful when the token is passed as a parameter (e.g. from useAuthStore).
 */
export async function apiFetchWithToken<T = unknown>(
  endpoint: string,
  authToken: string | null | undefined,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

  const res = await fetch(getApiUrl(endpoint), { ...options, headers });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.error ?? `HTTP ${res.status}`) as Error & {
      status: number;
      data: Record<string, unknown>;
    };
    err.status = res.status;
    err.data = errorData;
    throw err;
  }

  if (res.status === 204) return null as T;
  return res.json();
}
