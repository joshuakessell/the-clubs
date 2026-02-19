import { ScreenShell } from '../components/ScreenShell';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

interface LineItem {
  description: string;
  amount: number;
}

const MOCK_ITEMS: LineItem[] = [
  { description: 'Room Rental — Standard', amount: 35.00 },
  { description: 'Towel', amount: 2.00 },
];

const TOTAL = MOCK_ITEMS.reduce((sum, li) => sum + li.amount, 0);

function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/**
 * PaymentScreen — Shows charges breakdown and payment status.
 * In production, an external card terminal collects payment.
 * This screen just displays total and waits for completion.
 */
export function PaymentScreen({ onComplete, onCancel }: Props) {
  return (
    <ScreenShell showWatermark>
      <div className="flex w-full max-w-md flex-col items-center gap-8 px-6 py-12">
        {/* Charges card */}
        <div
          className="w-full rounded-2xl border p-6"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Your Charges
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {MOCK_ITEMS.map((li, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{li.description}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatAmount(li.amount)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Total Due</span>
              <span
                className="text-2xl font-extrabold tabular-nums"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}
              >
                {formatAmount(TOTAL)}
              </span>
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full animate-pulse"
            style={{
              backgroundColor: 'rgba(0, 212, 255, 0.08)',
              border: '2px solid var(--color-border-accent)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Insert or tap card on terminal
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for payment...
          </p>
        </div>

        {/* Actions */}
        <div className="flex w-full gap-3">
          <button
            type="button"
            className="flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg px-6 py-4 text-base font-bold transition"
            style={{
              backgroundColor: 'var(--color-status-success)',
              color: 'white',
            }}
            onClick={onComplete}
          >
            Demo: Complete
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
