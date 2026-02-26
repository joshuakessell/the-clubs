/**
 * EmployeeAssistTab — Thin orchestrator that wraps step components
 * in a CheckinFlowProvider.  Each step consumes shared context for
 * session payload, inventory, and flow commands.
 *
 * This follows the Vercel composition pattern: the provider owns
 * the state, step components are explicit variants composed in place.
 */
import { useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';
import { CheckinFlowProvider, useCheckinFlow } from './CheckinFlowContext';
import { FlowIndicator } from './steps/FlowIndicator';
import { RentalStep } from './steps/RentalStep';
import { BackupSelectionStep } from './steps/BackupSelectionStep';
import { PaymentStep } from './steps/PaymentStep';
import { AgreementStep } from './steps/AgreementStep';
import { AssignmentStep } from './steps/AssignmentStep';
import { CompleteStep } from './steps/CompleteStep';

export function EmployeeAssistTab() {
  const { currentSessionId, sessionPayload, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);

  // ── Tab re-entry reconciliation ───────────────────────────────
  // When the employee navigates away and back to the Account tab,
  // fetch the latest session state from the server to ensure
  // nothing was missed (even if SSE delivered events while away).
  useEffect(() => {
    if (!currentSessionId || !laneId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`),
          { headers },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.session && data.session.status === 'ACTIVE') {
          useRegisterStore.setState({
            currentSessionId: data.session.sessionId,
            customerId: data.session.customerId ?? null,
            customerName: data.session.customerName ?? null,
            sessionPayload: data.session,
          });
        } else if (data.session?.status === 'COMPLETED' || data.session?.status === 'CANCELLED' || !data.session) {
          useRegisterStore.setState({
            currentSessionId: null,
            sessionPayload: null,
            successToastMessage: data.session
              ? `Check-in ${data.session.status === 'COMPLETED' ? 'completed' : 'cancelled'} while you were away.`
              : 'Session is no longer active.',
          });
        }
      } catch {
        // Non-critical — current local state is still usable
      }
    })();
    return () => { cancelled = true; };
  // Only run on mount (when this tab renders)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!currentSessionId || !sessionPayload) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <span className="text-4xl" aria-hidden="true">📋</span>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No active check-in session. Select a customer and start check-in from the Profile tab.
        </p>
      </div>
    );
  }

  return (
    <CheckinFlowProvider>
      <CheckinFlowContent />
    </CheckinFlowProvider>
  );
}

/** Inner content — must be inside CheckinFlowProvider to use context. */
function CheckinFlowContent() {
  const { state } = useCheckinFlow();
  const { flowStep } = state;

  return (
    <div className="flex flex-col gap-5">
      <FlowIndicator />

      {(flowStep === 'LANGUAGE' || flowStep === 'RENTAL') && <RentalStep />}
      {flowStep === 'WAITLIST_BACKUP' && <BackupSelectionStep />}
      {flowStep === 'PAYMENT' && <PaymentStep />}
      {flowStep === 'AGREEMENT' && <AgreementStep />}
      {flowStep === 'ASSIGNMENT' && <AssignmentStep />}
      {flowStep === 'COMPLETE' && <CompleteStep />}
    </div>
  );
}
