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

  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const isWaitlist = !!sessionPayload?.waitlistDesiredType;
  const showDisclaimerModal = isWaitlist && flowStep === 'PAYMENT' && !disclaimerAccepted;

  if (showDisclaimerModal) {
    const desiredType = sessionPayload?.waitlistDesiredType;
    const rentalLabel: Record<string, string> = {
      LOCKER: 'Locker',
      STANDARD: 'Standard Room',
      DOUBLE: 'Double Room',
      SPECIAL: 'Special Room',
      GYM_LOCKER: 'Gym Locker',
    };
    const desiredRentalLabel = desiredType ? rentalLabel[desiredType] || desiredType : 'Room';
    
    const position = sessionPayload?.waitlistPosition ?? t('waitlist.unknown');
    let estimatedTime = t('waitlist.unknown');
    if (sessionPayload?.waitlistEstimatedReadyAt) {
      const waitTimeObj = new Date(sessionPayload.waitlistEstimatedReadyAt);
      estimatedTime = waitTimeObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    return (
      <ScreenShell showWatermark>
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="flex w-full max-w-lg flex-col items-center gap-6 p-10 rounded-3xl shadow-2xl" style={{ backgroundColor: 'var(--color-surface-raised)', border: '1px solid var(--color-border-default)' }}>
            <div className="text-center">
              <h1
                className="text-3xl font-extrabold tracking-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
                {t('waitlist.modalTitle')}
              </h1>
              <p className="mt-3 text-lg font-semibold" style={{ color: 'var(--color-status-error)' }}>
                {t('waitlist.currentlyUnavailable', { rental: desiredRentalLabel })}
              </p>
            </div>

            <div
              className="w-full rounded-2xl border p-5 mt-2"
              style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
            >
              <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
                {t('waitlist.infoTitle')}
              </h2>
              
              <div className="flex justify-between items-center mb-3">
                <span className="text-base font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('waitlist.position')}</span>
                <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{position}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-base font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('waitlist.estimatedReady')}</span>
                <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{estimatedTime}</span>
              </div>
            </div>

            <div
              className="w-full rounded-xl p-5"
              style={{ backgroundColor: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.3)' }}
            >
              <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--color-status-warning)' }}>
                {t('waitlist.noteChargedBackup')}
              </p>
            </div>

            <button
              type="button"
              className="w-full mt-4 rounded-xl px-6 py-4 text-lg font-bold transition"
              style={{
                backgroundColor: 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
                boxShadow: '0 0 20px var(--color-accent-glow)',
              }}
              onClick={() => setDisclaimerAccepted(true)}
            >
              {t('acknowledge')}
            </button>
          </div>
        </div>
      </ScreenShell>
    );
  }

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
                    ${item.amount.toFixed(2)}
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
                  ${total.toFixed(2)}
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
