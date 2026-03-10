import { useState, useEffect, useRef, useCallback } from 'react';
import { PaymentStatusPill, derivePaymentPillStatus } from './PaymentStatusPill';

interface ChargeItem {
  description: string;
  amount: number;
  /** Animation state for this individual item */
  phase: 'hidden' | 'fading-in' | 'visible' | 'fading-out';
}

interface ChargeItemsListProps {
  lineItems: Array<{ description: string; amount: number }>;
  isActive: boolean;
  showTotal: boolean;
  total: number | null | undefined;
  showPaymentInstructions: boolean;
  showPaymentReceived: boolean;
  isMember: boolean;
  customerName: string;
  orderStatus?: string;
  paymentFailureReason?: string;
}

/**
 * ChargeItemsList — Animated charge items display.
 *
 * Handles sequential fade-in animations on initial checkin,
 * instant updates for subsequent item changes, total due
 * display, and payment status messages.
 */
export function ChargeItemsList({
  lineItems,
  isActive,
  showTotal,
  total,
  showPaymentInstructions,
  showPaymentReceived,
  isMember,
  customerName,
  orderStatus,
  paymentFailureReason,
}: ChargeItemsListProps) {
  const pillStatus = derivePaymentPillStatus(orderStatus, paymentFailureReason);
  // ── Animation state machine ──
  const [chargeItems, setChargeItems] = useState<ChargeItem[]>([]);
  const prevKeyRef = useRef('');
  const wasActiveRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  useEffect(() => clearTimers, [clearTimers]);

  // Reset on deactivation
  useEffect(() => {
    if (!isActive) {
      clearTimers();
      setChargeItems([]);
      prevKeyRef.current = '';
      wasActiveRef.current = false;
    }
  }, [isActive, clearTimers]);

  // Initial check-in start — sequential fade-in
  useEffect(() => {
    if (!isActive || wasActiveRef.current) return;
    wasActiveRef.current = true;
    if (lineItemsKey === '') return;

    const items: ChargeItem[] = lineItems.map((item) => ({
      description: item.description,
      amount: item.amount,
      phase: 'hidden' as const,
    }));
    setChargeItems(items);
    prevKeyRef.current = lineItemsKey;

    clearTimers();
    items.forEach((_, index) => {
      addTimer(() => {
        setChargeItems((prev) =>
          prev.map((item, i) => (i === index ? { ...item, phase: 'fading-in' } : item)),
        );
        addTimer(() => {
          setChargeItems((prev) =>
            prev.map((item, i) => (i === index ? { ...item, phase: 'visible' } : item)),
          );
        }, 1000);
      }, index * 300);
    });

    return () => {
      wasActiveRef.current = false;
      prevKeyRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, lineItemsKey]);

  // Items arriving for the first time after check-in already started — instant
  useEffect(() => {
    if (!isActive || !wasActiveRef.current) return;
    if (prevKeyRef.current !== '' || lineItemsKey === '') return;

    prevKeyRef.current = lineItemsKey;
    setChargeItems(
      lineItems.map((item) => ({
        description: item.description,
        amount: item.amount,
        phase: 'visible' as const,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, lineItemsKey]);

  // Item changes during active check-in — diff and fade in new ones
  useEffect(() => {
    if (!isActive || !wasActiveRef.current) return;
    if (lineItemsKey === '' || lineItemsKey === prevKeyRef.current) return;

    clearTimers();
    prevKeyRef.current = lineItemsKey;

    setChargeItems((prev) => {
      const existingMap = new Map<string, ChargeItem>();
      prev.forEach((item, index) => {
        existingMap.set(`${item.description}-${index}`, item);
      });

      const nextItems: ChargeItem[] = lineItems.map((newItem, index) => {
        const key = `${newItem.description}-${index}`;
        if (existingMap.has(key)) return existingMap.get(key)!;
        return { description: newItem.description, amount: newItem.amount, phase: 'hidden' as const };
      });

      const addedIndices = nextItems
        .map((item, index) => (item.phase === 'hidden' ? index : -1))
        .filter((index) => index !== -1);

      if (addedIndices.length > 0) {
        addTimer(() => {
          setChargeItems((current) =>
            current.map((item, index) =>
              addedIndices.includes(index) ? { ...item, phase: 'fading-in' } : item,
            ),
          );
          addTimer(() => {
            setChargeItems((current) =>
              current.map((item, index) =>
                addedIndices.includes(index) ? { ...item, phase: 'visible' } : item,
              ),
            );
          }, 1000);
        }, 50);
      }

      return nextItems;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, lineItemsKey]);

  // ── Delayed total unmount ──
  const [totalVisible, setTotalVisible] = useState(false);
  const totalFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (showTotal) {
      if (totalFadeTimerRef.current) clearTimeout(totalFadeTimerRef.current);
      setTotalVisible(true);
    } else if (totalVisible) {
      totalFadeTimerRef.current = setTimeout(() => setTotalVisible(false), 1000);
    }
    return () => { if (totalFadeTimerRef.current) clearTimeout(totalFadeTimerRef.current); };
  }, [showTotal]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <>
      {/* Card header */}
      <div
        className="py-3 px-5"
        style={{
          backgroundColor: 'var(--color-surface-overlay)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {isMember ? `Welcome back, ${customerName}!` : `Welcome, ${customerName}`}
        </p>
      </div>

      {/* Card body */}
      <div className="p-5 flex flex-col gap-4">
        {/* Charge items */}
        {chargeItems.map((item, i) => {
          const opacity = item.phase === 'fading-in' || item.phase === 'visible' ? 1 : 0;
          const itemTransition = item.phase === 'fading-in' ? 'opacity 1s ease, transform 1s ease' : 'none';
          const translateY = item.phase === 'hidden' ? 8 : 0;

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
                  fontStyle: item.description.includes('(waitlist)') ? 'italic' : undefined,
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
                {'$' + item.amount.toFixed(2)}
              </span>
            </div>
          );
        })}

        {/* Total Due */}
        {totalVisible && total != null && (
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
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
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
              {'$' + total.toFixed(2)}
            </span>
          </div>
        )}

        {/* Payment status pill */}
        {showPaymentInstructions && total != null && total > 0 && (
          <PaymentStatusPill
            status={pillStatus}
            declineReason={paymentFailureReason}
          />
        )}

        {/* Payment received */}
        {showPaymentReceived && (
          <div
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
              border: '1px solid color-mix(in oklch, var(--color-status-success) 30%, transparent)',
              animation: 'fadeSlideIn 0.4s ease both',
              marginTop: 8,
            }}
          >
            <span style={{ color: 'var(--color-status-success)' }}>✓</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
              Payment Received
            </span>
          </div>
        )}

        {/* Welcome message for members with no charges */}
        {!(isActive && lineItems.length > 0) && !showTotal && isMember && (
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
    </>
  );
}
