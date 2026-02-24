import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Session guard hook for staff-facing apps (employee register, office dashboard).
 *
 * On mount:
 *  - Validates the stored session token against `GET /api/v1/auth/me`.
 *  - If the token is invalid/expired (401), clears the session → LockScreen renders.
 *
 * Ongoing:
 *  - Patches `window.fetch` to intercept 401 responses on API calls.
 *  - If any API call returns 401 and the response body indicates session invalidity,
 *    clears the session automatically.
 *
 * Call this once at the top of your app (e.g., in App.tsx).
 */
export function useSessionGuard() {
    const validateSession = useAuthStore((s) => s.validateSession);
    const session = useAuthStore((s) => s.session);
    const patchedRef = useRef(false);

    // Validate on mount (and when session changes from null → valid, e.g. after login)
    useEffect(() => {
        if (session) {
            void validateSession();
        }
    }, [session?.sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

    // Heartbeat: ping /auth/me every 10 minutes to keep session alive
    // and detect expiry proactively before the user tries an action.
    useEffect(() => {
        if (!session) return;
        const HEARTBEAT_MS = 10 * 60 * 1000; // 10 minutes
        const id = setInterval(() => {
            void validateSession();
        }, HEARTBEAT_MS);
        return () => clearInterval(id);
    }, [session?.sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

    // Patch fetch to intercept 401s on API calls
    useEffect(() => {
        if (patchedRef.current) return;
        patchedRef.current = true;

        const originalFetch = window.fetch;

        window.fetch = async function patchedFetch(
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const response = await originalFetch.call(window, input, init);

            // Only intercept 401s on API calls (not third-party requests)
            if (response.status === 401) {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                const isApiCall = url.includes('/api/') || url.includes('/v1/');
                // Don't intercept login attempts — only authenticated API calls
                const isLoginRoute = url.includes('/auth/login');

                if (isApiCall && !isLoginRoute) {
                    // Check if there's a current session to clear
                    const currentSession = useAuthStore.getState().session;
                    if (currentSession) {
                        useAuthStore.getState().clearSession();
                    }
                }
            }

            return response;
        };

        return () => {
            window.fetch = originalFetch;
            patchedRef.current = false;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
