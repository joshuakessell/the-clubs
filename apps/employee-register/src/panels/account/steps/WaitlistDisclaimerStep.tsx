import { useTransition } from 'react';
import { useCheckinFlow } from '../CheckinFlowContext';

/**
 * WaitlistDisclaimerStep — Employee waiting state while the customer
 * reviews and acknowledges the waitlist disclaimer on the kiosk.
 *
 * - Shows a "waiting for customer" indicator
 * - Describes what the customer is seeing
 * - Offers a "← Back" to return to WAITLIST_BACKUP
 *
 * When the customer clicks "Ok, I Understand" on the kiosk, the flow
 * advances to PAYMENT and this component is replaced by PaymentStep.
 */
export function WaitlistDisclaimerStep() {
  const { state, actions } = useCheckinFlow();
  const { sp } = state;
  const { sendFlowCommand } = actions;
  const [loading, startTransition] = useTransition();

  const desiredType = sp.waitlistDesiredType ?? sp.proposedRentalType ?? 'room';
  const backupType = sp.backupRentalType ?? 'backup';

  const handleBack = () => {
    startTransition(async () => {
      await sendFlowCommand({ type: 'BACK_STEP' });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Waitlist Disclaimer
      </h3>

      {/* Waiting indicator */}
      <div
        className="flex flex-col items-center gap-4 rounded-lg border p-6"
        style={{
          backgroundColor: 'rgba(99,102,241,0.04)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div
          className="h-10 w-10 rounded-full animate-pulse flex items-center justify-center"
          style={{ backgroundColor: 'rgba(245,158,11,0.15)' }}
        >
          <span className="text-xl" aria-hidden="true">📋</span>
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Waiting for customer acknowledgment…
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            The customer is reviewing the waitlist procedures on the kiosk.
          </p>
        </div>
      </div>

      {/* What the customer sees */}
      <div
        className="rounded-lg border p-3"
        style={{
          backgroundColor: 'rgba(245,158,11,0.04)',
          borderColor: 'rgba(245,158,11,0.15)',
        }}
      >
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-status-warning)' }}>
          Customer is being told:
        </p>
        <ul className="space-y-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <li className="flex gap-2">
            <span style={{ color: 'var(--color-status-warning)' }}>1.</span>
            They will use a {backupType} while they wait for {desiredType}
          </li>
          <li className="flex gap-2">
            <span style={{ color: 'var(--color-status-warning)' }}>2.</span>
            They will be notified when their desired room becomes available
          </li>
          <li className="flex gap-2">
            <span style={{ color: 'var(--color-status-warning)' }}>3.</span>
            They can upgrade by paying the price difference at the front desk
          </li>
        </ul>
      </div>

      {/* Back button */}
      <button
        disabled={loading}
        onClick={() => void handleBack()}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Backup Selection
      </button>
    </div>
  );
}
