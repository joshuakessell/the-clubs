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
export function useRealtimeSSE({ url, onEvent, authParams, enabled = true, heartbeatTimeoutMs = 65_000, onReconnect, enforceMonotonicClock = false, }) {
    const [connected, setConnected] = useState(false);
    const [reconnectCount, setReconnectCount] = useState(0);
    const onEventRef = useRef(onEvent);
    const onReconnectRef = useRef(onReconnect);
    onEventRef.current = onEvent;
    onReconnectRef.current = onReconnect;
    const wasConnected = useRef(false);
    const lastTimestampRef = useRef(0);
    // Stable reference for authParams to avoid infinite reconnection loops
    const authParamsString = authParams ? JSON.stringify(authParams) : '';
    // Build URL with auth query params (EventSource doesn't support custom headers)
    const buildUrl = useCallback(() => {
        const u = new URL(url, globalThis.location.origin);
        if (authParamsString) {
            const parsedParams = JSON.parse(authParamsString);
            for (const [key, value] of Object.entries(parsedParams)) {
                if (value)
                    u.searchParams.set(key, value);
            }
        }
        return u.toString();
    }, [url, authParamsString]);
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
                // No heartbeat received — close and trigger reconnection
                // by incrementing reconnectCount (a useEffect dependency).
                eventSource.close();
                setConnected(false);
                setReconnectCount((c) => c + 1);
            }, heartbeatTimeoutMs);
        };
        eventSource.onopen = () => {
            setConnected(true);
            resetHeartbeat();
            if (wasConnected.current) {
                // This is a reconnection. Fetch a fresh snapshot.
                if (onReconnectRef.current)
                    onReconnectRef.current();
            }
            wasConnected.current = true;
        };
        eventSource.onmessage = (event) => {
            resetHeartbeat();
            try {
                const data = JSON.parse(event.data);
                // Skip HEARTBEAT events — they are keepalive pings, not app events
                if (typeof data === 'object' && data !== null && data.type === 'HEARTBEAT')
                    return;
                const parsed = safeParseRealtimeEvent(data);
                if (!parsed)
                    return;
                if (enforceMonotonicClock && parsed.timestamp) {
                    const eventTime = new Date(parsed.timestamp).getTime();
                    if (eventTime < lastTimestampRef.current)
                        return;
                    lastTimestampRef.current = eventTime;
                }
                onEventRef.current(parsed);
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
    }, [buildUrl, enabled, heartbeatTimeoutMs, reconnectCount]);
    return { connected };
}
//# sourceMappingURL=useRealtimeSSE.js.map