import { useCallback, useEffect, useRef } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary, LockScreen, ChangePinScreen, ValidatingScreen, useAuthStore, useSessionGuard } from '@the-clubs/ui';
import { getApiUrl, useSessionPollingFallback, type SessionUpdatedPayload } from '@the-clubs/shared';
import { AppLayout } from './layout/AppLayout';
import { RegisterSelectScreen } from './screens/RegisterSelectScreen';
import { useRegisterSSE } from './hooks/useRegisterSSE';
import { useRegisterStore } from './stores/useRegisterStore';
import { RouteLogger } from './components/RouteLogger';

const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

export default function App() {
  const session = useAuthStore((s) => s.session);
  const isValidating = useAuthStore((s) => s.isValidating);

  // Validate session on load and intercept 401s to redirect to login
  useSessionGuard();

  // Lane ID from store (derived from URL path)
  const laneId = useRegisterStore((s) => s.laneId);
  const setSessionPayload = useRegisterStore((s) => s.setSessionPayload);

  // Bridge: Expose auth token for store-level API calls (Zustand doesn't have React context)
  useEffect(() => {
    globalThis.__authToken = session?.sessionToken ?? null;
  }, [session?.sessionToken]);

  const onSessionUpdated = useCallback((event: { type?: string; payload?: SessionUpdatedPayload | null }) => {
    if (import.meta.env.DEV) console.log('[register-sse] SESSION_UPDATED', event);
    // Update store with SSE session payload
    if (event?.payload) {
      setSessionPayload(event.payload);

      // Also recover currentSessionId / customerId / customerName when SSE delivers a session
      const p = event.payload;
      if (p.sessionId && p.status !== 'COMPLETED' && p.status !== 'CANCELLED') {
        useRegisterStore.setState({
          currentSessionId: p.sessionId,
          customerId: p.customerId ?? null,
          customerName: p.customerName ?? null,
        });
      } else if (p.status === 'COMPLETED' || p.status === 'CANCELLED') {
        useRegisterStore.setState({
          currentSessionId: null,
          customerId: null,
          customerName: null,
          activeCheckinInfo: null,
          sessionPayload: undefined,
        });
      }
    }
  }, [setSessionPayload]);

  const { connected: sseConnected } = useRegisterSSE({
    laneId,
    staffToken: session?.sessionToken ?? null,
    kioskToken,
    onSessionUpdated,
  });

  // ── Session snapshot catchup ──────────────────────────────────
  // When SSE (re)connects, fetch the latest session to recover any
  // active sessions that were missed (e.g. after a page refresh).
  const prevConnected = useRef(false);
  useEffect(() => {
    if (!laneId || !session?.sessionToken) return;
    if (sseConnected && !prevConnected.current) {
      (async () => {
        try {
          const res = await fetch(
            getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`),
            {
              headers: {
                Authorization: `Bearer ${session.sessionToken}`,
                ...(kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
              },
            }
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.session && data.session.status !== 'COMPLETED' && data.session.status !== 'CANCELLED') {
            if (import.meta.env.DEV) console.log('[register-catchup] recovered session', data.session);
            useRegisterStore.setState({
              currentSessionId: data.session.sessionId,
              customerId: data.session.customerId ?? null,
              customerName: data.session.customerName ?? null,
              sessionPayload: data.session,
            });
          }
        } catch {
          // Non-critical — SSE will deliver future events
        }
      })();
    }
    prevConnected.current = sseConnected;
    // Reset on cleanup so StrictMode double-mount re-triggers the catchup
    return () => { prevConnected.current = false; };
  }, [sseConnected, laneId, session?.sessionToken]);

  // ── Polling fallback ──────────────────────────────────────────
  // When SSE disconnects mid-checkin, poll /session-snapshot every 5s
  // so the employee register stays in sync. Stops on SSE reconnect.
  const currentSessionId = useRegisterStore((s) => s.currentSessionId);
  useSessionPollingFallback({
    sseConnected,
    hasActiveSession: Boolean(currentSessionId),
    laneId,
    authHeaders: {
      ...(session?.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {}),
      ...(kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
    },
    onSnapshot: (payload) => {
      onSessionUpdated({ type: 'SESSION_UPDATED', payload });
    },
  });

  function renderScreen() {
    if (isValidating) return <ValidatingScreen />;
    if (!session) return <LockScreen appTitle="Employee Register" />;
    if (session.mustChangePin) return <ChangePinScreen />;
    if (!laneId) return <RegisterSelectScreen />;
    return <AppLayout />;
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <RouteLogger />
        {renderScreen()}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
