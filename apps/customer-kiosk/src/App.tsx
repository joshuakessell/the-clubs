import { useState, useCallback, useRef } from 'react';
import { ErrorBoundary } from '@the-clubs/ui';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { IdleScreen } from './screens/IdleScreen';
import { SelectionScreen } from './screens/SelectionScreen';
import { AgreementScreen } from './screens/AgreementScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { AddOnsScreen } from './screens/AddOnsScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { useKioskSSE } from './hooks/useKioskSSE';

export type KioskView = 'idle' | 'selection' | 'addons' | 'agreement' | 'payment' | 'complete';

/** Map server `flowStep` → kiosk view */
function flowStepToView(flowStep: string | undefined | null): KioskView {
  switch (flowStep) {
    case 'LANGUAGE':
    case 'RENTAL':
      return 'selection';
    case 'WAITLIST_PREFERENCES':
    case 'WAITLIST_BACKUP':
      return 'selection'; // waitlist happens on the selection screen
    case 'PAYMENT':
      return 'payment';
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

  // SSE realtime connection (lane + token from env vars)
  const laneId = (import.meta.env.VITE_LANE_ID as string) || 'register-1';
  const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || null;

  // Use a ref to access current view without stale closures
  const viewRef = useRef(view);
  viewRef.current = view;

  const onSessionUpdated = useCallback((event: any) => {
    if (import.meta.env.DEV) console.log('[kiosk-sse] SESSION_UPDATED', event);
    const payload = event?.payload as SessionUpdatedPayload | undefined;
    if (!payload) return;

    setSessionPayload(payload);

    // Determine which view we should be on based on the server's flowStep
    const targetView = flowStepToView(payload.flowStep);

    // If the session is completed/cancelled, return to idle
    if (payload.status === 'COMPLETED' || payload.status === 'CANCELLED') {
      setView('idle');
      setSessionPayload(null);
      return;
    }

    // Transition to the appropriate view
    setView(targetView);
  }, []);

  const { connected: _sseConnected } = useKioskSSE({
    laneId,
    kioskToken,
    onSessionUpdated,
  });

  const navigate = (next: KioskView) => setView(next);
  const reset = () => {
    setView('idle');
    setSessionPayload(null);
  };

  // Extract customer info from session payload
  const customerName = sessionPayload?.customerName ?? 'Customer';
  const language = sessionPayload?.customerPrimaryLanguage ?? 'EN';

  return (
    <ErrorBoundary>
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--color-surface-base)' }}
      >
        {view === 'idle' && <IdleScreen />}
        {view === 'selection' && (
          <SelectionScreen
            customerName={customerName}
            language={language as 'EN' | 'ES'}
            sessionPayload={sessionPayload}
            laneId={laneId}
            kioskToken={kioskToken}
            onNext={() => navigate('addons')}
            onCancel={reset}
          />
        )}
        {view === 'addons' && (
          <AddOnsScreen
            laneId={laneId}
            kioskToken={kioskToken}
            sessionPayload={sessionPayload}
            onNext={() => navigate('agreement')}
            onSkip={() => navigate('agreement')}
          />
        )}
        {view === 'agreement' && <AgreementScreen onAccept={() => navigate('payment')} onCancel={reset} />}
        {view === 'payment' && (
          <PaymentScreen
            laneId={laneId}
            kioskToken={kioskToken}
            sessionPayload={sessionPayload}
            onComplete={() => navigate('complete')}
            onCancel={reset}
          />
        )}
        {view === 'complete' && (
          <CompleteScreen
            customerName={customerName}
            assignedResourceType={sessionPayload?.assignedResourceType}
            assignedResourceNumber={sessionPayload?.assignedResourceNumber}
            onDone={reset}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
