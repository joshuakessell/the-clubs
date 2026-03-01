import { useState, useEffect, useRef, useCallback } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';
import { useKioskSession } from '../KioskSessionContext';

interface ChargeItem {
  description: string;
  amount: number;
  /** Animation state for this individual item */
  phase: 'hidden' | 'fading-in' | 'visible' | 'fading-out';
}

/**
 * IdleScreen — Unified idle + check-in display.
 *
 * When idle: logo centered full-size, "Please Present a valid form of ID".
 * When check-in starts: logo + glow animate to top and shrink 50%,
 * header follows, prompt fades out, charges fade in center-screen.
 *
 * Charge animations:
 *  - Items appear sequentially (past-due → membership → rental)
 *  - Each item fades in over 1s, with 0.3s delay between items
 *  - When rental is selected, existing items slide up, new item fades in below
 *  - On fee swap (daily→6mo): 1s fade-out, 0.5s pause, 1s fade-in
 *  - Items displayed on single lines: "Membership Fee    $13.00"
 *  - Dollar amounts right-aligned for visual alignment
 */
export function IdleScreen() {
  const { view, sessionPayload, customerName } = useKioskSession();
  const isCheckinActive = view === 'checkin';
  const { t } = useI18n();

  // Theme detection for logo variant
  const [activeTheme, setActiveTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') ?? ''
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setActiveTheme(document.documentElement.getAttribute('data-theme') ?? '')
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

  // Determine what to show in the charge area
  const showPaymentInstructions = flowStep === 'PAYMENT' && paymentStatus !== 'PAID';
  const showPaymentReceived = paymentStatus === 'PAID';

  // Check if customer is a member (has valid membership)
  const isMember = (() => {
    const validUntil = sessionPayload?.customerMembershipValidUntil;
    if (!validUntil) return false;
    return new Date(validUntil + 'T23:59:59') >= new Date();
  })();

  // Determine if charges should be visible
  const showCharges = isCheckinActive && (lineItems.length > 0 || (!isMember && flowStep === 'LANGUAGE'));
  const showTotal = isCheckinActive && flowStep === 'PAYMENT' && total != null && total > 0;

  // Delayed unmount for Total Due fade-out (keeps element mounted for 1s after showTotal → false)
  const [totalVisible, setTotalVisible] = useState(false);
  const totalFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (showTotal) {
      // Show immediately
      if (totalFadeTimerRef.current) clearTimeout(totalFadeTimerRef.current);
      setTotalVisible(true);
    } else if (totalVisible) {
      // Delay unmount by 1s so the fade-out transition plays
      totalFadeTimerRef.current = setTimeout(() => setTotalVisible(false), 1000);
    }
    return () => { if (totalFadeTimerRef.current) clearTimeout(totalFadeTimerRef.current); };
  }, [showTotal]);

  // ── Card visibility – fades in after logo animation ──
  const [showCard, setShowCard] = useState(false);
  useEffect(() => {
    if (isCheckinActive) {
      const id = setTimeout(() => setShowCard(true), 2400);
      return () => clearTimeout(id);
    } else {
      setShowCard(false);
    }
  }, [isCheckinActive]);

  // ── Charge items animation state machine ──
  const [chargeItems, setChargeItems] = useState<ChargeItem[]>([]);
  const [groupSlideOffset, setGroupSlideOffset] = useState(0);
  const prevKeyRef = useRef('');
  const wasActiveRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Stable serialized key for current line items
  const lineItemsKey = lineItems.length > 0 ? JSON.stringify(lineItems) : '';

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  // Handle check-in deactivation — reset everything
  useEffect(() => {
    if (!isCheckinActive) {
      clearTimers();
      setChargeItems([]);
      setGroupSlideOffset(0);
      prevKeyRef.current = '';
      wasActiveRef.current = false;
    }
  }, [isCheckinActive, clearTimers]);

  // Handle initial check-in start — sequential fade-in after logo animation
  useEffect(() => {
    if (!isCheckinActive || wasActiveRef.current) return;
    wasActiveRef.current = true;

    if (lineItemsKey === '') return;

    // Set items as hidden initially
    const items: ChargeItem[] = lineItems.map((item) => ({
      description: item.description,
      amount: item.amount,
      phase: 'hidden' as const,
    }));
    setChargeItems(items);
    prevKeyRef.current = lineItemsKey;

    // Fade in items sequentially without delay
    clearTimers();
    items.forEach((_, index) => {
      addTimer(() => {
        setChargeItems((prev) =>
          prev.map((item, i) =>
            i === index ? { ...item, phase: 'fading-in' } : item
          )
        );
        // Mark as visible after 1s fade
        addTimer(() => {
          setChargeItems((prev) =>
            prev.map((item, i) =>
              i === index ? { ...item, phase: 'visible' } : item
            )
          );
        }, 1000);
      }, index * 300); // 0.3s stagger between items
    });

    // Reset on cleanup so StrictMode re-mount can re-schedule animations
    return () => {
      wasActiveRef.current = false;
      prevKeyRef.current = '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckinActive, lineItemsKey]);

  // Handle items arriving for the first time after check-in already started — instant
  useEffect(() => {
    if (!isCheckinActive || !wasActiveRef.current) return;
    if (prevKeyRef.current !== '' || lineItemsKey === '') return;

    prevKeyRef.current = lineItemsKey;
    setChargeItems(
      lineItems.map((item) => ({
        description: item.description,
        amount: item.amount,
        phase: 'visible' as const,
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckinActive, lineItemsKey]);

  // Handle item changes during active check-in — instant update (no animation)
  useEffect(() => {
    if (!isCheckinActive || !wasActiveRef.current) return;
    if (lineItemsKey === '' || lineItemsKey === prevKeyRef.current) return;

    clearTimers();
    prevKeyRef.current = lineItemsKey;

    // Calculate new items that were added
    setChargeItems((prev) => {
      // Create a map of existing items for easy lookup
      const existingMap = new Map();
      prev.forEach((item, index) => {
        // Use index as part of key to handle duplicate descriptions
        existingMap.set(`${item.description}-${index}`, item);
      });

      // Build the new state, keeping existing items and adding new ones as hidden
      const nextItems: ChargeItem[] = lineItems.map((newItem, index) => {
        const key = `${newItem.description}-${index}`;
        if (existingMap.has(key)) {
          // Keep existing item (preserves its visible phase)
          return existingMap.get(key);
        } else {
          // New item starts hidden, we'll fade it in
          return {
            description: newItem.description,
            amount: newItem.amount,
            phase: 'hidden' as const,
          };
        }
      });

      // Find indices of newly added items to schedule their fade-in
      const addedIndices = nextItems
        .map((item, index) => (item.phase === 'hidden' ? index : -1))
        .filter((index) => index !== -1);

      if (addedIndices.length > 0) {
        addTimer(() => {
          setChargeItems((current) =>
            current.map((item, index) =>
              addedIndices.includes(index) ? { ...item, phase: 'fading-in' } : item
            )
          );
          // Mark as fully visible after animation
          addTimer(() => {
            setChargeItems((current) =>
              current.map((item, index) =>
                addedIndices.includes(index) ? { ...item, phase: 'visible' } : item
              )
            );
          }, 1000);
        }, 50); // Small delay to ensure render happens with 'hidden' class first
      }

      return nextItems;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckinActive, lineItemsKey]);

  // ── Shared transition timing ──
  const transition = 'all 2.4s cubic-bezier(0.4, 0, 0.2, 1)';

  // Any charge items that aren't fully hidden
  const hasVisibleCharges = chargeItems.some((it) => it.phase !== 'hidden');

  return (
    <ScreenShell alignTop={isCheckinActive}>
      <div
        className="flex w-full flex-col items-center"
        style={{
          minHeight: '100dvh',
          position: 'relative',
        }}
      >
        {/* ── Logo + Glow Group ──────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transition,
            ...(isCheckinActive
              ? {
                  paddingTop: 28,
                  transform: 'scale(0.65)',
                  transformOrigin: 'top center',
                }
              : {
                  paddingTop: 'calc(50dvh - 186px)',
                  transform: 'scale(1)',
                  transformOrigin: 'top center',
                }),
          }}
        >
          {/* Glow ring */}
          <div className="relative">
            <div
              className="absolute inset-4 rounded-full animate-pulse"
              style={{
                boxShadow: '0 0 100px 40px var(--color-accent-glow)',
                opacity: 0.55,
                transition,
              }}
            />
            <div className="relative flex items-center justify-center">
              <img
                src={isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg'}
                alt={t('brand.clubName')}
                className="kiosk-logo"
                width="240"
                height="240"
                style={{
                  width: 240,
                  height: 240,
                  filter: 'drop-shadow(0 0 20px var(--color-accent-glow))',
                  transform: isCheckinActive ? 'translateY(-12px)' : undefined,
                  transition,
                }}
              />
            </div>
          </div>

          {/* Brand name — follows logo */}
          <h1
            className="mt-6 text-5xl font-extrabold tracking-tight uppercase"
            style={{
              fontFamily: 'var(--font-brand)',
              color: 'var(--color-text-primary)',
              transition,
            }}
          >
            {t('brand.clubName')}
          </h1>
        </div>

        {/* ── ID Prompt — fades out in place when check-in active ──── */}
        <p
          className="mt-6 text-xl"
          style={{
            color: 'var(--color-text-secondary)',
            transition: 'opacity 2.4s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: isCheckinActive ? 0 : 1,
            pointerEvents: isCheckinActive ? 'none' : 'auto',
          }}
        >
          {t('idle.presentId')}
        </p>

        {/* ── Check-in Card — fades in after logo animation ──────── */}
        {isCheckinActive && (
          <div
            className="flex flex-col"
            style={{
              position: 'absolute',
              top: '55%',
              left: '50%',
              transform: `translate(-50%, -50%) translateY(${groupSlideOffset}px)`,
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
              {/* Card header */}
              <div
                className="py-3 px-5"
                style={{
                  backgroundColor: 'var(--color-surface-overlay)',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <p
                  className="text-base font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {isMember ? `Welcome back, ${customerName}!` : `Welcome, ${customerName}`}
                </p>
              </div>

              {/* Card body — charge items, total, payment messages */}
              <div className="p-5 flex flex-col gap-4">
                {/* Charge items */}
                {chargeItems.map((item, i) => {
                  const opacity =
                    item.phase === 'fading-in' || item.phase === 'visible' ? 1 : 0;
                  const itemTransition =
                    item.phase === 'fading-in'
                      ? 'opacity 1s ease, transform 1s ease'
                      : 'none';
                  const translateY =
                    item.phase === 'hidden' ? 8 : 0;

                  return (
                    <div
                      key={`${item.description}-${i}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        width: '100%',
                        opacity,
                        transform: `translateY(${translateY}px)`,
                        transition: itemTransition,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '1.3rem',
                          fontWeight: 500,
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.description}
                      </span>
                      <span
                        style={{
                          fontSize: '1.3rem',
                          fontWeight: 700,
                          color: 'var(--color-text-primary)',
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                          marginLeft: 16,
                          minWidth: 72,
                          textAlign: 'right',
                        }}
                      >
                        ${item.amount.toFixed(2)}
                      </span>
                    </div>
                  );
                })}

                {/* ── Total Due — for payment step, fade in/out ──────── */}
                {totalVisible && total != null && (
                  <>
                    <div
                      style={{
                        borderTop: '1px solid var(--color-border-subtle)',
                        marginTop: 4,
                        paddingTop: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        width: '100%',
                        transition: 'opacity 1s ease, transform 1s ease',
                        opacity: showTotal ? 1 : 0,
                        transform: showTotal ? 'translateY(0)' : 'translateY(12px)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '1.5rem',
                          fontWeight: 700,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        Total Due
                      </span>
                      <span
                        style={{
                          fontSize: '1.5rem',
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--color-accent-primary)',
                          marginLeft: 16,
                          minWidth: 72,
                          textAlign: 'right' as const,
                        }}
                      >
                        ${total.toFixed(2)}
                      </span>
                    </div>
                  </>
                )}

                {/* Payment instruction */}
                {showPaymentInstructions && total != null && total > 0 && (
                  <p
                    className="text-sm font-medium"
                    style={{
                      color: 'var(--color-text-muted)',
                      animation: 'fadeSlideIn 0.5s ease 0.5s both',
                      textAlign: 'center',
                      marginTop: 8,
                    }}
                  >
                    Please provide cash or card to the attendant.
                  </p>
                )}

                {/* Payment received */}
                {showPaymentReceived && (
                  <div
                    className="flex items-center justify-center gap-2 rounded-lg px-4 py-2"
                    style={{
                      backgroundColor: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.3)',
                      animation: 'fadeSlideIn 0.4s ease both',
                      marginTop: 8,
                    }}
                  >
                    <span style={{ color: 'var(--color-status-success)' }}>✓</span>
                    <span
                      className="text-sm font-semibold"
                      style={{ color: 'var(--color-status-success)' }}
                    >
                      Payment Received
                    </span>
                  </div>
                )}

                {/* Welcome message for members with no charges */}
                {!showCharges && !showTotal && isMember && (
                  <p
                    className="text-sm"
                    style={{
                      color: 'var(--color-text-muted)',
                      opacity: 0.7,
                      animation: 'fadeSlideIn 0.5s ease 0.3s both',
                      textAlign: 'center',
                    }}
                  >
                    Welcome back! Your attendant is preparing your visit.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Status indicator — fixed at bottom, never moves ──── */}
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
              backgroundColor: isCheckinActive
                ? 'rgba(34,197,94,0.08)'
                : 'var(--color-surface-overlay)',
              color: isCheckinActive
                ? 'var(--color-status-success)'
                : 'var(--color-text-muted)',
              border: isCheckinActive
                ? '1px solid rgba(34,197,94,0.3)'
                : '1px solid var(--color-border-subtle)',
            }}
          >
            <div
              className={`h-2 w-2 rounded-full ${isCheckinActive ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: isCheckinActive
                  ? 'var(--color-status-success)'
                  : 'var(--color-text-muted)',
                opacity: isCheckinActive ? 1 : 0.3,
              }}
            />
            {isCheckinActive ? 'Check-in Active' : t('idle.readyForCheckin')}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </ScreenShell>
  );
}
