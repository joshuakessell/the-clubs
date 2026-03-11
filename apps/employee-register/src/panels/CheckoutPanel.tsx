import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import useSWR from 'swr';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { RenewalModal, type RenewalEligibility } from '../components/RenewalModal';
import { PanelShell } from '../views/PanelShell';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { StatusDot } from '../components/StatusDot';
import { LateFeeModal, type LateFeeDetails } from '../components/LateFeeModal';
import { executeManualCheckout } from '../utils/checkoutApi';
import { useRegisterStore } from '../stores/useRegisterStore';

/* ── Types ──────────────────────────────────────────── */

interface Candidate {
  occupancyId: string;
  visitId?: string;
  resourceType: string;
  number: string;
  customerId: string;
  customerName: string;
  checkinAt: string;
  scheduledCheckoutAt: string;
  isOverdue: boolean;
}

type ResolvedDetails = LateFeeDetails;

/* ── Helpers ────────────────────────────────────────── */

function formatTime(iso: string, timeZone: string = 'America/Chicago') {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDuration(checkinAt: string) {
  const ms = Date.now() - new Date(checkinAt).getTime();
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── Sub-components ─────────────────────────────────── */

/** Live clock shown in the detail panel. */
function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="tabular-nums text-(--color-text-primary) font-(--font-display)"
    >
      {time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

/** Row in the detail panel (label + value). */
function DetailRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-(--color-text-muted)">{label}</span>
      {children}
    </div>
  );
}

const postFetcher = async ([url, body, token]: [string, any, string?]) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
     const err = await res.json().catch(() => ({}));
     throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

const getFetcher = async ([url, token]: [string, string?]) => {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

function useManualResolve(occupancyId: string | undefined) {
  const token = useAuthStore((s) => s.session?.sessionToken);
  
  const { data, isLoading } = useSWR(
    occupancyId ? [getApiUrl('/api/v1/checkout/manual-resolve'), { occupancyId }, token] : null,
    postFetcher,
    { suspense: true, keepPreviousData: false, revalidateOnFocus: false }
  );

  return { 
    resolved: data ? { lateMinutes: data.lateMinutes ?? 0, fee: data.fee ?? 0, banApplied: !!data.banApplied } : null, 
    resolving: isLoading 
  };
}

/** Right-side detail panel for the selected candidate. */
function DetailPanel({
  candidate,
  onCheckout,
  isProcessing,
}: Readonly<{
  candidate: Candidate | null;
  onCheckout: (c: Candidate, resolve: ResolvedDetails | null) => void;
  isProcessing: boolean;
}>) {
  const { resolved, resolving } = useManualResolve(candidate?.occupancyId);
  const [confirming, setConfirming] = useState(false);
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [renewalEligibility, setRenewalEligibility] = useState<RenewalEligibility | null>(null);
  const [renewalLoading, setRenewalLoading] = useState(false);

  // Reset confirmation and fetch renewal eligibility when candidate changes
  useEffect(() => {
    setConfirming(false);
    setShowRenewalModal(false);
    setRenewalEligibility(null);

    if (!candidate?.occupancyId) return;

    let cancelled = false;
    setRenewalLoading(true);
    (async () => {
      try {
        const token = globalThis.__authToken;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          getApiUrl(`/api/v1/checkout/renewal-eligibility?occupancyId=${encodeURIComponent(candidate.occupancyId)}`),
          { headers }
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setRenewalEligibility(data);
        }
      } catch { /* ignore */ }
      if (!cancelled) setRenewalLoading(false);
    })();
    return () => { cancelled = true; };
  }, [candidate?.occupancyId]);
  if (!candidate) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-center px-6 text-(--color-text-muted)"
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-30"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6M9 12h6M9 15h4" />
        </svg>
        <p className="text-sm">Select a row to see checkout details</p>
      </div>
    );
  }

  const lateMinutes = resolved?.lateMinutes ?? 0;
  const fee = resolved?.fee ?? 0;
  const banApplied = resolved?.banApplied ?? false;
  const isOverdue = lateMinutes > 0;

  const bgColor = isProcessing
    ? 'var(--color-surface-overlay)'
    : confirming
      ? 'var(--color-status-error)'
      : 'color-mix(in oklch, var(--color-status-error) 12%, transparent)';
  const textColor = isProcessing
    ? 'var(--color-text-muted)'
    : confirming
      ? 'var(--color-text-inverse)'
      : 'var(--color-status-error)';

  let buttonLabel: string;
  if (isProcessing) buttonLabel = 'Processing…';
  else if (confirming) buttonLabel = 'Confirm Checkout?';
  else buttonLabel = '↩ Checkout';

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      {/* Customer header */}
      <div>
        <div
          className="text-xs font-semibold uppercase tracking-wider mb-1 text-(--color-text-muted)"
        >
          {candidate.resourceType} {candidate.number}
        </div>
        <div
          className="text-lg font-bold text-(--color-text-primary) font-(--font-display)"
        >
          {candidate.customerName}
        </div>
        <div className="text-xs mt-0.5 text-(--color-text-muted)">
          In {formatDuration(candidate.checkinAt)} · checked in {formatTime(candidate.checkinAt)}
        </div>
      </div>

      <div className="h-px w-full bg-(--color-border-subtle)" />

      {/* Detail rows */}
      <div className="flex flex-col gap-2">
        <DetailRow label="Current time"><LiveClock /></DetailRow>
        <DetailRow label="Scheduled out">
          <span style={{ color: candidate.isOverdue ? 'var(--color-status-error)' : 'var(--color-text-primary)' }}>
            {formatTime(candidate.scheduledCheckoutAt)}
          </span>
        </DetailRow>

        {resolving && (
          <div className="text-xs text-(--color-text-muted)">Calculating fees…</div>
        )}
        {!resolving && isOverdue && (
          <>
            <DetailRow label="Late">
              <span className="font-semibold text-(--color-status-error)">
                {lateMinutes} min
              </span>
            </DetailRow>
            <DetailRow label="Late fee">
              <span className="font-bold" style={{ color: fee > 0 ? 'var(--color-status-error)' : 'var(--color-text-muted)' }}>
                {fee > 0 ? `$${fee.toFixed(2)}` : 'None'}
              </span>
            </DetailRow>
            {banApplied ? (
              <div
                className="rounded-lg px-2 py-1 text-xs"
                style={{
                  backgroundColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)',
                  color: 'var(--color-status-error)',
                  border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
                }}
              >
                ⚠ 90+ min late — manager review for ban recommended
              </div>
            ) : null}
          </>
        )}
        {!resolving && !isOverdue && (
          <div className="text-sm text-(--color-status-success)">✓ No late fee</div>
        )}
      </div>

      {/* Checkout button — two-step confirmation */}
      <button
        disabled={isProcessing || resolving}
        onClick={() => {
          if (confirming) {
            setConfirming(false);
            onCheckout(candidate, resolved);
          } else {
            setConfirming(true);
          }
        }}
        className="w-full rounded-lg py-2 text-sm font-bold"
        style={{
          backgroundColor: bgColor,
          color: textColor,
          border: '1px solid color-mix(in oklch, var(--color-status-error) 25%, transparent)',
          cursor: isProcessing || resolving ? 'not-allowed' : 'pointer',
          opacity: resolving ? 0.6 : 1,
          transition: 'all 0.15s ease',
        }}
      >
        {buttonLabel}
      </button>

      {/* Renew Stay button — shown when eligible */}
      {!renewalLoading && renewalEligibility?.eligible && (
        <button
          disabled={isProcessing}
          onClick={() => setShowRenewalModal(true)}
          className="w-full rounded-lg py-2 text-sm font-bold flex items-center justify-center gap-2 mt-2"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-brand-primary) 10%, transparent)',
            color: 'var(--color-brand-primary)',
            border: '1px solid color-mix(in oklch, var(--color-brand-primary) 25%, transparent)',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Renew Stay
        </button>
      )}

      {/* Renewal Modal */}
      {showRenewalModal && renewalEligibility && (
        <RenewalModal
          customerLabel={`${candidate.customerName} · ${candidate.resourceType} ${candidate.number}`}
          customerId={candidate.customerId}
          eligibility={renewalEligibility}
          onDismiss={() => setShowRenewalModal(false)}
        />
      )}
    </div>
  );
}


