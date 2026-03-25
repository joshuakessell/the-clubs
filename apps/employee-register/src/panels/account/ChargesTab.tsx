import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';
import { PastDueOverrideModal } from '../../components/PastDueOverrideModal';

type LedgerEntry = { description: string; amount: number };

/**
 * ChargesTab — Payment ledger for the current session or active visit.
 *
 * Shows line items from:
 *  - The SSE session payload (when an active lane session exists), OR
 *  - The visit spend ledger API (when customer is checked in but no lane session)
 */
export function ChargesTab() {
  const { sessionPayload, currentSessionId, activeCheckinInfo, customerId, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);
  const sp = sessionPayload;

  // Past-due override modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);

  // ──────────────────────────────────────────────
  // Fetch visit charges from API when checked in but no active session
  // ──────────────────────────────────────────────
  const visitId = activeCheckinInfo?.visitId;
  const cid = customerId ?? sp?.customerId;

  const [visitEntries, setVisitEntries] = useState<LedgerEntry[]>([]);
  const [visitTotal, setVisitTotal] = useState(0);
  const [visitLoading, setVisitLoading] = useState(false);

  useEffect(() => {
    // Only fetch if checked in without an active session
    if (currentSessionId || sp || !visitId || !cid) {
      setVisitEntries([]);
      setVisitTotal(0);
      return;
    }

    let cancelled = false;
    setVisitLoading(true);

    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(
          getApiUrl(`/api/v1/customers/${encodeURIComponent(cid)}/visits/${encodeURIComponent(visitId)}/spend-ledger`),
          { headers }
        );
        if (cancelled) return;
        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          console.error(`[ChargesTab] Spend-ledger fetch failed: HTTP ${res.status}`, errorBody);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        const entries: LedgerEntry[] = (data.entries ?? []).map((e: Record<string, unknown>) => ({
          description: e.summary ?? e.entryType ?? 'Charge',
          amount: typeof e.amount === 'number' ? e.amount : (typeof e.amount === 'string' ? Number.parseInt(e.amount, 10) : 0),
        }));

        const total = data.totals?.net ?? entries.reduce((sum, e) => sum + e.amount, 0);
        setVisitEntries(entries);
        setVisitTotal(total);
      } catch (err) {
        console.error('[ChargesTab] Spend-ledger fetch error:', err);
      } finally {
        if (!cancelled) setVisitLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visitId, cid, currentSessionId, sp, token]);

  // ──────────────────────────────────────────────
  // Membership choice handler — calls API to switch membership type
  // ──────────────────────────────────────────────
  const setMembershipChoice = useCallback(async (choice: 'ONE_TIME' | 'SIX_MONTH' | 'NONE') => {
    if (!laneId || !token) return;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/membership-choice`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            choice,
            sessionId: currentSessionId ?? undefined,
          }),
        }
      );
      // SSE broadcast will update the sessionPayload with new ledgerLineItems
    } catch {
      // Best-effort
    }
  }, [laneId, token, currentSessionId]);

  // ──────────────────────────────────────────────
  // Active session mode — use SSE payload data
  // ──────────────────────────────────────────────
  if (currentSessionId && sp) {
    const lineItems = sp.ledgerLineItems ?? sp.paymentLineItems ?? [];
    const total = sp.ledgerTotal ?? sp.paymentTotal ?? 0;
    const isPaid = sp.orderStatus === 'PAID';
    const membershipChoice = sp.membershipChoice;

    // Detect if item is a membership fee (for showing remove/upgrade controls)
    const isMembershipItem = (item: { description: string }) =>
      item.description === 'Membership Fee' || item.description === '6-Month Membership';

    // Check if customer is a member (no membership controls needed)
    const isMember = (() => {
      const validUntil = sp.customerMembershipValidUntil;
      if (!validUntil) return false;
      return new Date(validUntil + 'T23:59:59') >= new Date();
    })();

    // Detect past-due line item
    const pastDueItem = lineItems.find((item) => item.description === 'Past Due Balance');

    return (
      <div className="flex flex-col gap-2">
        <h3
          className="text-sm font-bold font-(--font-display) text-(--color-text-primary)"
        >
          Check-In Ledger
        </h3>

        {/* Past-due override banner */}
        {pastDueItem && !isPaid && (
          <div
            className="flex items-center justify-between rounded-lg px-3 py-2"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 8%, transparent)',
              border: '1px solid color-mix(in oklch, var(--color-status-warning) 20%, transparent)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-status-warning)' }}>
                Outstanding past-due balance
              </span>
            </div>
            <button
              onClick={() => setOverrideModalOpen(true)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                backgroundColor: 'var(--color-status-warning)',
                color: '#000',
              }}
            >
              Override
            </button>
          </div>
        )}

        {/* Past-due override modal */}
        <PastDueOverrideModal
          open={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          balanceAmount={pastDueItem?.amount ?? 0}
        />

        {/* Line items */}
        {lineItems.length > 0 ? (
          <div
            className="rounded-lg border bg-(--color-surface-overlay) border-(--color-border-subtle)"
          >
            <div
              className="divide-y divide-(--color-border-subtle)"
            >
              {lineItems.map((item, i) => {
                const isPastDue = item.description === 'Past Due Balance';
                const textColor = isPastDue ? 'var(--color-status-warning)' : 'var(--color-text-secondary)';
                const amountColor = isPastDue ? 'var(--color-status-warning)' : 'var(--color-text-primary)';
                const rowStyles = isPastDue ? {
                  backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 5%, transparent)',
                } : {};

                return (
                  <div key={i} className="flex items-center justify-between px-4 py-2" style={rowStyles}>
                    <span className="text-sm" style={{ color: textColor, fontStyle: item.description.includes('(waitlist)') ? 'italic' : undefined, fontWeight: isPastDue ? 'bold' : undefined }}>
                      {item.description}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-semibold tabular-nums text-(--color-text-primary)"
                        style={{ color: amountColor }}
                      >
                        ${(item.amount / 100).toFixed(2)}
                      </span>
                    {/* Remove button for membership fee items */}
                    {!isMember && isMembershipItem(item) && item.description === '6-Month Membership' && (
                      <button
                        onClick={() => setMembershipChoice('ONE_TIME')}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold transition-colors"
                        style={{
                          backgroundColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)',
                          color: 'var(--color-status-error)',
                          border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
                        }}
                        title="Remove 6-month membership, revert to daily fee"
                      >
                        −
                      </button>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div
              className="flex items-center justify-between border-t px-4 py-2 border-(--color-border-default)"
            >
              <span className="text-sm font-bold text-(--color-text-primary)">
                Total
              </span>
              <span
                className="text-base font-bold tabular-nums text-(--color-accent-primary)"
              >
                ${(total / 100).toFixed(2)}
              </span>
            </div>

            {/* Payment status */}
            <div
              className="flex items-center justify-between border-t px-4 py-2 border-(--color-border-default)"
            >
              <span
                className="text-xs font-bold uppercase tracking-wider text-(--color-text-muted)"
              >
                Status
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold"
                style={{
                  backgroundColor: isPaid ? 'color-mix(in oklch, var(--color-status-success) 10%, transparent)' : 'color-mix(in oklch, var(--color-status-warning) 10%, transparent)',
                  color: isPaid ? 'var(--color-status-success)' : 'var(--color-status-warning)',
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: isPaid
                      ? 'var(--color-status-success)'
                      : 'var(--color-status-warning)',
                  }}
                />
                {isPaid ? `Paid (${sp.paymentMethod ?? 'N/A'})` : 'Unpaid'}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="rounded-lg border p-3 text-center bg-(--color-surface-overlay) border-(--color-border-subtle)"
          >
            <p className="text-sm text-(--color-text-muted)">
              No charges yet. Charges will appear once a rental type is selected.
            </p>
          </div>
        )}

        {/* 6-Month Membership Upgrade — only for non-members with daily fee, before payment */}
        {!isMember && membershipChoice !== 'SIX_MONTH' && !isPaid && lineItems.some(isMembershipItem) && sp.flowStep !== 'PAYMENT' && sp.flowStep !== 'AGREEMENT' && (
          <button
            onClick={() => setMembershipChoice('SIX_MONTH')}
            className="flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 6%, transparent)',
              borderColor: 'color-mix(in oklch, var(--color-accent-primary) 20%, transparent)',
              color: 'var(--color-accent-primary)',
            }}
          >
            <span>⬆</span>{' '}
            <span>Upgrade to 6-Month Membership ($43.00)</span>
          </button>
        )}
      </div>
    );
  }

  // ──────────────────────────────────────────────
  // Checked-in mode — show visit charges from API
  // ──────────────────────────────────────────────
  if (visitId && cid) {
    if (visitLoading) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-(--color-accent-primary)"
          />
          <p className="text-sm text-(--color-text-muted)">
            Loading visit charges…
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <h3
          className="text-sm font-bold font-(--font-display) text-(--color-text-primary)"
        >
          Visit Charges
        </h3>

        {visitEntries.length > 0 ? (
          <div
            className="rounded-lg border bg-(--color-surface-overlay) border-(--color-border-subtle)"
          >
            <div
              className="divide-y divide-(--color-border-subtle)"
            >
              {visitEntries.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm text-(--color-text-secondary)">
                    {item.description}
                  </span>
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    ${(item.amount / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div
              className="flex items-center justify-between border-t px-4 py-2 border-(--color-border-default)"
            >
              <span className="text-sm font-bold text-(--color-text-primary)">
                Total
              </span>
              <span
                className="text-base font-bold tabular-nums text-(--color-accent-primary)"
              >
                ${(visitTotal / 100).toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="rounded-lg border p-3 text-center bg-(--color-surface-overlay) border-(--color-border-subtle)"
          >
            <p className="text-sm text-(--color-text-muted)">
              No charges recorded for this visit yet.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Fallback — shouldn't be reached if AccountPanel hides this column correctly
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <span className="text-sm font-bold text-(--color-text-muted)">No charges</span>
      <p className="text-sm text-(--color-text-muted)">
        No active session. Start a check-in to see charges.
      </p>
    </div>
  );
}
