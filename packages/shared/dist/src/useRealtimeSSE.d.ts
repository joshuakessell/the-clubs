import { type ParsedRealtimeEvent } from './realtimeSchemas.js';
export interface UseRealtimeSSEOptions {
    /** Full URL to the SSE endpoint, e.g. `http://localhost:3000/v1/realtime/sse/lane/lane-1` */
    url: string;
    /** Called for each parsed realtime event */
    onEvent: (event: ParsedRealtimeEvent) => void;
    /** Extra headers to send (auth tokens). EventSource doesn't support custom headers,
     *  so we append them as query params that the server extracts. */
    authParams?: Record<string, string>;
    /** Toggle the connection on/off */
    enabled?: boolean;
    /** Heartbeat timeout in ms (default: 65000). If no message or heartbeat arrives
     *  within this window, we close and let EventSource auto-reconnect. */
    heartbeatTimeoutMs?: number;
}
export interface UseRealtimeSSEResult {
    connected: boolean;
}
/**
 * Lightweight SSE hook for lane-scoped realtime events.
 *
 * Uses the native `EventSource` API which provides:
 * - Automatic reconnection with exponential backoff
 * - Standard HTTP (never blocked by proxies)
 * - Multiplexed over HTTP/2 (no connection limit)
 *
 * Events are parsed through `safeParseRealtimeEvent` and forwarded
 * to the caller via `onEvent`.
 */
export declare function useRealtimeSSE({ url, onEvent, authParams, enabled, heartbeatTimeoutMs, }: UseRealtimeSSEOptions): UseRealtimeSSEResult;
//# sourceMappingURL=useRealtimeSSE.d.ts.map