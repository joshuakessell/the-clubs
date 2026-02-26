import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';
import { useKioskSession } from '../KioskSessionContext';

/**
 * CompleteScreen — Room/locker assignment display.
 * Maps to the ASSIGNMENT step: shows room number + checkout time.
 * Remains visible until cleared by the employee (no auto-countdown).
 * Updates in real-time if the employee changes the room assignment.
 */
export function CompleteScreen() {
  const { sessionPayload, customerName } = useKioskSession();
  const assignedResourceType = sessionPayload?.assignedResourceType;
  const assignedResourceNumber = sessionPayload?.assignedResourceNumber;
  const { t } = useI18n();

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

        {/* Status message */}
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Please enjoy your visit!
        </p>
      </div>
    </ScreenShell>
  );
}
