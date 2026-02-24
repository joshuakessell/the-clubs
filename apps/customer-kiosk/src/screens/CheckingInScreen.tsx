import { useState, useEffect } from 'react';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';

interface Props {
  sessionPayload?: SessionUpdatedPayload | null;
}

/**
 * CheckingInScreen — Passive display shown while the employee
 * handles the check-in process. Shows "Checking In..." with 
 * animated ellipsis and real-time charges as they appear.
 */
export function CheckingInScreen({ sessionPayload }: Props) {
  const { t } = useI18n();
  const [dotCount, setDotCount] = useState(0);

  // Animate the ellipsis: cycle 0→1→2→3→0
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const dots = '.'.repeat(dotCount);
  // Reserve space for 3 dots so text doesn't shift
  const invisibleDots = '.'.repeat(3 - dotCount);

  const lineItems = sessionPayload?.ledgerLineItems ?? sessionPayload?.paymentLineItems ?? [];
  const total = sessionPayload?.ledgerTotal ?? sessionPayload?.paymentTotal;
  const flowStep = sessionPayload?.flowStep;
  const paymentStatus = sessionPayload?.paymentStatus;

  // Show payment instructions when we're on the PAYMENT step and not yet paid
  const showPaymentInstructions = flowStep === 'PAYMENT' && paymentStatus !== 'PAID';
  const showPaymentReceived = paymentStatus === 'PAID';

  return (
    <ScreenShell>
      <div className="flex flex-col items-center gap-8 text-center p-8 w-full max-w-md">
        {/* Animated "Checking In..." */}
        <div className="flex flex-col items-center gap-4">
          <h1
            className="text-4xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            <span>Checking In</span>
            <span>{dots}</span>
            <span style={{ visibility: 'hidden' }}>{invisibleDots}</span>
          </h1>

          {showPaymentReceived && (
            <div
              className="flex items-center gap-2 rounded-lg px-4 py-2"
              style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
            >
              <span style={{ color: 'var(--color-status-success)' }}>✓</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
                Payment Received
              </span>
            </div>
          )}
        </div>

        {/* Line items — appear as employee selects them */}
        {lineItems.length > 0 && (
          <div
            className="w-full rounded-xl border p-5"
            style={{
              backgroundColor: 'var(--color-surface-overlay)',
              borderColor: 'var(--color-border-subtle)',
            }}
          >
            <div className="flex flex-col gap-3">
              {lineItems.map((item: { description: string; amount: number }, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--color-text-secondary)' }}>{item.description}</span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    ${(item.amount / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total — shows when available */}
            {total != null && total > 0 && (
              <div
                className="mt-4 flex items-center justify-between border-t pt-3"
                style={{ borderColor: 'var(--color-border-default)' }}
              >
                <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  Total Due
                </span>
                <span
                  className="text-xl font-bold tabular-nums"
                  style={{ color: 'var(--color-accent-primary)' }}
                >
                  ${(total / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payment instruction */}
        {showPaymentInstructions && total != null && total > 0 && (
          <p
            className="text-sm font-medium animate-pulse"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Please provide payment to the attendant.
          </p>
        )}
      </div>
    </ScreenShell>
  );
}
