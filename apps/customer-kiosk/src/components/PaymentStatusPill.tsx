/**
 * PaymentStatusPill — Animated status indicator shown during PAYMENT flow.
 *
 * Visual states driven by sessionPayload fields:
 *   pending     — gray pulsing dot  — "Please provide cash or card to the attendant."
 *   authorizing — yellow pulsing dot — "Processing…"  (future server signal)
 *   declined    — red solid dot     — "Card Declined." + sub-message
 *   paid        — green solid dot   — "Payment Complete"
 *
 * Persists through CompleteScreen until the employee finalises the session.
 */

export type PaymentPillStatus = 'pending' | 'authorizing' | 'declined' | 'paid';

interface PaymentStatusPillProps {
  readonly status: PaymentPillStatus;
  /** Shown beneath the pill when status === 'declined' */
  readonly declineReason?: string;
}

interface PillConfig {
  dotColor: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  pulse: boolean;
  label: string;
  sublabel?: string;
}

const CONFIG: Record<PaymentPillStatus, PillConfig> = {
  pending: {
    dotColor: 'rgba(160, 160, 172, 1)',
    bgColor: 'rgba(160, 160, 172, 0.08)',
    borderColor: 'rgba(160, 160, 172, 0.25)',
    textColor: 'rgba(180, 180, 195, 1)',
    pulse: true,
    label: 'Please provide cash or card to the attendant.',
  },
  authorizing: {
    dotColor: '#f59e0b',
    bgColor: 'color-mix(in oklch, var(--color-status-warning) 8%, transparent)',
    borderColor: 'color-mix(in oklch, var(--color-status-warning) 30%, transparent)',
    textColor: '#f59e0b',
    pulse: true,
    label: 'Processing…',
  },
  declined: {
    dotColor: '#ef4444',
    bgColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)',
    borderColor: 'color-mix(in oklch, var(--color-status-error) 30%, transparent)',
    textColor: '#ef4444',
    pulse: false,
    label: 'Card Declined.',
    sublabel: 'Please provide alternate payment method.',
  },
  paid: {
    dotColor: '#22c55e',
    bgColor: 'color-mix(in oklch, var(--color-status-success) 8%, transparent)',
    borderColor: 'color-mix(in oklch, var(--color-status-success) 30%, transparent)',
    textColor: '#22c55e',
    pulse: false,
    label: 'Payment Complete',
  },
};

export function PaymentStatusPill({ status, declineReason }: PaymentStatusPillProps) {
  const cfg = CONFIG[status];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
      }}
    >
      {/* Main pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 999,
          background: cfg.bgColor,
          border: `1px solid ${cfg.borderColor}`,
          transition: 'background 0.4s ease, border-color 0.4s ease',
        }}
      >
        {/* Status dot */}
        <span
          className={cfg.pulse ? 'animate-pulse' : undefined}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: cfg.dotColor,
            flexShrink: 0,
            boxShadow: status === 'pending' ? undefined : `0 0 6px ${cfg.dotColor}`,
            transition: 'background-color 0.4s ease, box-shadow 0.4s ease',
          }}
        />
        {/* Label */}
        <span
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: cfg.textColor,
            letterSpacing: '0.01em',
            transition: 'color 0.4s ease',
          }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Sub-label — only when declined */}
      {status === 'declined' && (
        <p
          style={{
            fontSize: '0.75rem',
            color: 'color-mix(in oklch, var(--color-status-error) 75%, transparent)',
            textAlign: 'center',
            margin: 0,
          }}
        >
          {declineReason ?? cfg.sublabel}
        </p>
      )}
    </div>
  );
}

/** Derive the pill status from kiosk session payload fields. */
// eslint-disable-next-line react-refresh/only-export-components
export function derivePaymentPillStatus(
  paymentStatus: string | undefined,
  paymentFailureReason: string | undefined,
): PaymentPillStatus {
  if (paymentStatus === 'PAID') return 'paid';
  if (paymentFailureReason) return 'declined';
  // 'authorizing' is reserved for a future server signal
  return 'pending';
}
