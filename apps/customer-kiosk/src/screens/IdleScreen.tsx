import { useState, useEffect } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { BrandingHeader } from '../components/BrandingHeader';
import { ChargeItemsList } from '../components/ChargeItemsList';
import { useI18n } from '../i18n';
import { useKioskSession } from '../KioskSessionContext';

/**
 * IdleScreen — Unified idle + check-in display.
 *
 * When idle: logo centered full-size, "Ready for check-in" status.
 * When check-in starts: logo + glow animate to top and shrink,
 * check-in card appears with animated charge items.
 */
export function IdleScreen() {
  const { view, sessionPayload, customerName } = useKioskSession();
  const isCheckinActive = view === 'checkin';
  const { t } = useI18n();

  // Theme detection for logo variant
  const [activeTheme, setActiveTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') ?? '',
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setActiveTheme(document.documentElement.getAttribute('data-theme') ?? ''),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const isLightTheme = ['theme-arctic-bloom', 'theme-solar-flare'].includes(activeTheme);

  // Extract charge data from session payload
  const lineItems = sessionPayload?.ledgerLineItems ?? sessionPayload?.paymentLineItems ?? [];
  const total = sessionPayload?.ledgerTotal ?? sessionPayload?.paymentTotal;
  const flowStep = sessionPayload?.flowStep;
  const paymentStatus = sessionPayload?.paymentStatus;

  const showPaymentInstructions = flowStep === 'PAYMENT' && paymentStatus !== 'PAID';
  const showPaymentReceived = paymentStatus === 'PAID';
  const showTotal = isCheckinActive && flowStep === 'PAYMENT' && total != null && total > 0;

  const isMember = (() => {
    const validUntil = sessionPayload?.customerMembershipValidUntil;
    if (!validUntil) return false;
    return new Date(validUntil + 'T23:59:59') >= new Date();
  })();

  // Card visibility — fades in after logo animation
  const [showCard, setShowCard] = useState(false);
  useEffect(() => {
    if (isCheckinActive) {
      const id = setTimeout(() => setShowCard(true), 2400);
      return () => { clearTimeout(id); setShowCard(false); };
    }
  }, [isCheckinActive]);

  const transition = 'all 2.4s cubic-bezier(0.4, 0, 0.2, 1)';

  return (
    <ScreenShell alignTop={isCheckinActive}>
      <div
        className="flex w-full flex-col items-center"
        style={{ minHeight: '100dvh', position: 'relative' }}
      >
        {/* ── Idle state: centered branding panel ── */}
        {!isCheckinActive && (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-12 text-center p-12"
            style={{ width: '100%' }}
          >
            <BrandingHeader
              isActive={false}
              isLightTheme={isLightTheme}
              brandName={t('brand.clubName')}
              transition={transition}
            />

            <div>
              <h1
                className="text-3xl font-extrabold tracking-tight uppercase"
                style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}
              >
                {t('brand.clubName')}
              </h1>
              <p className="mt-4 text-xl" style={{ color: 'var(--color-text-secondary)' }}>
                Customer Kiosk
              </p>
            </div>

            <div
              className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium"
              style={{
                backgroundColor: 'var(--color-surface-overlay)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ backgroundColor: 'var(--color-status-success)' }}
              />
              {t('idle.readyForCheckin')}
            </div>
          </div>
        )}

        {/* ── Active check-in state ── */}
        {isCheckinActive && (
          <>
            <BrandingHeader
              isActive={true}
              isLightTheme={isLightTheme}
              brandName={t('brand.clubName')}
              transition={transition}
            />

            {/* Check-in Card — fades in after logo animation */}
            <div
              className="flex flex-col"
              style={{
                position: 'absolute',
                top: '55%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                transition: 'opacity 1s ease, transform 1s ease',
                opacity: showCard ? 1 : 0,
                width: '100%',
                maxWidth: 400,
                padding: '0 24px',
                pointerEvents: showCard ? 'auto' : 'none',
              }}
            >
              <div
                className="flex flex-col rounded-xl"
                style={{
                  backgroundColor: 'var(--color-surface-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  overflow: 'hidden',
                }}
              >
                <ChargeItemsList
                  lineItems={lineItems}
                  isActive={isCheckinActive}
                  showTotal={showTotal}
                  total={total}
                  showPaymentInstructions={showPaymentInstructions}
                  showPaymentReceived={showPaymentReceived}
                  isMember={isMember}
                  customerName={customerName}
                />
              </div>
            </div>

            {/* Status indicator — fixed at bottom */}
            <div
              style={{
                position: 'fixed',
                bottom: 48,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
              }}
            >
              <div
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.08)',
                  color: 'var(--color-status-success)',
                  border: '1px solid rgba(34,197,94,0.3)',
                }}
              >
                <div
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ backgroundColor: 'var(--color-status-success)' }}
                />
                Check-in Active
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ScreenShell>
  );
}
