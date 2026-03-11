import { useCallback, useState, useEffect, useRef } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface WaitlistEntry {
  id: string;
  customerId: string;
  customerName: string;
  desiredTier: string;
  desiredTiers?: string[];
  backupTier: string | null;
  currentRentalType: string;
  displayIdentifier: string;
  status: string;
  createdAt: string;
  checkinAt: string;
  checkoutAt: string;
  offeredRoomNumber: string | null;
  offerExpiresAt: string | null;
}

interface OfferableRoom {
  id: string;
  number: string;
  tier: string;
}

/* ── Helpers ───────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, 'warning' | 'primary' | 'success' | 'gray'> = {
  ACTIVE: 'warning',
  OFFERED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'gray',
  EXPIRED: 'gray',
};

type FilterTab = 'pending' | 'all';

const POLL_MS = 15_000;

function formatWaitTime(createdAt: string): string {
  const mins = Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

function formatCountdown(expiresAt: string): string {
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (remaining <= 0) return 'Expired';
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

/* ── Component ─────────────────────────────────────────────────── */

export function WaitlistView() {
  const [filter, setFilter] = useState<FilterTab>('pending');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [offeringId, setOfferingId] = useState<string | null>(null);
  const [, setTick] = useState(0); // for countdown re-render

  const { data, loading, error, refetch } = useDashboardFetch<{ entries: WaitlistEntry[] }>(
    '/api/v1/waitlist',
  );
  const allEntries = data?.entries ?? [];

  // Auto-refresh every 15s + countdown ticker every second
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    const poll = setInterval(() => void refetchRef.current(), POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  const entries = filter === 'pending'
    ? allEntries.filter((e) => e.status === 'ACTIVE' || e.status === 'OFFERED')
    : allEntries;

  const pendingCount = allEntries.filter((e) => e.status === 'ACTIVE' || e.status === 'OFFERED').length;

  const handleRemove = useCallback(async (id: string) => {
    setRemovingId(id);
    try {
      await dashboardMutate(`/api/v1/waitlist/${id}/cancel`, 'POST');
      refetch();
    } catch { /* ignore */ }
    setRemovingId(null);
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Waitlist Management</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {pendingCount} pending · {allEntries.length} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
              <button type="button" className="px-3 py-1.5 text-xs font-medium transition"
                style={{
                  backgroundColor: filter === 'pending' ? 'var(--color-accent-primary)' : 'transparent',
                  color: filter === 'pending' ? '#fff' : 'var(--color-text-muted)',
                  borderRadius: 'calc(0.5rem - 1px)',
                }}
                onClick={() => setFilter('pending')}>
                Pending ({pendingCount})
              </button>
              <button type="button" className="px-3 py-1.5 text-xs font-medium transition"
                style={{
                  backgroundColor: filter === 'all' ? 'var(--color-accent-primary)' : 'transparent',
                  color: filter === 'all' ? '#fff' : 'var(--color-text-muted)',
                  borderRadius: 'calc(0.5rem - 1px)',
                }}
                onClick={() => setFilter('all')}>
                All ({allEntries.length})
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <ViewSpinner />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {filter === 'pending' ? 'No one is currently on the waitlist' : 'No waitlist entries found'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Customer', 'Current', 'Desired Upgrade', 'Wait Time', 'Status', 'Hold Timer', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b transition"
                  style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{e.customerName}</div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{e.displayIdentifier}</div>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {e.currentRentalType === 'LOCKER' ? '🔐 Locker' : '🚪 Room'}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {Array.isArray(e.desiredTiers) && e.desiredTiers.length > 0
                      ? e.desiredTiers.join(', ')
                      : e.desiredTier ?? '—'}
                    {e.offeredRoomNumber && (
                      <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--color-accent-primary)' }}>
                        → Room {e.offeredRoomNumber}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {formatWaitTime(e.createdAt)}
                  </td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLOR[e.status] ?? 'gray'} variant="light" size="sm">{e.status}</Badge></td>
                  <td className="px-4 py-3">
                    {e.status === 'OFFERED' && e.offerExpiresAt ? (
                      <span className="text-sm font-bold tabular-nums"
                        style={{ color: isExpired(e.offerExpiresAt) ? 'var(--color-status-error)' : 'var(--color-status-warning)' }}>
                        ⏱ {formatCountdown(e.offerExpiresAt)}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {e.status === 'ACTIVE' && (
                        <Button size="sm" variant="primary" onClick={() => setOfferingId(e.id)}>
                          Offer Room
                        </Button>
                      )}
                      {(e.status === 'ACTIVE' || e.status === 'OFFERED') && (
                        <Button size="sm" variant="ghost" onClick={() => handleRemove(e.id)}
                          disabled={removingId === e.id} style={{ color: 'var(--color-status-error)' }}>
                          {removingId === e.id ? 'Removing…' : 'Remove'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Offer Room Inline Panel */}
      {offeringId && (
        <OfferRoomPanel
          entry={allEntries.find((e) => e.id === offeringId)!}
          onClose={() => setOfferingId(null)}
          onComplete={() => { setOfferingId(null); refetch(); }}
        />
      )}
    </div>
  );
}

/* ── Offer Room Panel ──────────────────────────────────────────── */

function OfferRoomPanel({ entry, onClose, onComplete }: Readonly<{
  entry: WaitlistEntry;
  onClose: () => void;
  onComplete: () => void;
}>) {
  const tier = (Array.isArray(entry.desiredTiers) && entry.desiredTiers.length > 0)
    ? entry.desiredTiers[0]!
    : entry.desiredTier;

  const { data, loading } = useDashboardFetch<{ rooms: OfferableRoom[] }>(
    `/api/v1/rooms/offerable?tier=${tier}`,
  );
  const rooms = data?.rooms ?? [];
  const [submitting, setSubmitting] = useState(false);

  const handleOffer = async (roomId: string) => {
    setSubmitting(true);
    try {
      await dashboardMutate(`/api/v1/waitlist/${entry.id}/offer`, 'POST', { resourceId: roomId });
      onComplete();
    } catch { /* logged */ }
    setSubmitting(false);
  };

  return (
    <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-accent-primary)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
            Offer Room to {entry.customerName}
          </h3>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Desired: {tier} · Currently: {entry.displayIdentifier}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>✕ Cancel</Button>
      </div>
      <div className="mt-4">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading available rooms…</p>
        ) : rooms.length === 0 ? (
          <div className="rounded-lg border px-4 py-3 text-sm"
            style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)', color: 'var(--color-status-warning)' }}>
            No {tier} rooms are currently available
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {rooms.map((room) => (
              <button key={room.id} type="button"
                className="rounded-lg border px-3 py-2.5 text-center transition"
                style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'color-mix(in oklch, var(--color-accent-primary) 8%, transparent)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-input)'; }}
                disabled={submitting}
                onClick={() => handleOffer(room.id)}>
                <span className="text-base font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                  #{room.number}
                </span>
                <span className="block text-[10px] uppercase" style={{ color: 'var(--color-text-muted)' }}>{room.tier}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
