import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { StatusDot } from '../components/StatusDot';
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

interface ResolvedDetails {
  lateMinutes: number;
  fee: number;
  banApplied: boolean;
}

/* ── Helpers ────────────────────────────────────────── */

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDuration(checkinAt: string) {
  const ms = Date.now() - new Date(checkinAt).getTime();
  const totalMin = Math.floor(ms / 60000);
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
      className="tabular-nums"
      style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
    >
      {time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

/** Row in the detail panel (label + value). */
function DetailRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      {children}
    </div>
  );
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
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!candidate) { setResolved(null); return; }
    let cancelled = false;
    setResolving(true);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(getApiUrl('/api/v1/checkout/manual-resolve'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ occupancyId: candidate.occupancyId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setResolved({ lateMinutes: d.lateMinutes ?? 0, fee: d.fee ?? 0, banApplied: !!d.banApplied });
      })
      .catch(() => { if (!cancelled) setResolved(null); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [candidate?.occupancyId, token]);

  if (!candidate) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-center px-6"
        style={{ color: 'var(--color-text-muted)' }}
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

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      {/* Customer header */}
      <div>
        <div
          className="text-xs font-semibold uppercase tracking-wider mb-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {candidate.resourceType} {candidate.number}
        </div>
        <div
          className="text-lg font-bold"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {candidate.customerName}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          In {formatDuration(candidate.checkinAt)} · checked in {formatTime(candidate.checkinAt)}
        </div>
      </div>

      <div className="h-px w-full" style={{ background: 'var(--color-border-subtle)' }} />

      {/* Detail rows */}
      <div className="flex flex-col gap-2">
        <DetailRow label="Current time"><LiveClock /></DetailRow>
        <DetailRow label="Scheduled out">
          <span style={{ color: candidate.isOverdue ? 'var(--color-status-error)' : 'var(--color-text-primary)' }}>
            {formatTime(candidate.scheduledCheckoutAt)}
          </span>
        </DetailRow>

        {resolving ? (
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Calculating fees…</div>
        ) : isOverdue ? (
          <>
            <DetailRow label="Late">
              <span className="font-semibold" style={{ color: 'var(--color-status-error)' }}>
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
        ) : (
          <div className="text-sm" style={{ color: 'var(--color-status-success)' }}>✓ No late fee</div>
        )}
      </div>

      {/* Checkout button */}
      <button
        disabled={isProcessing || resolving}
        onClick={() => onCheckout(candidate, resolved)}
        className="w-full rounded-lg py-2 text-sm font-bold"
        style={{
          backgroundColor: isProcessing
            ? 'var(--color-surface-overlay)'
            : 'color-mix(in oklch, var(--color-status-error) 12%, transparent)',
          color: isProcessing ? 'var(--color-text-muted)' : 'var(--color-status-error)',
          border: '1px solid color-mix(in oklch, var(--color-status-error) 25%, transparent)',
          cursor: isProcessing || resolving ? 'not-allowed' : 'pointer',
          opacity: resolving ? 0.6 : 1,
          transition: 'opacity 0.15s ease',
        }}
      >
        {isProcessing ? 'Processing…' : '↩ Check Out'}
      </button>
    </div>
  );
}

