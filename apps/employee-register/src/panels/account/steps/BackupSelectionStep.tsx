import { useTransition } from 'react';
import { useCheckinFlow, RENTAL_OPTIONS } from '../CheckinFlowContext';
import type { AvailableInventory } from '../CheckinFlowContext';

/**
 * BackupSelectionStep — Employee picks a backup rental type
 * for a customer who selected an unavailable room (waitlist).
 *
 * - Single-click to highlight backup option
 * - "Send Disclaimer" triggers the kiosk modal
 * - Customer clicks "Understood" → both proceed to PAYMENT
 * - "← Back" returns to RENTAL (invisible to customer)
 */
export function BackupSelectionStep() {
  const { state, actions } = useCheckinFlow();
  const { sp, inventory } = state;
  const { sendFlowCommand } = actions;

  const [loading, startTransition] = useTransition();

  const selectedBackup = sp.backupRentalType;
  const desiredType = sp.waitlistDesiredType ?? sp.proposedRentalType;

  // Filter to show only cheaper/available options as backup
  const backupOptions = RENTAL_OPTIONS.filter(({ type }) => {
    if (type === desiredType) return false;
    // Lockers and types cheaper than desired are valid backups
    return true;
  });

  const getCount = (type: string, inv: AvailableInventory | null) => {
    if (!inv) return '—';
    if (type === 'LOCKER') return inv.lockers ?? '—';
    return inv.rooms?.[type] ?? '—';
  };

  const handleSelectBackup = (type: string) => {
    startTransition(async () => {
      await sendFlowCommand({
        type: 'WAITLIST_UPDATE',
        payload: {
          waitlistDesiredType: desiredType ?? undefined,
          backupRentalType: type,
        },
      });

      // Small delay to let the waitlist update propagate
      await new Promise((r) => setTimeout(r, 100));

      // Propose and confirm the backup selection so it replaces the preview
      // price on the ledger and customer kiosk immediately.
      await sendFlowCommand({ type: 'PROPOSE_SELECTION', payload: { rentalType: type } });
      await new Promise((r) => setTimeout(r, 100));
      await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
    });
  };

  const handleSendDisclaimer = () => {
    startTransition(async () => {
      // Advance to WAITLIST_DISCLAIMER — the kiosk will show the disclaimer modal.
      await sendFlowCommand({ type: 'SET_STEP', payload: { step: 'WAITLIST_DISCLAIMER' } });
    });
  };

  const handleBack = () => {
    startTransition(async () => {
      // Clear waitlist intent and backup selection when backing out
      await sendFlowCommand({
        type: 'WAITLIST_UPDATE',
        payload: { waitlistDesiredType: null, backupRentalType: null },
      });
      await new Promise((r) => setTimeout(r, 100));
      await sendFlowCommand({ type: 'BACK_STEP' });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Backup Selection
      </h3>

      {/* Info banner */}
      <div className="rounded-lg border p-3" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--color-status-warning)' }}>
          {desiredType ? `${desiredType} is unavailable.` : 'Selected room is unavailable.'} Choose a backup rental for the customer while they wait.
        </p>
      </div>

      {/* Backup options */}
      <div className="flex flex-col gap-3">
        {backupOptions.map(({ type, label }) => {
          const count = getCount(type, inventory);
          const available = typeof count === 'number' ? count : 0;
          const isUnavailable = typeof count === 'number' && count === 0;
          const isSelected = selectedBackup === type;

          return (
            <button
              key={type}
              disabled={loading || isUnavailable}
              onClick={() => void handleSelectBackup(type)}
              className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'color-mix(in oklch, var(--color-accent-primary) 15%, transparent)'
                  : 'color-mix(in oklch, var(--color-accent-primary) 6%, transparent)',
                borderColor: isSelected
                  ? 'rgb(147, 197, 253)'
                  : 'color-mix(in oklch, var(--color-accent-primary) 20%, transparent)',
                borderWidth: isSelected ? 2 : 1,
                opacity: isUnavailable ? 0.4 : 1,
                cursor: isUnavailable ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={{ color: isSelected ? 'rgb(147, 197, 253)' : 'var(--color-text-primary)' }}>
                {label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums" style={{
                  color: isUnavailable
                    ? 'var(--color-status-error)'
                    : available <= 3 && available > 0
                      ? 'var(--color-status-warning)'
                      : 'var(--color-text-muted)',
                }}>
                  {isUnavailable ? 'Unavailable' : `${count} available`}
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

      {/* Proceed / Disclaimer button */}
      {selectedBackup && (
        <button
          disabled={loading}
          onClick={() => void handleSendDisclaimer()}
          className="mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-bold transition-colors"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
          }}
        >
          {loading ? 'Processing…' : 'Send Disclaimer & Continue →'}
        </button>
      )}

      {/* Back button */}
      <button
        disabled={loading}
        onClick={() => void handleBack()}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Rental Selection
      </button>
    </div>
  );
}
