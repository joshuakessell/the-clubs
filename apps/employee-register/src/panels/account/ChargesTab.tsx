import { useRegisterStore } from '../../stores/useRegisterStore';

/**
 * ChargesTab — Payment ledger for the current session.
 * Shows line items from the session payload and any past-due balance.
 */
export function ChargesTab() {
  const { sessionPayload, currentSessionId } = useRegisterStore();
  const sp = sessionPayload;

  if (!currentSessionId || !sp) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <span className="text-4xl" aria-hidden="true">💰</span>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No active session. Start a check-in to see charges.
        </p>
      </div>
    );
  }

  const lineItems = sp.paymentLineItems ?? sp.ledgerLineItems ?? [];
  const total = sp.paymentTotal ?? sp.ledgerTotal ?? 0;
  const isPaid = sp.paymentStatus === 'PAID';

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Session Charges
      </h3>

      {/* Past due balance */}
      {(sp.pastDueBalance ?? 0) > 0 && (
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
        >
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-status-error)' }}>
            Past Due Balance
          </span>
          <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-error)' }}>
            ${((sp.pastDueBalance ?? 0) / 100).toFixed(2)}
          </span>
        </div>
      )}

      {/* Line items */}
      {lineItems.length > 0 ? (
        <div className="rounded-lg border" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' } as React.CSSProperties}>
            {lineItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {item.description}
                </span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  ${(item.amount / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Total
            </span>
            <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
              ${(total / 100).toFixed(2)}
            </span>
          </div>

          {/* Payment status */}
          <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              Status
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold"
              style={{
                backgroundColor: isPaid ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                color: isPaid ? 'var(--color-status-success)' : 'var(--color-status-warning)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: isPaid ? 'var(--color-status-success)' : 'var(--color-status-warning)' }}
              />
              {isPaid ? `Paid (${sp.paymentMethod ?? 'N/A'})` : 'Unpaid'}
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-6 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No charges yet. Charges will appear once a rental type is selected.
          </p>
        </div>
      )}
    </div>
  );
}