/** Late fee settlement modal. */
function LateFeeModal({
  candidate,
  resolved,
  onSettle,
  onDismiss,
  isProcessing,
}: Readonly<{
  candidate: Candidate;
  resolved: ResolvedDetails;
  onSettle: (payAtCheckout: boolean, paymentMethod?: 'CREDIT' | 'CASH') => void;
  onDismiss: () => void;
  isProcessing: boolean;
}>) {
  const feeDollars = resolved.fee.toFixed(2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onDismiss}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                Late Checkout Fee
              </h3>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {candidate.customerName} · {candidate.resourceType} {candidate.number}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)',
              border: '1px solid color-mix(in oklch, var(--color-status-error) 15%, transparent)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Late by
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--color-status-error)' }}>
                {resolved.lateMinutes} minutes
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Fee due
              </span>
              <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--color-status-error)', fontFamily: 'var(--font-display)' }}>
                ${feeDollars}
              </span>
            </div>
          </div>

          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {resolved.banApplied
              ? `This customer checked out ${resolved.lateMinutes} minutes late. A $${feeDollars} late fee applies and a potential 30-day ban has been flagged for manager review. Collect the fee now or it will be added as a past-due balance, which must be settled before the customer's next check-in.`
              : `This customer checked out ${resolved.lateMinutes} minutes late. A $${feeDollars} late fee applies. Collect the fee now or it will be added as a past-due balance, which must be settled before the customer's next check-in.`}
          </p>

          {/* Payment buttons */}
          <div className="flex gap-3">
            <button
              disabled={isProcessing}
              onClick={() => onSettle(true, 'CREDIT')}
              className="flex-1 rounded-lg py-3 text-sm font-bold flex flex-col items-center gap-1"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
                color: 'var(--color-status-success)',
                border: '1px solid color-mix(in oklch, var(--color-status-success) 25%, transparent)',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.15s ease',
                opacity: isProcessing ? 0.5 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
              Pay by Card
            </button>
            <button
              disabled={isProcessing}
              onClick={() => onSettle(true, 'CASH')}
              className="flex-1 rounded-lg py-3 text-sm font-bold flex flex-col items-center gap-1"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
                color: 'var(--color-status-success)',
                border: '1px solid color-mix(in oklch, var(--color-status-success) 25%, transparent)',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.15s ease',
                opacity: isProcessing ? 0.5 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
              Pay by Cash
            </button>
          </div>

          {/* Skip / past due */}
          <div className="text-center pt-1 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <button
              disabled={isProcessing}
              onClick={() => onSettle(false)}
              className="text-xs py-2 px-4"
              style={{
                color: 'var(--color-text-muted)',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: 'none',
                border: 'none',
                transition: 'opacity 0.15s ease',
                opacity: isProcessing ? 0.5 : 1,
              }}
            >
              Skip — Add ${feeDollars} to Past Due Balance
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────── */

/**
 * CheckoutPanel — Manual checkout flow.
 * 70/30 split: DataTable on the left, checkout detail panel on the right.
 */
export function CheckoutPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lateFeeModal, setLateFeeModal] = useState<{ candidate: Candidate; resolved: ResolvedDetails } | null>(null);

  const token = useAuthStore((s) => s.session?.sessionToken);
  const openCustomerAccount = useRegisterStore((s) => s.openCustomerAccount);
  const didAutoSelect = useRef(false);

  /* ── Data fetching ── */
  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/checkout/manual-candidates'), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows: Candidate[] = data.candidates ?? [];
      setCandidates(rows);
      if (!didAutoSelect.current && rows.length > 0) {
        setSelectedId(rows[0]!.occupancyId);
        didAutoSelect.current = true;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchCandidates(); }, [fetchCandidates]);

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/checkout/manual-complete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ occupancyId, payAtCheckout, paymentMethod }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as Record<string, string>).error ?? `HTTP ${res.status}`);
      }
      // Remove and select next
      setCandidates((prev) => {
        const idx = prev.findIndex((c) => c.occupancyId === occupancyId);
        const next = prev.filter((c) => c.occupancyId !== occupancyId);
        if (next.length > 0) {
          const nextIdx = Math.min(idx, next.length - 1);
          setSelectedId(next[nextIdx]!.occupancyId);
        } else {
          setSelectedId(null);
        }
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckingOut(false);
    }
  }, [token]);

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
            className="font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
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
          className="text-left font-medium hover:underline"
          style={{ color: 'var(--color-accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          {c.customerName}
        </button>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <span style={{ color: 'var(--color-text-muted)' }}>{c.resourceType}</span>
      ),
    },
    {
      key: 'checkin',
      header: 'Check-In',
      numeric: true,
      render: (c) => (
        <span style={{ color: 'var(--color-text-muted)' }}>{formatTime(c.checkinAt)}</span>
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
        <PanelHeader title="Checkout" subtitle="Select a room to check out" />
        <button
          onClick={() => void fetchCandidates()}
          disabled={loading}
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-semibold"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-default)',
            transition: 'opacity 0.15s ease',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
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
          {error}
        </p>
      ) : null}

      {/* 70/30 split */}
      <div
        className="flex gap-0 flex-1 min-h-0 overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        {/* Left — DataTable (70%) */}
        <div className="flex flex-col overflow-auto border-r" style={{ width: '70%', borderColor: 'var(--color-border-default)' }}>
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
        <div className="flex flex-col" style={{ width: '30%', backgroundColor: 'var(--color-surface-raised)' }}>
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
          candidate={lateFeeModal.candidate}
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
