import { useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';

interface Props {
  laneId: string;
  kioskToken?: string | null;
  sessionPayload?: SessionUpdatedPayload | null;
  onComplete: () => void;
  onCancel: () => void;
}

interface LineItem {
  description: string;
  amount: number;
}

function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/**
 * PaymentScreen — Shows charges breakdown with split payment option.
 * Displays real line items from the session's price quote.
 * In production, an external card terminal collects payment.
 */
export function PaymentScreen({ laneId, kioskToken, sessionPayload, onComplete, onCancel }: Props) {
  const { t } = useI18n();
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [splitAmount, setSplitAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* ── Parse real line items from session payload ── */
  const lineItems: LineItem[] = sessionPayload?.paymentLineItems ?? [
    { description: 'Room Rental — Standard', amount: 35.0 },
    { description: 'Towel', amount: 2.0 },
  ];
  const total = sessionPayload?.paymentTotal ?? lineItems.reduce((sum, li) => sum + li.amount, 0);

  /* ── Demo: Take payment ── */
  const demoTakePayment = useCallback(
    async (outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS', splitCardAmount?: number) => {
      setSubmitting(true);
      try {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (kioskToken) h['Authorization'] = `Bearer ${kioskToken}`;

        const body: Record<string, unknown> = {
          outcome,
          sessionId: sessionPayload?.sessionId,
        };
        if (splitCardAmount !== undefined && splitCardAmount > 0) {
          body.splitCardAmount = splitCardAmount;
        }

        const res = await fetch(
          getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/demo-take-payment`),
          { method: 'POST', headers: h, body: JSON.stringify(body) }
        );

        if (!res.ok) {
          console.error('[PaymentScreen] Payment failed', await res.text());
        }
        onComplete();
      } catch (err) {
        console.error('[PaymentScreen] Error taking payment', err);
      } finally {
        setSubmitting(false);
        setShowSplitDialog(false);
      }
    },
    [kioskToken, laneId, sessionPayload?.sessionId, onComplete]
  );

  /* ── Split payment helpers ── */
  const parsedSplit = parseFloat(splitAmount) || 0;
  const cashDue = Math.max(0, total - parsedSplit);
  const splitIsValid = parsedSplit > 0 && parsedSplit < total;

  return (
    <ScreenShell showWatermark>
      <div className="flex w-full max-w-md flex-col items-center gap-8 px-6 py-12">
        {/* Charges card */}
        <div
          className="w-full rounded-2xl border p-6"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        >
          <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            {t('payment.yourCharges')}
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {lineItems.map((li, idx) => (
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
              <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('totalDue')}</span>
              <span
                className="text-2xl font-extrabold tabular-nums"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}
              >
                {formatAmount(total)}
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
            {t('payment.insertOrTapCard')}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('payment.waitingForPayment')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-3">
          {/* Primary row */}
          <div className="flex w-full gap-3">
            <button
              type="button"
              className="flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={onCancel}
              disabled={submitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg px-6 py-4 text-base font-bold transition"
              style={{ backgroundColor: 'var(--color-status-success)', color: 'white' }}
              onClick={() => demoTakePayment('CREDIT_SUCCESS')}
              disabled={submitting}
            >
              {submitting ? t('payment.processing') : t('payment.demoPayCard')}
            </button>
          </div>
          {/* Secondary row - split + cash */}
          <div className="flex w-full gap-3">
            <button
              type="button"
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
              onClick={() => setShowSplitDialog(true)}
              disabled={submitting}
            >
              {t('payment.splitPayment')}
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
              onClick={() => demoTakePayment('CASH_SUCCESS')}
              disabled={submitting}
            >
              {t('payment.demoPayCash')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Split Payment Dialog ── */}
      {showSplitDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowSplitDialog(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border p-6"
            style={{ backgroundColor: '#1e1e2e', borderColor: 'var(--color-border-default)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-lg font-bold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
            >
              {t('payment.splitPayment')}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('payment.splitCardSubtitle')}
            </p>

            <div className="mt-4">
              <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                {t('payment.cardAmount')}
              </label>
              <div className="relative mt-1">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(total - 0.01).toFixed(2)}
                  className="w-full rounded-lg border py-3 pl-7 pr-3 text-right text-lg font-bold tabular-nums outline-none"
                  style={{
                    backgroundColor: 'var(--color-surface-base)',
                    borderColor: 'var(--color-border-default)',
                    color: 'var(--color-text-primary)',
                  }}
                  value={splitAmount}
                  onChange={(e) => setSplitAmount(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {parsedSplit > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-surface-base)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('payment.cashRemaining')}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatAmount(cashDue)}
                </span>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
                onClick={() => setShowSplitDialog(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg px-4 py-3 text-sm font-bold"
                style={{
                  backgroundColor: splitIsValid ? 'var(--color-accent-primary)' : 'var(--color-surface-raised)',
                  color: splitIsValid ? 'white' : 'var(--color-text-muted)',
                }}
                disabled={!splitIsValid || submitting}
                onClick={() => demoTakePayment('CREDIT_SUCCESS', parsedSplit)}
              >
                {submitting ? t('payment.processing') : t('payment.payCardPortion')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
