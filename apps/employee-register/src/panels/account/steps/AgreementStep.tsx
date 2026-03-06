import { useCheckinFlow } from '../CheckinFlowContext';

/**
 * AgreementStep — Waits for the customer to sign the agreement on the kiosk.
 * No bypass option. No back navigation (payment is complete at this point).
 */
export function AgreementStep() {
  const { state } = useCheckinFlow();
  const { sp } = state;

  const signed = sp.agreementSigned;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Liability Agreement
      </h3>

      <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center"
        style={{
          backgroundColor: signed ? 'color-mix(in oklch, var(--color-status-success) 5%, transparent)' : 'var(--color-surface-overlay)',
          borderColor: signed ? 'color-mix(in oklch, var(--color-status-success) 20%, transparent)' : 'var(--color-border-subtle)',
        }}
      >
        <span className="text-sm font-bold" style={{ color: signed ? 'var(--color-status-success)' : 'var(--color-text-muted)' }}>
          {signed ? 'Signed' : 'Unsigned'}
        </span>
        <p className="text-sm font-semibold" style={{ color: signed ? 'var(--color-status-success)' : 'var(--color-text-secondary)' }}>
          {signed
            ? `Agreement signed (${sp.agreementSignedMethod === 'MANUAL' ? 'Manual' : 'Digital'})`
            : 'Waiting for customer to sign on kiosk…'}
        </p>
      </div>

      {signed && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-success) 20%, transparent)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-status-success)' }}>
            Agreement signed. Proceeding to room assignment…
          </p>
        </div>
      )}
    </div>
  );
}
