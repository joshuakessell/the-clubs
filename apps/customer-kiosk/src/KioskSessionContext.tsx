/**
 * KioskSessionContext — Shared context for the customer kiosk.
 *
 * Manages SSE connection, session payload, view state, and navigation.
 * Screens consume this context instead of receiving props, eliminating
 * prop drilling of sessionPayload/laneId/kioskToken through the tree.
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { getApiUrl, useSessionPollingFallback } from '@the-clubs/shared';
import { useKioskSSE } from './hooks/useKioskSSE';

export type KioskView = 'idle' | 'checkin' | 'addons' | 'agreement' | 'payment' | 'complete';

/* ── Lane configuration ── */
export const LANES = [
  { slug: 'lane-1', laneId: 'register-1', label: 'Lane 1 — Register 1' },
  { slug: 'lane-2', laneId: 'register-2', label: 'Lane 2 — Register 2' },
];

/** Parse the URL path to extract the lane slug. Returns null if at root. */
export function parseLaneFromPath(): string | null {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, ''); // trim slashes
  if (!path) return null;
  const lane = LANES.find((l) => l.slug === path);
  return lane?.laneId ?? null;
}

/** Map server `flowStep` → kiosk view */
function flowStepToView(flowStep: string | undefined | null): KioskView {
  switch (flowStep) {
    case 'RENTAL':
    case 'WAITLIST_BACKUP':
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
}: {
  laneId: string;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<KioskView>('idle');
  const [sessionPayload, setSessionPayload] = useState<SessionUpdatedPayload | null>(null);

  const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

  const viewRef = useRef(view);
  viewRef.current = view;

  const onSessionUpdated = useCallback((event: any) => {
    if (import.meta.env.DEV) console.log('[kiosk-sse] SESSION_UPDATED', event);
    const payload = event?.payload as SessionUpdatedPayload | undefined;
    if (!payload) return;

    setSessionPayload(payload);
    const targetView = flowStepToView(payload.flowStep);

    if (payload.status === 'CANCELLED' || payload.status === 'COMPLETED') {
      setView('idle');
      setSessionPayload(null);
      return;
    }

    setView(targetView);
  }, []);

  const { connected: sseConnected } = useKioskSSE({
    laneId,
    kioskToken,
    onSessionUpdated,
  });

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
      onSessionUpdated({ type: 'SESSION_UPDATED', payload });
    },
  });

  const navigate = (next: KioskView) => setView(next);
  const reset = () => {
    setView('idle');
    setSessionPayload(null);
  };

  const customerName = sessionPayload?.customerName ?? 'Customer';

  const value: KioskSessionContextValue = {
    view,
    sessionPayload,
    laneId,
    kioskToken,
    customerName,
    navigate,
    reset,
  };

  return <KioskSessionCtx.Provider value={value}>{children}</KioskSessionCtx.Provider>;
}
