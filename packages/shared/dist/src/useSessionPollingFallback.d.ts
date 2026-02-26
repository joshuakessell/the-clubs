import type { SessionUpdatedPayload } from './types.js';
export interface UseSessionPollingFallbackOptions {
    /** True when the SSE EventSource is connected. */
    sseConnected: boolean;
    /** True when there is an active session that polling should protect. */
    hasActiveSession: boolean;
    /** Lane identifier (e.g. "register-1"). */
    laneId: string;
    /** Auth headers to include in snapshot requests. */
    authHeaders: Record<string, string>;
    /** Called with the latest session payload when a snapshot is fetched. */
    onSnapshot: (payload: SessionUpdatedPayload) => void;
    /** Polling interval in ms. Defaults to 5000 (5s). */
    intervalMs?: number;
}
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
export declare function useSessionPollingFallback({ sseConnected, hasActiveSession, laneId, authHeaders, onSnapshot, intervalMs, }: UseSessionPollingFallbackOptions): void;
//# sourceMappingURL=useSessionPollingFallback.d.ts.map