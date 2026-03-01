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
    // Track whether the session just changed (e.g. fresh login).
    // Skip the immediate validateSession call for freshly-created sessions
    // because the token was JUST issued — validating it causes a jarring
    // flash of the ValidatingScreen on every login.
    const prevTokenRef = useRef<string | undefined>(session?.sessionToken);

    // Validate on mount (and when session changes from null → valid, e.g. after login)
    useEffect(() => {
        if (!session) {
            prevTokenRef.current = undefined;
            return;
        }

        const tokenChanged = prevTokenRef.current !== session.sessionToken;
        prevTokenRef.current = session.sessionToken;

        if (tokenChanged) {
            // Session token just changed — this is a fresh login.
            // Skip validation; the token is brand-new.
            return;
        }

        // Token didn't change (e.g. component re-mounted or page refresh with
        // restored localStorage token) — validate to ensure it's still valid.
        void validateSession();
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
        let confirmationInFlight = false;

        window.fetch = async function patchedFetch(
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const response = await originalFetch.call(window, input, init);

            // Only intercept 401s on API calls (not third-party requests)
            if (response.status === 401) {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                const isApiCall = url.includes('/api/') || url.includes('/v1/');
                const isExcluded = url.includes('/auth/login')
                    || url.includes('/auth/me')
                    || url.includes('/session-snapshot')
                    || url.includes('/realtime/sse');

                if (isApiCall && !isExcluded) {
                    const currentSession = useAuthStore.getState().session;
                    if (currentSession && !confirmationInFlight) {
                        confirmationInFlight = true;
                        // Confirm the session is genuinely invalid before clearing.
                        // This prevents race conditions and transient 401s from
                        // kicking the user back to the lock screen.
                        try {
                            const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '/api';
                            const meRes = await originalFetch.call(window, `${API_BASE}/v1/auth/me`, {
                                headers: { Authorization: `Bearer ${currentSession.sessionToken}` },
                            });
                            if (meRes.status === 401) {
                                console.error('[useSessionGuard] Session confirmed invalid (401 from /auth/me). Clearing session.');
                                useAuthStore.getState().clearSession();
                            } else {
                                console.warn('[useSessionGuard] Got 401 from', url, 'but /auth/me succeeded — session is still valid, not clearing.');
                            }
                        } catch {
                            // Network error on confirmation — don't clear, server might be temporarily down
                            console.warn('[useSessionGuard] Could not confirm 401 (network error) — keeping session.');
                        } finally {
                            confirmationInFlight = false;
                        }
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
