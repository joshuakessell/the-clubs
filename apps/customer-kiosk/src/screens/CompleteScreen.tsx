import { useEffect, useState } from 'react';
import { ScreenShell } from '../components/ScreenShell';

interface Props {
  customerName?: string;
  assignedResourceType?: string | null;
  assignedResourceNumber?: string | null;
  onDone: () => void;
}

/**
 * CompleteScreen — Room/locker assignment confirmation.
 * Auto-resets to idle after a timeout (demo: 10s).
 */
export function CompleteScreen({ customerName, assignedResourceType, assignedResourceNumber, onDone }: Props) {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (countdown <= 0) { onDone(); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onDone]);

  return (
    <ScreenShell showWatermark>
      <div className="flex w-full max-w-md flex-col items-center gap-8 px-6 py-12 text-center">
        {/* Success icon */}
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '2px solid rgba(16, 185, 129, 0.3)',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1
          className="text-3xl font-extrabold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
        >
          You{customerName ? `'re All Set, ${customerName}` : "'re All Set"}!
        </h1>

        {/* Assignment card */}
        <div
          className="w-full rounded-2xl border p-6"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                Your {assignedResourceType === 'locker' ? 'Locker' : 'Room'}
              </p>
              <p
                className="mt-1 text-5xl font-extrabold tabular-nums"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}
              >
                {assignedResourceNumber ?? '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                Checkout By
              </p>
              <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                11:00 PM
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Today
              </p>
            </div>
          </div>
        </div>

        {/* OK button with countdown */}
        <button
          type="button"
          className="w-full rounded-xl px-8 py-5 text-lg font-bold transition"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
            boxShadow: '0 0 20px var(--color-accent-glow)',
          }}
          onClick={onDone}
        >
          OK ({countdown}s)
        </button>
      </div>
    </ScreenShell>
  );
}
