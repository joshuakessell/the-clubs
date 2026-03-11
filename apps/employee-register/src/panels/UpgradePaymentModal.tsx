/**
 * UpgradePaymentModal — Payment flow for waitlist upgrades.
 *
 * Shows original charges, upgrade fee, total due.
 * Payment buttons: Credit, Cash, Split (partial amounts).
 * After payment, Complete button finalises the upgrade.
 */

interface UpgradePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerLabel: string;
  newRoomNumber?: string | null;
  originalCharges: Array<{ description: string; amount: number }>;
  originalTotal: number | null;
  upgradeFee: number | null;
  orderStatus: 'OPEN' | 'PAID' | null;
  isSubmitting: boolean;
  canComplete: boolean;
  onPayCredit: () => void;
  onPayCash: () => void;
  onComplete: () => void;
}

export function UpgradePaymentModal({
  isOpen,
  onClose,
  customerLabel,
  newRoomNumber,
  originalCharges,
  originalTotal,
  upgradeFee,
  orderStatus,
  isSubmitting,
  canComplete,
  onPayCredit,
  onPayCash,
  onComplete,
}: UpgradePaymentModalProps) {
  if (!isOpen) return null;

  const totalDue = typeof upgradeFee === 'number' && Number.isFinite(upgradeFee) ? upgradeFee : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col gap-5 rounded-xl border p-6 shadow-2xl bg-(--color-surface-raised) border-(--color-border-default) max-w-[520px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <h3
            className="text-lg font-bold font-(--font-display) text-(--color-text-primary)"
          >
            Upgrade Payment
          </h3>
          <p className="mt-1 text-sm text-(--color-text-secondary)">
            {customerLabel}
            {newRoomNumber && <> — Room {newRoomNumber}</>}
          </p>
        </div>

        {/* Already Paid section */}
        <div
          className="rounded-lg border p-3 bg-(--color-surface-input) border-(--color-border-subtle)"
        >
          <div className="text-xs font-bold uppercase tracking-wider mb-2 text-(--color-text-muted)">
            Already Paid
          </div>
          {originalCharges.length > 0 ? (
            <>
              {originalCharges.map((item, idx) => (
                <div
                  key={`${item.description}-${idx}`}
                  className="flex justify-between text-sm text-(--color-text-muted)"
                >
                  <span>{item.description}</span>
                  <span>${item.amount.toFixed(2)}</span>
                </div>
              ))}
              {originalTotal !== null && (
                <div
                  className="flex justify-between text-sm font-semibold mt-1 pt-1 border-t text-(--color-text-secondary) border-(--color-border-subtle)"
                >
                  <span>Original total</span>
                  <span>${originalTotal.toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm italic text-(--color-text-muted)">
              All prior charges are settled.
            </div>
          )}
        </div>

        {/* New Charge section */}
        <div
          className="rounded-lg border p-3 bg-(--color-surface-input) border-(--color-border-subtle)"
        >
          <div className="text-xs font-bold uppercase tracking-wider mb-2 text-(--color-text-muted)">
            New Charge
          </div>
          <div className="flex justify-between text-sm font-semibold text-(--color-text-primary)">
            <span>Upgrade Fee</span>
            <span>${upgradeFee !== null && Number.isFinite(upgradeFee) ? upgradeFee.toFixed(2) : '—'}</span>
          </div>
        </div>

        {/* Total Due */}
        <div
          className="flex items-center justify-between rounded-lg border p-3 bg-(--color-surface-overlay) border-(--color-border-accent)"
        >
          <span className="text-sm font-bold text-(--color-text-primary)">Total Due</span>
          <span className="text-lg font-extrabold text-(--color-status-warning)">
            ${totalDue.toFixed(2)}
          </span>
        </div>

        {/* Payment buttons */}
        {orderStatus !== 'PAID' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onPayCredit}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2.5 text-sm font-bold transition-colors"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}
            >
              Credit
            </button>
            <button
              onClick={onPayCash}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2.5 text-sm font-bold transition-colors"
              style={{ backgroundColor: 'var(--color-status-success)', color: '#000' }}
            >
              💵 Cash
            </button>
          </div>
        )}

        {/* Status + Complete */}
        <div className="flex items-center justify-between">
          <span
            className="text-sm font-bold"
            style={{ color: orderStatus === 'PAID' ? 'var(--color-status-success)' : 'var(--color-status-warning)' }}
          >
            {orderStatus === 'PAID' ? '✓ Payment Received' : '⏳ Payment Due'}
          </span>
          <button
            onClick={onComplete}
            disabled={!canComplete || isSubmitting}
            className="rounded-lg px-4 py-2.5 text-sm font-bold transition-colors"
            style={{
              backgroundColor: canComplete ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: canComplete ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              cursor: canComplete ? 'pointer' : 'not-allowed',
              opacity: canComplete ? 1 : 0.5,
            }}
          >
            Complete Upgrade
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="text-xs text-center text-(--color-text-muted)"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
