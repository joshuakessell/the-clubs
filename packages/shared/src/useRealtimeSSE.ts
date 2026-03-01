import { useEffect, useRef, useState, useCallback } from 'react';
import { safeParseRealtimeEvent, type ParsedRealtimeEvent } from './realtimeSchemas.js';

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
export function useRealtimeSSE({
  url,
  onEvent,
  authParams,
  enabled = true,
  heartbeatTimeoutMs = 65_000,
}: UseRealtimeSSEOptions): UseRealtimeSSEResult {
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Build URL with auth query params (EventSource doesn't support custom headers)
  const buildUrl = useCallback(() => {
    const u = new URL(url, window.location.origin);
    if (authParams) {
      for (const [key, value] of Object.entries(authParams)) {
        if (value) u.searchParams.set(key, value);
      }
    }
    return u.toString();
  }, [url, authParams]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let fullUrl: string;
    try {
      fullUrl = buildUrl();
    } catch {
      // Invalid URL — don't connect
      setConnected(false);
      return;
    }

    const eventSource = new EventSource(fullUrl);
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const resetHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
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
    };

    eventSource.onmessage = (event) => {
      resetHeartbeat();
      try {
        const data: unknown = JSON.parse(event.data);
        // Skip HEARTBEAT events — they are keepalive pings, not app events
        if (typeof data === 'object' && data !== null && (data as any).type === 'HEARTBEAT') return;
        const parsed = safeParseRealtimeEvent(data);
        if (parsed) {
          onEventRef.current(parsed);
        }
      } catch {
        // Invalid JSON — ignore
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects; just update state
      setConnected(false);
    };

    return () => {
      eventSource.close();
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      setConnected(false);
    };
  }, [buildUrl, enabled, heartbeatTimeoutMs, reconnectCount]);

  return { connected };
}
