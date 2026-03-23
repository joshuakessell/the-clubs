import { useState } from 'react';
import { useCheckinFlow } from '../CheckinFlowContext';
import { createSquareOrder } from '../../../utils/checkoutApi';

export function PaymentStep() {
  const { state, actions, meta } = useCheckinFlow();
  const { sp } = state;
  const { sendFlowCommand } = actions;

  const isPaid = sp.orderStatus === 'PAID';
  const isRenewal = sp.mode === 'RENEWAL';
  const [loading, setLoading] = useState(false);
  const totalDollars = Number((sp.ledgerTotal ?? sp.paymentTotal ?? 0).toFixed(2));

  const handleSquareCheckout = async () => {
    if (!meta.laneId || !meta.token) return;
    setLoading(true);
    try {
      const { orderId } = await createSquareOrder(meta.laneId, meta.token);

      globalThis.sessionStorage.setItem('square_checkout_lane_id', meta.laneId);
      globalThis.sessionStorage.setItem('square_checkout_order_id', orderId);

      const amountCents = Math.round(totalDollars * 100);
      const appSwitchData = {
        amount_money: { amount: amountCents.toString(), currency_code: 'USD' },
        callback_url: `${globalThis.location.origin}/checkout/square-callback`,
        client_id: import.meta.env.VITE_SQUARE_APPLICATION_ID || 'sq0idp-undefined',
        version: '1.3',
        notes: `ORDER_ID:${orderId}`,
        options: {
          supported_tender_types: ['CREDIT_CARD', 'CASH', 'SQUARE_GIFT_CARD', 'CARD_ON_FILE']
        }
      };

      const iosUri = `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(appSwitchData))}`;
      globalThis.location.href = iosUri;

      // Notice we do NOT clear loading state here, because the app is about to be backgrounded.
      // If they come back, it might reload the page or trigger the callback route.
    } catch (err) {
      console.error('Failed to trigger Square POS', err);
      // Fallback: simulate credit failure internally so they aren't completely stuck
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'PAYMENT', paymentMethod: 'CREDIT', paymentFailed: true, failureReason: 'Failed to communicate with Square API.' },
      });
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold font-(--font-display) text-(--color-text-primary)">
        {isRenewal ? 'Collect Renewal Payment' : 'Collect Payment'}
      </h3>

      {isPaid && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-success) 20%, transparent)' }}>
          <span className="text-sm font-semibold text-(--color-status-success)">
            ✓ Paid via {sp.paymentMethod ?? 'N/A'}
          </span>
        </div>
      )}

      {!isPaid && sp.paymentTotal === undefined && (
        <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-sm text-(--color-text-muted)">
            Waiting for payment quote from server…
          </p>
        </div>
      )}

      {/* Payment failure notice */}
      {sp.paymentFailureReason && !isPaid && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 30%, transparent)' }}>
          <span className="text-sm font-semibold text-(--color-status-error)">
            ✗ {sp.paymentFailureReason}
          </span>
        </div>
      )}

      {!isPaid && (
        <div className="flex flex-col gap-3">
          {totalDollars === 0 ? (
            <button
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await sendFlowCommand({
                    type: 'SET_STEP',
                    payload: { step: 'PAYMENT', paymentMethod: 'CASH', splitCashAmount: 0, splitCreditAmount: 0 },
                  });
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full rounded-lg border px-4 py-4 text-sm font-bold transition-colors shadow-sm"
              style={{
                borderColor: 'var(--color-status-success)',
                color: 'white',
                backgroundColor: 'var(--color-status-success)'
              }}
            >
              {loading ? 'Processing…' : 'Complete (No Payment Due)'}
            </button>
          ) : (
            <>
              <button
                disabled={loading}
                onClick={handleSquareCheckout}
                className="w-full rounded-lg border px-4 py-4 text-sm font-bold transition-colors shadow-sm"
                style={{
                  borderColor: 'var(--color-accent-primary)',
                  color: 'var(--color-on-accent)',
                  backgroundColor: 'var(--color-accent-primary)'
                }}
              >
                {loading ? 'Opening Square Checkout…' : 'Launch Square POS App'}
              </button>

              <p className="text-center text-xs text-(--color-text-muted) px-4">
                iPad will automatically switch to Square Point of Sale. After the swipe, it will instantly return here to finalize.
              </p>
            </>
          )}
        </div>
      )}

      {/* Back button — hidden for renewals (no rental step to go back to) */}
      {!isRenewal && (
        <button
          onClick={() => { sendFlowCommand({ type: 'SET_STEP', payload: { step: 'RENTAL' } }); }}
          className="self-start text-xs font-semibold text-(--color-text-muted)"
        >
          ← Back to Rental
        </button>
      )}
    </div>
  );
}
