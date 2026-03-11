import { useTransition } from 'react';
import { useCheckinFlow, RENTAL_OPTIONS } from '../CheckinFlowContext';
import type { AvailableInventory } from '../CheckinFlowContext';

/** Helper to check if a rental type is unavailable */
function isTypeUnavailable(type: string, inventory: AvailableInventory | null): boolean {
  if (!inventory) return false;
  if (type === 'LOCKER') return inventory.lockers === 0;
  return (inventory.rooms?.[type] ?? 0) === 0;
}

/**
 * RentalStep — Single-click toggle rental selection.
 *
 * Idempotent: if the rental is already selected/confirmed (e.g. from
 * a resumed session), shows it as selected and the "Next" button
 * without re-sending commands to the server.
 *
 * - Click once → highlight (selected) — sends PROPOSE + CONFIRM
 * - Click again → unhighlight (deselect) — sends CANCEL_STEP
 * - "Next" advances to PAYMENT (available) or WAITLIST_BACKUP (unavailable)
 */
export function RentalStep() {
  const { state, actions } = useCheckinFlow();
  const { sp, inventory } = state;
  const { sendFlowCommand } = actions;

  const [loading, startTransition] = useTransition();

  // The rental that's currently proposed/confirmed in the session
  const selected = sp.proposedRentalType;
  const confirmed = sp.selectionConfirmed;
  // Also check desiredRentalType for waitlist scenarios
  const effectiveSelection = sp.desiredRentalType ?? selected;

  const hasMembership =
    sp.customerMembershipValidUntil &&
    new Date(sp.customerMembershipValidUntil) >= new Date();

  const handleToggle = (rentalType: string) => {
    startTransition(async () => {
      // If there's already a confirmed selection, cancel it first to unlock the step
      if (confirmed) {
        await sendFlowCommand({ type: 'CANCEL_STEP' });
        // Small delay to let the clear propagate
        await new Promise((r) => setTimeout(r, 100));
      }
      
      const unavailable = isTypeUnavailable(rentalType, inventory);

      // Select the new type → propose
      await sendFlowCommand({ type: 'PROPOSE_SELECTION', payload: { rentalType } });
      await new Promise((r) => setTimeout(r, 100));

      // ONLY confirm it if it is actually available!
      // If unavailable, we leave it unconfirmed so it doesn't hit the ledger preview.
      if (!unavailable) {
        await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
      }
    });
  };

  const handleNext = () => {
    if (!effectiveSelection) return;
    startTransition(async () => {
      const unavailable = isTypeUnavailable(effectiveSelection, inventory);
      const nextStep = unavailable ? 'WAITLIST_BACKUP' : 'PAYMENT';
      await sendFlowCommand({ type: 'SET_STEP', payload: { step: nextStep } });
    });
  };

  // Show Next if there's an effective selection (even if unconfirmed, to support waitlist flow)
  const showNext = !!effectiveSelection;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold font-(--font-display) text-(--color-text-primary)">
        Select Rental Type
      </h3>

      {/* Membership indicator */}
      {(hasMembership || sp.membershipChoice === 'SIX_MONTH') && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
            style={{
              backgroundColor: hasMembership ? 'color-mix(in oklch, var(--color-status-success) 10%, transparent)' : 'color-mix(in oklch, var(--color-status-warning) 10%, transparent)',
              color: hasMembership ? 'var(--color-status-success)' : 'var(--color-status-warning)',
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hasMembership ? 'var(--color-status-success)' : 'var(--color-status-warning)' }} />
            {hasMembership ? 'Member' : 'Membership Pending'}
          </span>
        </div>
      )}

      {/* Rental cards — single-click toggle */}
      <div className="flex flex-col gap-3">
        {RENTAL_OPTIONS.map(({ type, label }) => {
          const count =
            type === 'LOCKER'
              ? inventory?.lockers ?? '—'
              : inventory?.rooms?.[type] ?? '—';
          const available = typeof count === 'number' ? count : 0;
          const isUnavailable = typeof count === 'number' && count === 0;
          const allowed = sp.allowedRentals?.includes(type) ?? true;
          const isSelected = effectiveSelection === type;

          return (
            <button
              key={type}
              disabled={loading || !allowed}
              onClick={() => void handleToggle(type)}
              className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'color-mix(in oklch, var(--color-accent-primary) 15%, transparent)'
                  : 'color-mix(in oklch, var(--color-accent-primary) 6%, transparent)',
                borderColor: isSelected
                  ? 'rgb(147, 197, 253)'
                  : 'color-mix(in oklch, var(--color-accent-primary) 20%, transparent)',
                borderWidth: isSelected ? 2 : 1,
                opacity: !allowed ? 0.4 : 1,
                cursor: !allowed ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={{ color: isSelected ? 'rgb(147, 197, 253)' : 'var(--color-text-primary)' }}>
                {label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums" style={{
                  color: isUnavailable
                    ? 'var(--color-accent-secondary, #a78bfa)'
                    : available <= 3 && available > 0
                      ? 'var(--color-status-warning)'
                      : 'var(--color-text-muted)',
                }}>
                  {isUnavailable ? 'Waitlist' : `${count} available`}
                </span>
                {isSelected && (
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgb(147, 197, 253)' }}>
                    ✓ Selected
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Next button — only when a type is selected & confirmed */}
      {showNext && (
        <button
          disabled={loading}
          onClick={() => void handleNext()}
           className="mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-bold transition-colors bg-(--color-accent-primary) text-(--color-text-inverse)"
        >
          {loading ? 'Processing…' : 'Next →'}
        </button>
      )}
    </div>
  );
}
