/**
 * LateFeeModal — shared late fee settlement dialog.
 * Used by both the Checkout panel and the Profile tab when a customer
 * has overstayed by enough minutes to incur a late fee.
 */

export type LateFeeDetails = {
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
};

export function LateFeeModal({
  customerLabel,
  resolved,
  onSettle,
  onDismiss,
  isProcessing,
}: Readonly<{
  /** Display label (e.g. "John Doe" or "John Doe · ROOM 12") */
  customerLabel: string;
  resolved: LateFeeDetails;
  onSettle: (payAtCheckout: boolean, paymentMethod?: 'CREDIT' | 'CASH') => void;
  onDismiss: () => void;
  isProcessing: boolean;
}>) {
  const feeDollars = resolved.fee.toFixed(2);

  const greenBtn = {
    backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
    color: 'var(--color-status-success)',
    border: '1px solid color-mix(in oklch, var(--color-status-success) 25%, transparent)',
    cursor: isProcessing ? 'not-allowed' : 'pointer',
    transition: 'opacity 0.15s ease',
    opacity: isProcessing ? 0.5 : 1,
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
    >
      <dialog
        open
        aria-labelledby="late-fee-title"
        className="w-full max-w-md rounded-xl border shadow-2xl relative bg-(--color-surface-raised) border-(--color-border-default)"
      >
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-sm"
          aria-label="Close modal"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-(--color-border-subtle)">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--color-status-error)_10%,transparent)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 id="late-fee-title" className="text-base font-bold text-(--color-text-primary) font-(--font-display)">
                Late Checkout Fee
              </h3>
              <p className="text-xs text-(--color-text-muted)">
                {customerLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)',
              border: '1px solid color-mix(in oklch, var(--color-status-error) 15%, transparent)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-(--color-text-secondary)">Late by</span>
              <span className="text-sm font-bold text-(--color-status-error)">{resolved.lateMinutes} minutes</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-(--color-text-secondary)">Fee due</span>
              <span className="text-xl font-bold tabular-nums text-(--color-status-error) font-(--font-display)">${feeDollars}</span>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-(--color-text-secondary)">
            {resolved.banApplied
              ? `This customer checked out ${resolved.lateMinutes} minutes late. A $${feeDollars} late fee applies and a potential 30-day ban has been flagged for manager review. Collect the fee now or it will be added as a past-due balance, which must be settled before the customer's next check-in.`
              : `This customer checked out ${resolved.lateMinutes} minutes late. A $${feeDollars} late fee applies. Collect the fee now or it will be added as a past-due balance, which must be settled before the customer's next check-in.`}
          </p>

          {/* Payment buttons */}
          <div className="flex gap-3">
            <button
              disabled={isProcessing}
              onClick={() => onSettle(true, 'CREDIT')}
              className="flex-1 rounded-lg py-3 text-sm font-bold flex flex-col items-center gap-1"
              style={greenBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
              Pay by Card
            </button>
            <button
              disabled={isProcessing}
              onClick={() => onSettle(true, 'CASH')}
              className="flex-1 rounded-lg py-3 text-sm font-bold flex flex-col items-center gap-1"
              style={greenBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
              Pay by Cash
            </button>
          </div>

          {/* Skip / past due */}
          <div className="text-center pt-1 border-t border-(--color-border-subtle)">
            <button
              disabled={isProcessing}
              onClick={() => onSettle(false)}
              className="text-xs py-2 px-4"
              style={{
                color: 'var(--color-text-muted)',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: 'none',
                border: 'none',
                transition: 'opacity 0.15s ease',
                opacity: isProcessing ? 0.5 : 1,
              }}
            >
              Skip — Add ${feeDollars} to Past Due Balance
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
