import { useEffect, useState } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';
import { useKioskSession } from '../KioskSessionContext';

const COUNTDOWN_SECONDS = 5;

/**
 * CompleteScreen — Room/locker assignment display.
 *
 * Phase 1 (ASSIGNMENT): Shows room number + checkout time.
 *   Updates in real-time if the employee changes the room assignment.
 *
 * Phase 2 (COMPLETED): Employee clicked "Complete Checkin".
 *   A visible 5-second countdown appears, then the kiosk resets to idle.
 */
export function CompleteScreen() {
  const { sessionPayload, customerName, reset } = useKioskSession();
  const assignedResourceType = sessionPayload?.assignedResourceType;
  const assignedResourceNumber = sessionPayload?.assignedResourceNumber;
  const { t } = useI18n();

  const isCompleted = sessionPayload?.status === 'COMPLETED';
  const [countdown, setCountdown] = useState<number | null>(null);

  // When session transitions to COMPLETED, start the countdown via a timer
  useEffect(() => {
    if (!isCompleted) return;
    // Use a micro-delay so setState happens in the timer callback, not synchronously in the effect body
    const id = setTimeout(() => setCountdown(COUNTDOWN_SECONDS), 0);
    return () => clearTimeout(id);
  }, [isCompleted]);

  // Tick the countdown each second
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      reset();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, reset]);

  const isLocker = assignedResourceType === 'locker';

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
          {customerName
            ? t('complete.allSetWithName', { name: customerName })
            : t('complete.allSet')}
        </h1>

        {/* Assignment card — large room number + checkout time */}
        <div
          className="w-full rounded-2xl border p-6"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {isLocker ? t('complete.yourLocker') : t('complete.yourRoom')}
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
                {t('complete.checkoutBy')}
              </p>
              <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                11:00 PM
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('complete.today')}
              </p>
            </div>
          </div>
        </div>

        {/* Countdown or status message */}
        {countdown !== null ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              Returning to home in
            </p>
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-extrabold tabular-nums"
              style={{
                backgroundColor: 'rgba(0, 212, 255, 0.08)',
                border: '2px solid var(--color-border-accent)',
                color: 'var(--color-accent-primary)',
                fontFamily: 'var(--font-display)',
              }}
            >
              {countdown}
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Please enjoy your visit!
          </p>
        )}
      </div>
    </ScreenShell>
  );
}
