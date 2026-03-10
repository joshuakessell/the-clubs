import { useState } from 'react';
import { useCheckinFlow } from '../CheckinFlowContext';

export function PaymentStep() {
  const { state, actions } = useCheckinFlow();
  const { sp } = state;
  const { sendFlowCommand } = actions;

  const isPaid = sp.orderStatus === 'PAID';
  const [loading, setLoading] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const totalDollars = Math.round(sp.paymentTotal ?? 0);
  const [splitCashDollars, setSplitCashDollars] = useState(0);
  const splitCreditDollars = totalDollars - splitCashDollars;

  // Membership upgrade/downgrade — prepared for future UI wiring
  // const membershipChoice = sp.membershipChoice;
  // const isMember = (() => {
  //   const validUntil = sp.customerMembershipValidUntil;
  //   if (!validUntil) return false;
  //   return new Date(validUntil + 'T23:59:59') >= new Date();
  // })();
  // const isMembershipItem = (item: { description: string }) =>
  //   item.description === 'Membership Fee' || item.description === '6-Month Membership';
  // const setMembershipChoice = useCallback(async (choice: 'ONE_TIME' | 'SIX_MONTH' | 'NONE') => {
  //   if (!laneId || !token) return;
  //   try {
  //     const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  //     if (token) headers['Authorization'] = `Bearer ${token}`;
  //     await fetch(
  //       getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/membership-choice`),
  //       { method: 'POST', headers, body: JSON.stringify({ choice, sessionId: currentSessionId ?? undefined }) }
  //     );
  //   } catch { /* best-effort */ }
  // }, [laneId, token, currentSessionId]);

  const handleMarkPaid = async (method: 'CASH' | 'CREDIT') => {
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'AGREEMENT', paymentMethod: method },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSplitPaid = async () => {
    if (splitCreditDollars < 0) return;
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: {
          step: 'AGREEMENT',
          paymentMethod: 'SPLIT',
          splitCashAmount: splitCashDollars,
          splitCreditAmount: splitCreditDollars,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreditFailure = async () => {
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'PAYMENT', paymentMethod: 'CREDIT', paymentFailed: true, failureReason: 'Card declined — demo failure' },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Collect Payment
      </h3>



      {sp.paymentTotal === undefined && (
        <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for payment quote from server…
          </p>
        </div>
      )}

      {/* Payment failure notice */}
      {sp.paymentFailureReason && !isPaid && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 30%, transparent)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-error)' }}>
            ✗ {sp.paymentFailureReason}
          </span>
        </div>
      )}

      {/* Payment status / actions */}
      {isPaid ? (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-success) 20%, transparent)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            ✓ Paid via {sp.paymentMethod ?? 'N/A'}
          </span>
        </div>
      ) : showSplit ? (
        /* ── Split payment UI ── */
        <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Split Payment</span>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label htmlFor="split-cash" className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-status-success)' }}>Cash ($)</label>
              <input
                id="split-cash"
                type="number"
                min={0}
                max={totalDollars}
                step={1}
                value={splitCashDollars}
                onChange={(e) => setSplitCashDollars(Math.round(Number.parseFloat(e.target.value || '0')))}
                className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="split-credit" className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-accent-primary)' }}>Credit ($)</label>
              <div
                id="split-credit"
                className="mt-1 flex h-10 items-center rounded-lg border px-3 text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              >
                ${splitCreditDollars}
              </div>
            </div>
          </div>
          {splitCreditDollars < 0 && (
            <p className="text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>
              Cash amount exceeds total
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={loading || splitCreditDollars < 0}
              onClick={() => { handleSplitPaid(); }}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition-colors"
              style={{ borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)', backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)', opacity: loading || splitCreditDollars < 0 ? 0.5 : 1 }}
            >
              {loading ? '…' : '✓ Confirm Split'}
            </button>
            <button
              onClick={() => setShowSplit(false)}
              className="rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── Payment buttons ── */
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <button
              disabled={loading}
              onClick={() => { handleMarkPaid('CASH'); }}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition-colors"
              style={{ borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)', backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)' }}
            >
              {loading ? '…' : 'Cash'}
            </button>
            <button
              disabled={loading}
              onClick={() => { handleMarkPaid('CREDIT'); }}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition-colors"
              style={{ borderColor: 'var(--color-accent-primary)', color: 'var(--color-accent-primary)', backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 5%, transparent)' }}
            >
              {loading ? '…' : 'Credit'}
            </button>
          </div>
          <button
            disabled={loading}
            onClick={() => setShowSplit(true)}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface-overlay)' }}
          >
            ✂️ Split Payment (Cash + Credit)
          </button>
          <button
            disabled={loading}
            onClick={() => { handleCreditFailure(); }}
            className="w-full rounded-lg border px-4 py-2 text-xs font-medium transition-colors"
            style={{ borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)', backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)' }}
          >
            {loading ? '…' : '⚠️ Simulate Credit Failure (Demo)'}
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => { sendFlowCommand({ type: 'SET_STEP', payload: { step: 'RENTAL' } }); }}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Rental
      </button>
    </div>
  );
}
