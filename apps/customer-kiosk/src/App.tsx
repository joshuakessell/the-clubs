import { useState, useCallback, useRef, useEffect } from 'react';
import { ErrorBoundary } from '@the-clubs/ui';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { getApiUrl } from '@the-clubs/shared';
import { IdleScreen } from './screens/IdleScreen';
import { CheckingInScreen } from './screens/CheckingInScreen';
import { AgreementScreen } from './screens/AgreementScreen';
// PaymentScreen no longer used — employee handles payment
import { AddOnsScreen } from './screens/AddOnsScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { LaneSelectScreen } from './screens/LaneSelectScreen';
import { useKioskSSE } from './hooks/useKioskSSE';
import { I18nProvider } from './i18n';

export type KioskView = 'idle' | 'checkin' | 'addons' | 'agreement' | 'payment' | 'complete';

/* ── Lane configuration ── */
const LANES = [
  { slug: 'lane-1', laneId: 'register-1', label: 'Lane 1 — Register 1' },
  { slug: 'lane-2', laneId: 'register-2', label: 'Lane 2 — Register 2' },
];

/** Parse the URL path to extract the lane slug. Returns null if at root. */
function parseLaneFromPath(): string | null {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, ''); // trim slashes
  if (!path) return null;
  const lane = LANES.find((l) => l.slug === path);
  return lane?.laneId ?? null;
}

/** Map server `flowStep` → kiosk view */
function flowStepToView(flowStep: string | undefined | null): KioskView {
  switch (flowStep) {
    case 'LANGUAGE':
    case 'RENTAL':
      return 'checkin';
    case 'WAITLIST_PREFERENCES':
    case 'WAITLIST_BACKUP':
      return 'checkin';
    case 'PAYMENT':
      return 'checkin'; // Employee handles payment; kiosk shows charges
    case 'AGREEMENT':
      return 'agreement';
    case 'COMPLETE':
      return 'complete';
    default:
      return 'idle';
  }
}

export default function App() {
  const [view, setView] = useState<KioskView>('idle');
  const [sessionPayload, setSessionPayload] = useState<SessionUpdatedPayload | null>(null);

  // ── Lane from URL path ──
  const laneId = parseLaneFromPath();
  const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

  // Use a ref to access current view without stale closures
  const viewRef = useRef(view);
  viewRef.current = view;

  const onSessionUpdated = useCallback((event: any) => {
    if (import.meta.env.DEV) console.log('[kiosk-sse] SESSION_UPDATED', event);
    const payload = event?.payload as SessionUpdatedPayload | undefined;
    if (!payload) return;

    setSessionPayload(payload);
    const targetView = flowStepToView(payload.flowStep);

    // If session ended or was cancelled, go back to idle
    if (payload.status === 'CANCELLED' || payload.status === 'COMPLETED') {
      setView('idle');
      setSessionPayload(null);
      return;
    }

    // Transition to the appropriate view
    setView(targetView);
  }, []);

  const { connected: sseConnected } = useKioskSSE({
    laneId: laneId,
    kioskToken,
    onSessionUpdated,
  });

  // ── Session snapshot catchup ──────────────────────────────────
  // When SSE (re)connects, fetch the latest session to catch any
  // SESSION_UPDATED events that were missed while disconnected.
  const prevConnected = useRef(false);
  useEffect(() => {
    if (!laneId) return;
    if (sseConnected && !prevConnected.current) {
      // SSE just connected — fetch snapshot to catch up
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
            // Synthesize a SESSION_UPDATED callback
            onSessionUpdated({ type: 'SESSION_UPDATED', payload: data.session });
          }
        } catch {
          // Non-critical — SSE will deliver future events
        }
      })();
    }
    prevConnected.current = sseConnected;
  }, [sseConnected, laneId, kioskToken, onSessionUpdated]);

  const navigate = (next: KioskView) => setView(next);
  const reset = () => {
    setView('idle');
    setSessionPayload(null);
  };

  // Extract customer info from session payload
  const customerName = sessionPayload?.customerName ?? 'Customer';
  const language = sessionPayload?.customerPrimaryLanguage ?? 'EN';

  // ── No lane selected → show lane picker ──
  if (!laneId) {
    return (
      <ErrorBoundary>
      <I18nProvider lang= "EN" >
      <LaneSelectScreen
            lanes={ LANES.map((l) => ({ slug: l.slug, label: l.label })) }
          />
      </I18nProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <I18nProvider lang= { language as 'EN' | 'ES' } >
    <div
          className="flex min-h-screen items-center justify-center"
  style = {{ backgroundColor: 'var(--color-surface-base)' }
}
        >
  { view === 'idle' && <IdleScreen />}
{
  view === 'checkin' && (
    <CheckingInScreen
      sessionPayload={ sessionPayload }
    />
  )}
{
  view === 'addons' && (
    <AddOnsScreen
              laneId={ laneId }
  kioskToken = { kioskToken }
  sessionPayload = { sessionPayload }
  onNext = {() => navigate('agreement')
}
onSkip = {() => navigate('agreement')}
            />
          )}
{ view === 'agreement' && <AgreementScreen onAccept={ () => navigate('complete') } onCancel = { reset } />}
{
  view === 'complete' && (
    <CompleteScreen
              customerName={ customerName }
  assignedResourceType = { sessionPayload?.assignedResourceType }
  assignedResourceNumber = { sessionPayload?.assignedResourceNumber }
  onDone = { reset }
    />
          )
}
</div>
  </I18nProvider>
  </ErrorBoundary>
  );
}
