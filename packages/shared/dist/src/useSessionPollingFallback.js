import { useEffect, useRef } from 'react';
import { getApiUrl } from './apiBase.js';
/**
 * Polls `/session-snapshot` when SSE is disconnected AND a session is active.
 *
 * This is a **fallback only** — it never runs when SSE is healthy.
 * When SSE reconnects, the interval is immediately cleared and the normal
 * snapshot-catchup in App.tsx / KioskSessionContext takes over.
 *
 * Following the websockets-realtime skill's "Graceful degradation to polling"
 * principle: SSE is the primary channel, polling is the safety net.
 */
export function useSessionPollingFallback({ sseConnected, hasActiveSession, laneId, authHeaders, onSnapshot, intervalMs = 5_000, }) {
    const onSnapshotRef = useRef(onSnapshot);
    onSnapshotRef.current = onSnapshot;
    const authHeadersRef = useRef(authHeaders);
    authHeadersRef.current = authHeaders;
    useEffect(() => {
        // Only poll when SSE is down AND we have an active session to protect
        if (sseConnected || !hasActiveSession || !laneId)
            return;
        let cancelled = false;
        const poll = async () => {
            if (cancelled)
                return;
            try {
                const res = await fetch(getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`), { headers: authHeadersRef.current });
                if (!res.ok || cancelled)
                    return;
                const data = await res.json();
                if (data.session && !cancelled) {
                    onSnapshotRef.current(data.session);
                }
            }
            catch {
                // Network still down — will retry on next interval
            }
        };
        // Poll immediately on activation, then at interval
        void poll();
        const id = setInterval(() => void poll(), intervalMs);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [sseConnected, hasActiveSession, laneId, intervalMs]);
}
//# sourceMappingURL=useSessionPollingFallback.js.map