/* ── Main Component ─────────────────────────────────── */

/**
 * CheckoutPanel — Manual checkout flow.
 * 70/30 split: DataTable on the left, checkout detail panel on the right.
 */
export function CheckoutPanelContent() {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const openCustomerAccount = useRegisterStore((s) => s.openCustomerAccount);
  const didAutoSelect = useRef(false);

  /* ── Data fetching ── */
  const { data, error, mutate, isLoading } = useSWR(
    [getApiUrl('/api/v1/checkout/manual-candidates'), token],
    getFetcher,
    { suspense: true }
  );
  
  const candidates: Candidate[] = data?.candidates ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!didAutoSelect.current && candidates.length > 0) {
      setSelectedId(candidates[0].occupancyId);
      didAutoSelect.current = true;
    }
  }, [candidates]);

  const [checkingOut, setCheckingOut] = useState(false);
  const [lateFeeModal, setLateFeeModal] = useState<{ candidate: Candidate; resolved: ResolvedDetails } | null>(null);

  const selectedCandidate = candidates.find((c) => c.occupancyId === selectedId) ?? null;

  /* ── Checkout logic ── */
  const doCheckout = useCallback(async (
    occupancyId: string,
    payAtCheckout: boolean,
    paymentMethod?: 'CREDIT' | 'CASH'
  ) => {
    setCheckingOut(true);
    setLateFeeModal(null);
    try {
      await executeManualCheckout(occupancyId, token, payAtCheckout, paymentMethod);
      // Remove and select next
        useRegisterStore.getState().triggerRentalsRefresh();
        const idx = candidates.findIndex((c) => c.occupancyId === occupancyId);
        const next = candidates.filter((c) => c.occupancyId !== occupancyId);
        if (next.length > 0) {
          const nextIdx = Math.max(0, Math.min(idx, next.length - 1));
          setSelectedId(next[nextIdx].occupancyId);
        } else {
          setSelectedId(null);
        }
        await mutate(); // Re-fetch the remaining
    } catch (err: unknown) {
      console.error('Checkout failed', err);
    } finally {
      setCheckingOut(false);
    }
  }, [token, candidates, mutate]);

  const handleCheckoutRequest = useCallback((candidate: Candidate, resolved: ResolvedDetails | null) => {
    const fee = resolved?.fee ?? 0;
    if (fee > 0 && resolved) {
      setLateFeeModal({ candidate, resolved });
    } else {
      void doCheckout(candidate.occupancyId, false);
    }
  }, [doCheckout]);

  /* ── Column definitions ── */
  const columns = useMemo<DataTableColumn<Candidate>[]>(() => [
    {
      key: 'number',
      header: 'Room',
      width: '100px',
      render: (c) => (
        <div className="flex items-center gap-2">
          <span
            className="font-bold font-(--font-display) text-(--color-text-primary)"
          >
            {c.number}
          </span>
          {c.isOverdue ? <StatusDot status="OVERDUE" label="Overdue" size="sm" /> : null}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (c) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openCustomerAccount(c.customerId, c.customerName, {
              authToken: token,
              activeCheckin: {
                visitId: c.visitId ?? c.occupancyId,
                occupancyId: c.occupancyId,
                resourceType: c.resourceType === 'LOCKER' ? 'locker' : 'room',
                resourceNumber: c.number,
                checkinAt: c.checkinAt,
                checkoutAt: c.scheduledCheckoutAt,
                overdue: c.isOverdue,
              },
            });
          }}
          className="text-left font-medium hover:underline text-(--color-accent-primary) bg-transparent border-none p-0 cursor-pointer"
        >
          {c.customerName}
        </button>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <span className="text-(--color-text-muted)">{c.resourceType}</span>
      ),
    },
    {
      key: 'checkin',
      header: 'Check-In',
      numeric: true,
      render: (c) => (
        <span className="text-(--color-text-muted)">{formatTime(c.checkinAt)}</span>
      ),
    },
    {
      key: 'checkout',
      header: 'Checkout',
      numeric: true,
      render: (c) => (
        <span style={{ color: c.isOverdue ? 'var(--color-status-error)' : 'var(--color-text-muted)' }}>
          {formatTime(c.scheduledCheckoutAt)}
        </span>
      ),
    },
  ], [openCustomerAccount, token]);

  /* ── Render ── */
  return (
    <PanelShell align="top" scroll="hidden">
      <div className="flex items-center justify-between mb-4">
        <PanelHeader title="Checkout" subtitle="Select a room to checkout" />
        <button
          onClick={() => void mutate()}
          disabled={isLoading}
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-semibold hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-default)',
            transition: 'opacity 0.15s ease',
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error ? (
        <p
          className="mb-3 rounded-md px-3 py-2 text-xs font-medium"
          style={{
            color: 'var(--color-status-error)',
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
          }}
        >
          {error.message || 'Failed to load candidates'}
        </p>
      ) : null}

      {/* 70/30 split */}
      <div
        className="flex gap-0 flex-1 min-h-0 overflow-hidden rounded-xl border border-(--color-border-default)"
      >
        {/* Left — DataTable (70%) */}
        <div className="flex flex-col overflow-auto border-r w-[70%] border-(--color-border-default)">
          <DataTable
            columns={columns}
            data={candidates}
            rowKey={(c) => c.occupancyId}
            onRowClick={(c) => setSelectedId(c.occupancyId)}
            activeKey={selectedId}
            stickyHeader
            bare
            emptyMessage="No rooms are eligible for checkout"
            emptyIcon="✓"
          />
        </div>

        {/* Right — detail panel (30%) */}
        <div className="flex flex-col w-[30%] bg-(--color-surface-raised)">
          <DetailPanel
            candidate={selectedCandidate}
            onCheckout={handleCheckoutRequest}
            isProcessing={checkingOut}
          />
        </div>
      </div>

      {/* Late fee modal */}
      {lateFeeModal ? (
        <LateFeeModal
          customerLabel={`${lateFeeModal.candidate.customerName} · ${lateFeeModal.candidate.resourceType} ${lateFeeModal.candidate.number}`}
          resolved={lateFeeModal.resolved}
          onSettle={(payAtCheckout, paymentMethod) => {
            void doCheckout(lateFeeModal.candidate.occupancyId, payAtCheckout, paymentMethod);
          }}
          onDismiss={() => setLateFeeModal(null)}
          isProcessing={checkingOut}
        />
      ) : null}
    </PanelShell>
  );
}

export function CheckoutPanel() {
  return (
    <Suspense fallback={
      <PanelShell align="top" scroll="hidden">
        <div className="flex flex-col items-center justify-center h-full opacity-50">
          <p className="text-sm font-medium text-(--color-text-muted)">Loading checkout data...</p>
        </div>
      </PanelShell>
    }>
      <CheckoutPanelContent />
    </Suspense>
  );
}
