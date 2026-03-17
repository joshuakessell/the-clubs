import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';

/**
 * Generic dashboard data-fetching hook.
 *
 * Wraps `fetch` with:
 * - `getApiUrl` base-URL resolution
 * - `Authorization: Bearer <sessionToken>` from auth store
 * - Loading / error / refetch state
 *
 * @param path  API path, e.g. `'/api/v1/admin/kpi'`
 * @param opts  Optional: `{ skip, transform }`
 */
export function useDashboardFetch<T>(
  path: string | null,
  opts?: { skip?: boolean; transform?: (raw: unknown) => T },
) {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!opts?.skip);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Store transform in a ref so callers can pass inline functions without
  // causing refetches (rule rerender-dependencies).
  const transformRef = useRef(opts?.transform);
  transformRef.current = opts?.transform;

  const fetchData = useCallback(async () => {
    if (!path || opts?.skip) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl(path), { headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      if (mountedRef.current) {
        setData(transformRef.current ? transformRef.current(json) : (json as T));
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Fetch failed');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [path, token, opts?.skip]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Fire-and-forget POST / PATCH / DELETE helper.
 * Returns the parsed JSON response.
 */
export async function dashboardMutate<T = unknown>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const token = useAuthStore.getState().session?.sessionToken;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(getApiUrl(path), {
    method,
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
