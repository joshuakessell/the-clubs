import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getApiUrl } from '@the-clubs/shared';

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
    const validateSession = useAuthStore((s: { validateSession: any }) => s.validateSession);
    const session = useAuthStore((s: { session: any }) => s.session);
    const patchedRef = useRef(false);
    // Track whether the session just changed (e.g. fresh login).
    // Skip the immediate validateSession call for freshly-created sessions
    // because the token was JUST issued — validating it causes a jarring
    // flash of the ValidatingScreen on every login.
    const prevTokenRef = useRef<string | undefined>(session?.sessionToken);

    // Validate on mount (and when session token changes, e.g. after login)
    useEffect(() => {
        if (!session) {
            prevTokenRef.current = undefined;
            return;
        }

        const tokenChanged = prevTokenRef.current !== session.sessionToken;
        prevTokenRef.current = session.sessionToken;

        if (tokenChanged) {
            // Fresh login — skip the immediate validation to avoid a flash,
            // but schedule a deferred check after 1 second. This catches stale
            // tokens returned from the server (e.g. server restarted mid-login)
            // without causing a visible validating screen flicker.
            const t = setTimeout(() => void validateSession({ silent: true }), 1_000);
            return () => clearTimeout(t);
        }

        // Token didn't change (e.g. re-mount or page refresh with stored token) —
        // validate immediately to ensure the token is still valid.
        void validateSession();
    }, [session?.sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

    // Heartbeat: ping /auth/me every 90 seconds so a server restart is detected
    // quickly and the user is sent back to the lock screen automatically.
    // Also fires immediately on mount to catch stale tokens right away.
    useEffect(() => {
        if (!session) return;
        const HEARTBEAT_MS = 90 * 1_000; // 90 seconds
        void validateSession({ silent: true }); // fire immediately (silent to avoid UI flash)
        const id = setInterval(() => void validateSession({ silent: true }), HEARTBEAT_MS);
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
                    || url.includes('/realtime/sse');

                if (isApiCall && !isExcluded) {
                    const currentSession = useAuthStore.getState().session;
                    if (currentSession && !confirmationInFlight) {
                        confirmationInFlight = true;
                        // Confirm the session is genuinely invalid before clearing.
                        // This prevents race conditions and transient 401s from
                        // kicking the user back to the lock screen.
                        try {
                            const meRes = await originalFetch.call(window, getApiUrl('/api/v1/auth/me'), {
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
