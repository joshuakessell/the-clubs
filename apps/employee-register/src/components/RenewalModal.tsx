/**
 * RenewalModal — dialog for extending a customer's stay.
 * Shows 2-hour ($20 flat) and 6-hour (original charges) options.
 * On confirm, calls the lane session start endpoint with renewal params.
 */
import { useState, useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useRegisterStore } from '../stores/useRegisterStore';

export interface RenewalEligibility {
  eligible: boolean;
  reason?: string;
  visitId?: string;
  canExtend2h: boolean;
  canExtend6h: boolean;
  currentTotalHours: number;
  maxHours: number;
  extension2hCharges?: Array<{ description: string; amount: number }>;
  extension2hTotal?: number;
  extension6hCharges?: Array<{ description: string; amount: number }>;
  extension6hTotal?: number;
}

export function RenewalModal({
  customerLabel,
  customerId,
  eligibility,
  onDismiss,
}: Readonly<{
  customerLabel: string;
  customerId: string;
  eligibility: RenewalEligibility;
  onDismiss: () => void;
}>) {
  const [selectedHours, setSelectedHours] = useState<2 | 6 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const laneId = useRegisterStore((s) => s.laneId);
  const setSuccessToastMessage = useRegisterStore((s) => s.setSuccessToastMessage);
  const selectNavTab = useRegisterStore((s) => s.selectNavTab);

  // Reset selection if eligibility changes
  useEffect(() => {
    setSelectedHours(null);
  }, [eligibility]);

  const handleRenew = async (hours: 2 | 6) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const token = globalThis.__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/start`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customerId,
            visitId: eligibility.visitId,
            renewalHours: hours,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? `Renewal failed (${res.status})`);
      }

      const data = await res.json();

      // Set session payload for the kiosk flow
      useRegisterStore.setState({
        currentSessionId: data.sessionId,
        customerId: data.customerId ?? customerId,
        customerName: data.customerName ?? customerLabel,
        sessionPayload: {
          sessionId: data.sessionId,
          customerId: data.customerId ?? customerId,
          customerName: data.customerName ?? customerLabel,
          membershipNumber: data.membershipNumber,
          allowedRentals: data.allowedRentals ?? [],
          mode: 'RENEWAL',
          flowStep: 'PAYMENT',
          flowVersion: 0,
          status: 'ACTIVE',
          renewalHours: hours,
          visitId: data.visitId ?? eligibility.visitId,
          blockEndsAt: data.blockEndsAt,
          assignedResourceType: data.activeAssignedResourceType,
          assignedResourceNumber: data.activeAssignedResourceNumber,
          ledgerLineItems: data.ledgerLineItems,
          ledgerTotal: data.ledgerTotal,
        },
        accountDrawerOpen: true,
        successToastMessage: `Renewal started — ${hours}h extension for ${data.customerName ?? customerLabel}`,
      });

      selectNavTab('account');
      onDismiss();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to start renewal';
      setSuccessToastMessage(msg);
      setIsProcessing(false);
    }
  };

  const greenBtn = {
    backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
    color: 'var(--color-status-success)',
    border: '1px solid color-mix(in oklch, var(--color-status-success) 25%, transparent)',
    cursor: isProcessing ? 'not-allowed' : 'pointer',
    transition: 'opacity 0.15s ease',
    opacity: isProcessing ? 0.5 : 1,
  } as const;

  const accentStyle = {
    backgroundColor: 'color-mix(in oklch, var(--color-brand-primary) 8%, transparent)',
    border: '1px solid color-mix(in oklch, var(--color-brand-primary) 20%, transparent)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <dialog
        open
        aria-labelledby="renewal-title"
        className="w-full max-w-md rounded-xl border shadow-2xl relative bg-(--color-surface-raised) border-(--color-border-default)"
      >
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-sm"
          aria-label="Close modal"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-(--color-border-subtle)">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: 'color-mix(in oklch, var(--color-brand-primary) 12%, transparent)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-primary)"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </div>
            <div>
              <h3 id="renewal-title" className="text-base font-bold text-(--color-text-primary) font-(--font-display)">
                Renew Stay
              </h3>
              <p className="text-xs text-(--color-text-muted)">
                {customerLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {selectedHours === null ? (
            /* ── Extension Options ── */
            <>
              <p className="text-sm text-(--color-text-secondary)">
                Select an extension option:
              </p>

              {/* 2-Hour Extension */}
              {eligibility.canExtend2h && (
                <button
                  onClick={() => setSelectedHours(2)}
                  className="w-full rounded-xl p-4 text-left transition-all hover:scale-[1.01]"
                  style={accentStyle}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-(--color-text-primary)">2-Hour Extension</span>
                    <span className="text-lg font-bold tabular-nums text-(--color-brand-primary) font-(--font-display)">
                      ${eligibility.extension2hTotal?.toFixed(2) ?? '20.00'}
                    </span>
                  </div>
                  {eligibility.extension2hCharges?.map((item) => (
                    <div key={item.description} className="flex items-center justify-between text-xs text-(--color-text-muted)">
                      <span>{item.description}</span>
                      <span className="tabular-nums">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </button>
              )}

              {/* 6-Hour Extension */}
              {eligibility.canExtend6h && (
                <button
                  onClick={() => setSelectedHours(6)}
                  className="w-full rounded-xl p-4 text-left transition-all hover:scale-[1.01]"
                  style={accentStyle}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-(--color-text-primary)">6-Hour Extension</span>
                    <span className="text-lg font-bold tabular-nums text-(--color-brand-primary) font-(--font-display)">
                      ${eligibility.extension6hTotal?.toFixed(2) ?? '0.00'}
                    </span>
                  </div>
                  {eligibility.extension6hCharges?.map((item) => (
                    <div key={item.description} className="flex items-center justify-between text-xs text-(--color-text-muted)">
                      <span>{item.description}</span>
                      <span className="tabular-nums">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </button>
              )}
            </>
          ) : (
            /* ── Payment Confirmation ── */
            <>
              <div
                className="rounded-xl p-4"
                style={accentStyle}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-(--color-text-secondary)">Extension</span>
                  <span className="text-sm font-bold text-(--color-text-primary)">{selectedHours} Hours</span>
                </div>
                {(selectedHours === 2 ? eligibility.extension2hCharges : eligibility.extension6hCharges)?.map(
                  (item) => (
                    <div key={item.description} className="flex items-center justify-between text-xs text-(--color-text-muted) mt-1">
                      <span>{item.description}</span>
                      <span className="tabular-nums">${item.amount.toFixed(2)}</span>
                    </div>
                  )
                )}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-(--color-border-subtle)">
                  <span className="text-sm font-medium text-(--color-text-secondary)">Total</span>
                  <span className="text-xl font-bold tabular-nums text-(--color-brand-primary) font-(--font-display)">
                    ${(selectedHours === 2 ? eligibility.extension2hTotal : eligibility.extension6hTotal)?.toFixed(2)}
                  </span>
                </div>
              </div>

              <p className="text-sm text-(--color-text-secondary)">
                This will start the renewal on the customer kiosk. The customer will confirm payment and sign the agreement.
              </p>

              {/* Confirm / Back */}
              <button
                disabled={isProcessing}
                onClick={() => handleRenew(selectedHours)}
                className="w-full rounded-lg py-3 text-sm font-bold flex items-center justify-center gap-2"
                style={greenBtn}
              >
                {isProcessing ? (
                  'Starting Renewal…'
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    Confirm {selectedHours}h Extension
                  </>
                )}
              </button>

              <button
                disabled={isProcessing}
                onClick={() => setSelectedHours(null)}
                className="text-xs py-1 text-center"
                style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ← Back to options
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
