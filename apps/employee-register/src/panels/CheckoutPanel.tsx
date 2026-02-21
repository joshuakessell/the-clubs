import { useEffect, useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

interface Candidate {
  occupancyId: string;
  resourceType: string;
  number: string;
  customerName: string;
  checkinAt: string;
  scheduledCheckoutAt: string;
  isOverdue: boolean;
}

/**
 * CheckoutPanel — Manual checkout flow.
 * Fetches real checkout candidates from GET /v1/checkout/manual-candidates.
 */
export function CheckoutPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [confirmCandidate, setConfirmCandidate] = useState<Candidate | null>(null);
  const token = useAuthStore((s) => s.session?.sessionToken);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/checkout/manual-candidates'), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidates(data.candidates ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  const handleCheckout = async (occupancyId: string) => {
    setCheckingOut(occupancyId);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/checkout/manual-complete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ occupancyId }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      // Remove from list
      setCandidates((prev) => prev.filter((c) => c.occupancyId !== occupancyId));
    } catch (err: any) {
      setError(err.message ?? 'Checkout failed');
    } finally {
      setCheckingOut(null);
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <PanelShell align="top" scroll="hidden">
      <div className="flex items-center justify-between">
        <PanelHeader title="Checkout" subtitle="Select occupied rooms to check out" />
        <button
          onClick={() => void fetchCandidates()}
          disabled={loading}
          className="ml-auto rounded-md px-3 py-1 text-xs font-semibold transition"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-default)',
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>
          {error}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Room</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Customer</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Since</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Type</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' } as React.CSSProperties}>
            {candidates.map((c) => (
              <tr
                key={c.occupancyId}
                className="transition"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <td className="px-4 py-3 text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                  {c.number}
                  {c.isOverdue && (
                    <span className="ml-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: 'var(--color-status-error)' }}>
                      OVERDUE
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{c.customerName}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{formatTime(c.checkinAt)}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{c.resourceType}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    disabled={checkingOut === c.occupancyId}
                    onClick={() => setConfirmCandidate(c)}
                    className="rounded-md px-3 py-1 text-xs font-semibold transition"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--color-status-error)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                    }}
                  >
                    {checkingOut === c.occupancyId ? 'Processing…' : 'Check Out'}
                  </button>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  No rooms are due for checkout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Confirmation Dialog ─────────────────────── */}
      {confirmCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setConfirmCandidate(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-xl border p-6 shadow-2xl"
            style={{ backgroundColor: '#1e1e2e', borderColor: 'var(--color-border-default)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-bold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              Confirm Checkout
            </h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Are you sure you want to check out{' '}
              <strong style={{ color: 'var(--color-text-primary)' }}>{confirmCandidate.customerName}</strong>{' '}
              from <strong style={{ color: 'var(--color-text-primary)' }}>{confirmCandidate.resourceType} {confirmCandidate.number}</strong>?
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmCandidate(null)}
                className="rounded-md px-4 py-2 text-sm font-semibold transition"
                style={{
                  backgroundColor: 'var(--color-surface-overlay)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border-default)',
                }}
              >
                Cancel
              </button>
              <button
                disabled={checkingOut === confirmCandidate.occupancyId}
                onClick={() => {
                  const id = confirmCandidate.occupancyId;
                  setConfirmCandidate(null);
                  void handleCheckout(id);
                }}
                className="rounded-md px-4 py-2 text-sm font-semibold transition"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--color-status-error)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                {checkingOut === confirmCandidate.occupancyId ? 'Processing…' : 'Yes, Check Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
