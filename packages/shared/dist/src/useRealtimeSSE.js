import { useEffect, useRef, useState, useCallback } from 'react';
import { safeParseRealtimeEvent } from './realtimeSchemas.js';
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
export function useRealtimeSSE({ url, onEvent, authParams, enabled = true, heartbeatTimeoutMs = 65_000, }) {
    const [connected, setConnected] = useState(false);
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;
    // Build URL with auth query params (EventSource doesn't support custom headers)
    const buildUrl = useCallback(() => {
        const u = new URL(url, window.location.origin);
        if (authParams) {
            for (const [key, value] of Object.entries(authParams)) {
                if (value)
                    u.searchParams.set(key, value);
            }
        }
        return u.toString();
    }, [url, authParams]);
    useEffect(() => {
        if (!enabled) {
            setConnected(false);
            return;
        }
        let fullUrl;
        try {
            fullUrl = buildUrl();
        }
        catch {
            // Invalid URL — don't connect
            setConnected(false);
            return;
        }
        const eventSource = new EventSource(fullUrl);
        let heartbeatTimer = null;
        const resetHeartbeat = () => {
            if (heartbeatTimer)
                clearTimeout(heartbeatTimer);
            heartbeatTimer = setTimeout(() => {
                // No heartbeat received — close to trigger auto-reconnect
                eventSource.close();
                setConnected(false);
            }, heartbeatTimeoutMs);
        };
        eventSource.onopen = () => {
            setConnected(true);
            resetHeartbeat();
        };
        eventSource.onmessage = (event) => {
            resetHeartbeat();
            try {
                const data = JSON.parse(event.data);
                const parsed = safeParseRealtimeEvent(data);
                if (parsed) {
                    onEventRef.current(parsed);
                }
            }
            catch {
                // Invalid JSON — ignore
            }
        };
        eventSource.onerror = () => {
            // EventSource auto-reconnects; just update state
            setConnected(false);
        };
        return () => {
            eventSource.close();
            if (heartbeatTimer)
                clearTimeout(heartbeatTimer);
            setConnected(false);
        };
    }, [buildUrl, enabled, heartbeatTimeoutMs]);
    return { connected };
}
//# sourceMappingURL=useRealtimeSSE.js.map