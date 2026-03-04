/* eslint-disable react-refresh/only-export-components */
/**
 * KioskSessionContext — Shared context for the customer kiosk.
 *
 * Manages SSE connection, session payload, view state, and navigation.
 * Screens consume this context instead of receiving props, eliminating
 * prop drilling of sessionPayload/laneId/kioskToken through the tree.
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { getApiUrl, useSessionPollingFallback } from '@the-clubs/shared';
import { useKioskSSE } from './hooks/useKioskSSE';
import { useKioskHeartbeat } from './hooks/useKioskHeartbeat';

export type KioskView = 'idle' | 'checkin' | 'addons' | 'agreement' | 'payment' | 'complete';

/* ── Lane configuration ── */
export const LANES = [
  { slug: 'lane-1', laneId: 'register-1', label: 'Lane 1 — Register 1' },
  { slug: 'lane-2', laneId: 'register-2', label: 'Lane 2 — Register 2' },
];

/** Parse the URL path to extract the lane slug. Returns null if at root. */
export function parseLaneFromPath(): string | null {
  const path = globalThis.location.pathname.replaceAll(/(^\/+)|(\/+$)/g, ''); // trim slashes
  if (!path) return null;
  const lane = LANES.find((l) => l.slug === path);
  return lane?.laneId ?? null;
}

/** Map server `flowStep` → kiosk view */
function flowStepToView(flowStep: string | undefined | null): KioskView {
  switch (flowStep) {
    case 'RENTAL':
    case 'WAITLIST_BACKUP':
    case 'WAITLIST_DISCLAIMER':
    case 'PAYMENT':
      return 'checkin';
    case 'AGREEMENT':
      return 'agreement';
    case 'ASSIGNMENT':
      return 'complete';
    case 'COMPLETE':
      return 'idle';
    default:
      return 'idle';
  }
}

/* ── Context interface ────────────────────────────────────────── */

interface KioskSessionContextValue {
  view: KioskView;
  sessionPayload: SessionUpdatedPayload | null;
  laneId: string;
  kioskToken: string | null;
  customerName: string;
  navigate: (next: KioskView) => void;
  reset: () => void;
}

const KioskSessionCtx = createContext<KioskSessionContextValue | null>(null);

/* ── Hook ─────────────────────────────────────────────────────── */

export function useKioskSession(): KioskSessionContextValue {
  const ctx = useContext(KioskSessionCtx);
  if (!ctx) throw new Error('useKioskSession must be used within <KioskSessionProvider>');
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────── */

export function KioskSessionProvider({
  laneId,
  children,
}: Readonly<{
  laneId: string;
  children: React.ReactNode;
}>) {
  const [view, setView] = useState<KioskView>('idle');
  const [sessionPayload, setSessionPayload] = useState<SessionUpdatedPayload | null>(null);

  const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; });

  const onSessionUpdated = useCallback((event: { type?: string; payload?: SessionUpdatedPayload }) => {
    if (import.meta.env.DEV) console.log('[kiosk-sse] SESSION_UPDATED', event);
    const payload = event?.payload;
    if (!payload) return;

    setSessionPayload(payload);
    const targetView = flowStepToView(payload.flowStep);

    if (payload.status === 'CANCELLED') {
      setView('idle');
      setSessionPayload(null);
      return;
    }

    // When the session is COMPLETED, return to idle immediately.
    // The employee has finalized the transaction; the kiosk resets.
    if (payload.status === 'COMPLETED') {
      setView('idle');
      setSessionPayload(null);
      return;
    }

    setView(targetView);
  }, []);

  const navigate = useCallback((next: KioskView) => setView(next), []);
  const reset = useCallback(() => {
    setView('idle');
    setSessionPayload(null);
  }, []);

  const { connected: sseConnected } = useKioskSSE({
    laneId,
    kioskToken,
    onSessionUpdated,
  });

  // Heartbeat — tell the server this kiosk is alive
  useKioskHeartbeat(laneId, kioskToken);

  // Session snapshot catchup
  const prevConnected = useRef(false);
  useEffect(() => {
    if (sseConnected && !prevConnected.current) {
      (async () => {
        try {
          const headers: Record<string, string> = {};
          if (kioskToken) headers['x-kiosk-token'] = kioskToken;
          const res = await fetch(
            getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`),
            { headers }
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.session) {
            if (import.meta.env.DEV) console.log('[kiosk-catchup] snapshot', data.session);
            onSessionUpdated({ type: 'SESSION_UPDATED', payload: data.session });
          } else {
            if (import.meta.env.DEV) console.log('[kiosk-catchup] snapshot null, resetting');
            reset();
          }
        } catch {
          // Non-critical — SSE will deliver future events
        }
      })();
    }
    prevConnected.current = sseConnected;
    // Reset on cleanup so StrictMode double-mount re-triggers the catchup
    return () => { prevConnected.current = false; };
  }, [sseConnected, laneId, kioskToken, onSessionUpdated]);

  // ── Polling fallback ──────────────────────────────────────────
  // When SSE disconnects mid-checkin, poll /session-snapshot every 5s
  // so the kiosk stays in sync with the employee register.
  useSessionPollingFallback({
    sseConnected,
    hasActiveSession: sessionPayload !== null,
    laneId,
    authHeaders: kioskToken ? { 'x-kiosk-token': kioskToken } : {},
    onSnapshot: (payload) => {
      if (payload) {
        onSessionUpdated({ type: 'SESSION_UPDATED', payload });
      } else {
        reset();
      }
    },
  });

  const customerName = sessionPayload?.customerName ?? 'Customer';

  const value: KioskSessionContextValue = useMemo(() => ({
    view,
    sessionPayload,
    laneId,
    kioskToken,
    customerName,
    navigate,
    reset,
  }), [view, sessionPayload, laneId, kioskToken, customerName, navigate, reset]);

  return <KioskSessionCtx.Provider value={value}>{children}</KioskSessionCtx.Provider>;
}
