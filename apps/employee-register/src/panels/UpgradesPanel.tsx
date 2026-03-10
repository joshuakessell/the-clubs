import { useState, useEffect, useCallback, useMemo } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
import { StatusDot } from '../components/StatusDot';
import { UpgradePaymentModal } from './UpgradePaymentModal';

/* ── Types ──────────────────────────────────────────── */

interface WaitlistEntry {
  id: string;
  visitId: string;
  checkinBlockId: string;
  customerId: string;
  desiredTier: string;
  desiredTiers: string[];
  backupTier: string;
  status: string;
  createdAt: string;
  offeredAt?: string | null;
  resourceId?: string | null;
  offeredRoomNumber?: string | null;
  displayIdentifier: string;
  currentRentalType: string;
  currentRoomTier?: string | null;
  customerName: string;
}

interface RoomAvailability {
  STANDARD: number;
  DOUBLE: number;
  SPECIAL: number;
}

interface FulfillResult {
  waitlistId: string;
  orderId: string;
  upgradeFee: number;
  newResourceId: string;
  newRoomNumber: string;
  newRoomTier: string;
  fromTier: string;
  originalCharges: Array<{ description: string; amount: number }>;
  originalTotal: number | null;
}

/* ── Constants ──────────────────────────────────────── */

const TIER_COLUMNS = ['STANDARD', 'DOUBLE', 'SPECIAL'] as const;
const TIER_LABELS: Record<string, string> = {
  STANDARD: 'Private Rooms',
  DOUBLE: 'Double Rooms',
  SPECIAL: 'Special Rooms',
};
const TIER_COLORS: Record<string, string> = {
  STANDARD: 'var(--color-accent-primary)',
  DOUBLE: 'var(--color-status-warning)',
  SPECIAL: 'var(--color-status-success)',
};

/** Rank for sorting: lower = higher priority in the upgrade queue */
const TIER_RANK: Record<string, number> = { LOCKER: 0, STANDARD: 1, DOUBLE: 2, SPECIAL: 3 };

/** Upgrade prices from locker to room type */
const UPGRADE_PRICES: Record<string, number> = { STANDARD: 8, DOUBLE: 17, SPECIAL: 27 };

const POLL_INTERVAL = 15_000;

/* ── Helpers ────────────────────────────────────────── */

/** Map desired tiers (Postgres array format etc.) to JS array */
function normalizeDesiredTiers(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  if (raw.startsWith('{')) {
    return raw.replaceAll(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return (parsed as unknown[]).map(String);
    if (parsed !== null && parsed !== undefined) return [String(parsed)];
  } catch { /* fall through */ }
  return [raw];
}

/** Get the primary desired tier for an entry (single column placement) */
function getPrimaryTier(entry: WaitlistEntry): string {
  // Use the primary desiredTier field first, fall back to first of desiredTiers array
  if (entry.desiredTier && TIER_COLUMNS.includes(entry.desiredTier as typeof TIER_COLUMNS[number])) {
    return entry.desiredTier;
  }
  const tiers = normalizeDesiredTiers(entry.desiredTiers);
  return tiers[0] ?? 'STANDARD';
}

/** Singular label for a tier */
const TIER_LABEL_SINGULAR: Record<string, string> = {
  STANDARD: 'Private Room',
  DOUBLE: 'Double Room',
  SPECIAL: 'Special Room',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Sub-components (Vercel composition) ───────────── */

/** Tier availability counter with color indicator */
function TierAvailBadge({ tier, count }: Readonly<{ tier: string; count: number }>) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
      style={{ color: 'var(--color-text-secondary)' }}
    >
      {TIER_LABELS[tier]}:
      <strong
        className="tabular-nums"
        style={{ color: count > 0 ? 'var(--color-status-success)' : 'var(--color-text-muted)' }}
      >
        {count}
      </strong>
    </span>
  );
}

/** Tier column header with colored underline */
function TierColumnHeader({ tier, count }: Readonly<{ tier: string; count: number }>) {
  return (
    <div
      className="text-center py-2"
      style={{ borderBottom: `2px solid ${TIER_COLORS[tier]}` }}
    >
      <span
        className="text-xs font-bold uppercase tracking-wider"
        style={{ color: TIER_COLORS[tier] }}
      >
        {TIER_LABELS[tier]}
      </span>
      <span
        className="ml-1.5 text-[10px] font-semibold tabular-nums"
        style={{ color: count > 0 ? 'var(--color-status-success)' : 'var(--color-text-muted)' }}
      >
        ({count} avail)
      </span>
    </div>
  );
}

/** Action buttons for a waitlist entry */
function EntryActions({
  entry,
  isOffered,
  eligible,
  submitting,
  confirmingCancelId,
  onOfferClick,
  onUpgrade,
  onCancelTap,
  onCancelConfirm,
}: Readonly<{
  entry: WaitlistEntry;
  isOffered: boolean;
  eligible: boolean;
  submitting: boolean;
  confirmingCancelId: string | null;
  onOfferClick: (e: WaitlistEntry) => void;
  onUpgrade: (e: WaitlistEntry) => void;
  onCancelTap: (id: string) => void;
  onCancelConfirm: (e: WaitlistEntry) => void;
}>) {
  const actionBtnBase = 'w-full rounded-lg px-3 py-1.5 text-xs font-bold text-center';

  const cancelBtnStyle = {
    backgroundColor: 'color-mix(in oklch, var(--color-status-error) 12%, transparent)',
    color: 'var(--color-status-error)',
    border: '1px solid color-mix(in oklch, var(--color-status-error) 25%, transparent)',
    opacity: submitting ? 0.4 : 1,
    cursor: submitting ? 'not-allowed' : 'pointer',
    transition: 'opacity 0.15s ease',
  } as const;

  return (
    <div className="flex flex-col gap-1 mt-2">
      {isOffered ? (
        <>
          <button
            onClick={() => onUpgrade(entry)}
            disabled={submitting}
            className={actionBtnBase}
            style={{
              backgroundColor: 'var(--color-status-warning)',
              color: '#000',
              transition: 'opacity 0.15s ease',
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Upgrade
          </button>
          {/* Cancel Offer — immediately revokes the room hold, no confirmation needed */}
          <button
            onClick={() => onCancelConfirm(entry)}
            disabled={submitting}
            className={actionBtnBase}
            aria-label={`Cancel offer for ${entry.customerName}`}
            style={cancelBtnStyle}
          >
            Cancel Offer
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => onOfferClick(entry)}
            disabled={submitting || !eligible}
            className={actionBtnBase}
            style={{
              backgroundColor: eligible ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: eligible ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              cursor: eligible ? 'pointer' : 'not-allowed',
              opacity: eligible ? 1 : 0.5,
              transition: 'opacity 0.15s ease',
            }}
          >
            Offer Room
          </button>
          {/* Cancel — requires confirmation to remove from waitlist */}
          {confirmingCancelId === entry.id ? (
            <button
              onClick={() => onCancelConfirm(entry)}
              disabled={submitting}
              className={actionBtnBase}
              aria-label={`Confirm cancel for ${entry.customerName}`}
              style={{
                backgroundColor: 'var(--color-status-error)',
                color: 'var(--color-text-inverse)',
                transition: 'opacity 0.15s ease',
                opacity: submitting ? 0.5 : 1,
              }}
            >
              Confirm?
            </button>
          ) : (
            <button
              onClick={() => onCancelTap(entry.id)}
              disabled={submitting}
              className={actionBtnBase}
              aria-label={`Cancel upgrade for ${entry.customerName}`}
              style={cancelBtnStyle}
            >
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Room picker modal — shown when employee clicks "Offer Room" */
function RoomPickerModal({
  entry,
  rooms,
  loadingRooms,
  onSelectRoom,
  onClose,
}: Readonly<{
  entry: WaitlistEntry;
  rooms: Record<string, Array<{ id: string; number: string; type: string }>>;
  loadingRooms: boolean;
  onSelectRoom: (entry: WaitlistEntry, roomId: string) => void;
  onClose: () => void;
}>) {
  const primaryTier = getPrimaryTier(entry);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select a room to offer"
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3
              className="text-base font-bold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            >
              Offer Room to {entry.customerName}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Locker {entry.displayIdentifier} · Select a room to offer
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="h-px w-full" style={{ background: 'var(--color-border-subtle)' }} />

        {/* Room list */}
        <div className="px-5 py-4 max-h-[50vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {loadingRooms ? (
            <div className="text-center py-8">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading rooms…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {TIER_COLUMNS.map((tier) => {
                const tierRooms = rooms[tier] ?? [];
                const price = UPGRADE_PRICES[tier] ?? 0;
                if (tierRooms.length === 0) return null;
                return (
                  <div key={tier}>
                    {/* Tier header */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: TIER_COLORS[tier] }}
                        >
                          {TIER_LABELS[tier] ?? tier}
                        </span>
                        {tier === primaryTier && (
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 15%, transparent)',
                              color: 'var(--color-accent-primary)',
                            }}
                          >
                            Preferred
                          </span>
                        )}
                      </span>
                      <span
                        className="text-xs font-bold tabular-nums"
                        style={{ color: 'var(--color-status-success)' }}
                      >
                        ${price} upgrade
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {tierRooms.map((room) => (
                        <button
                          key={room.id}
                          onClick={() => onSelectRoom(entry, room.id)}
                          className="rounded-lg py-2 text-sm font-bold tabular-nums transition-all hover:scale-105"
                          style={{
                            backgroundColor: 'var(--color-surface-input)',
                            color: 'var(--color-text-primary)',
                            border: `1px solid ${TIER_COLORS[tier] ?? 'var(--color-border-default)'}`,
                            cursor: 'pointer',
                            fontFamily: 'var(--font-display)',
                          }}
                        >
                          {room.number}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Single waitlist entry row (spans across tier columns) */
function WaitlistRow({
  entry,
  queuePos,
  isFirstEligible,
  eligible,
  submitting,
  confirmingCancelId,
  activeTiers,
  onOfferClick,
  onUpgrade,
  onCancelTap,
  onCancelConfirm,
}: Readonly<{
  entry: WaitlistEntry;
  queuePos: number;
  isFirstEligible: boolean;
  eligible: boolean;
  submitting: boolean;
  confirmingCancelId: string | null;
  activeTiers: string[];
  onOfferClick: (e: WaitlistEntry) => void;
  onUpgrade: (e: WaitlistEntry) => void;
  onCancelTap: (id: string) => void;
  onCancelConfirm: (e: WaitlistEntry) => void;
}>) {
  const primaryTier = getPrimaryTier(entry);
  const colIndex = activeTiers.indexOf(primaryTier);
  const isOffered = entry.status === 'OFFERED';
  const colCount = activeTiers.length;
  // If the entry's tier isn't in active columns, place in first column
  const col = colIndex >= 0 ? colIndex : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, 1fr)`,
        gap: '2px',
      }}
    >
      {/* Empty cells before */}
      {col > 0 ? <div style={{ gridColumn: `1 / ${col + 1}` }} /> : null}

      {/* Entry cell — single column, vertical layout */}
      <div
        className="rounded-xl px-3 py-2.5"
        style={{
          gridColumn: `${col + 1} / ${col + 2}`,
          backgroundColor: isOffered
            ? 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)'
            : 'var(--color-surface-input)',
          border: `1px solid ${
            isOffered
              ? 'color-mix(in oklch, var(--color-status-warning) 25%, transparent)'
              : 'var(--color-border-subtle)'
          }`,
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
        }}
      >
        {/* Top: name + status */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-bold tabular-nums shrink-0"
            style={{
              color: isFirstEligible ? 'var(--color-status-success)' : 'var(--color-text-muted)',
            }}
          >
            #{String(queuePos).padStart(2, '0')}
          </span>
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {entry.customerName}
          </span>
          <StatusDot
            status={isOffered ? 'OFFERED' : 'WAITING'}
            label={isOffered ? 'Offered' : 'Waiting'}
            size="sm"
          />
        </div>

        {/* Meta info */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {entry.currentRentalType === 'LOCKER' ? `Locker ${entry.displayIdentifier}` : entry.displayIdentifier}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>·</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {timeAgo(entry.createdAt)}
          </span>
          {isOffered && entry.offeredRoomNumber ? (
            <>
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>·</span>
              <span
                className="text-[11px] font-medium"
                style={{ color: 'var(--color-status-warning)' }}
              >
                Room {entry.offeredRoomNumber}
              </span>
            </>
          ) : null}
        </div>

        {/* Actions — stacked below content */}
        <EntryActions
          entry={entry}
          isOffered={isOffered}
          eligible={eligible}
          submitting={submitting}
          confirmingCancelId={confirmingCancelId}
          onOfferClick={onOfferClick}
          onUpgrade={onUpgrade}
          onCancelTap={onCancelTap}
          onCancelConfirm={onCancelConfirm}
        />
      </div>

      {/* Empty cells after */}
      {col + 1 < colCount ? <div style={{ gridColumn: `${col + 2} / ${colCount + 1}` }} /> : null}
    </div>
  );
}

/* ── Main Component ────────────────────────────────── */

export function UpgradesPanel() {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [availability, setAvailability] = useState<RoomAvailability>({ STANDARD: 0, DOUBLE: 0, SPECIAL: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payment modal state
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    entry: WaitlistEntry | null;
    fulfill: FulfillResult | null;
    paymentStatus: 'DUE' | 'PAID' | null;
  }>({ open: false, entry: null, fulfill: null, paymentStatus: null });
  // Room picker modal state
  const [roomPicker, setRoomPicker] = useState<{
    entry: WaitlistEntry | null;
    rooms: Record<string, Array<{ id: string; number: string; type: string }>>;
    loading: boolean;
  }>({ entry: null, rooms: {}, loading: false });
  const [submitting, setSubmitting] = useState(false);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  /* ── Data fetching ── */
  const fetchData = useCallback(async () => {
    try {
      const h = headers();
      const [activeRes, offeredRes, invRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/waitlist?status=ACTIVE'), { headers: h }),
        fetch(getApiUrl('/api/v1/waitlist?status=OFFERED'), { headers: h }),
        fetch(getApiUrl('/api/v1/inventory/detailed'), { headers: h }),
      ]);

      if (!activeRes.ok || !offeredRes.ok || !invRes.ok) throw new Error('Fetch failed');

      const [activeData, offeredData, invData] = await Promise.all([
        activeRes.json(),
        offeredRes.json(),
        invRes.json(),
      ]);

      const all = [...(offeredData.entries ?? []), ...(activeData.entries ?? [])];
      // Sort by upgrade progression (locker → standard → double → special), FIFO within each
      all.sort((a: WaitlistEntry, b: WaitlistEntry) => {
        const aFrom = a.currentRentalType === 'LOCKER' ? 'LOCKER' : (a.currentRoomTier ?? 'STANDARD');
        const bFrom = b.currentRentalType === 'LOCKER' ? 'LOCKER' : (b.currentRoomTier ?? 'STANDARD');
        const rankDiff = (TIER_RANK[aFrom] ?? 99) - (TIER_RANK[bFrom] ?? 99);
        if (rankDiff !== 0) return rankDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      setEntries(all);

      const rooms: Array<{ tier: string; status: string; assignedTo?: string; occupancyId?: string }> = invData.rooms ?? [];
      const avail: RoomAvailability = { STANDARD: 0, DOUBLE: 0, SPECIAL: 0 };
      for (const r of rooms) {
        if (r.status === 'CLEAN' && !r.assignedTo && !r.occupancyId && r.tier in avail) {
          avail[r.tier as keyof RoomAvailability]++;
        }
      }
      setAvailability(avail);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  const refreshRentalsTrigger = useRegisterStore((s) => s.refreshRentalsTrigger);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData, refreshRentalsTrigger]);

  /* ── Open room picker ── */
  const handleOpenRoomPicker = useCallback(async (entry: WaitlistEntry) => {
    setRoomPicker({ entry, rooms: {}, loading: true });
    try {
      const h = headers();
      // Fetch ALL tier rooms so employee can choose any type
      const results = await Promise.all(
        TIER_COLUMNS.map(async (tier) => {
          const res = await fetch(
            getApiUrl(`/api/v1/rooms/offerable?tier=${encodeURIComponent(tier)}`),
            { headers: h }
          );
          if (!res.ok) return { tier, rooms: [] };
          const data = await res.json();
          return { tier, rooms: data.rooms ?? [] };
        })
      );
      const grouped: Record<string, Array<{ id: string; number: string; type: string }>> = {};
      for (const r of results) grouped[r.tier] = r.rooms;
      setRoomPicker({ entry, rooms: grouped, loading: false });
    } catch {
      setError('Failed to load available rooms');
      setRoomPicker({ entry: null, rooms: {}, loading: false });
    }
  }, [headers]);

  /* ── Offer specific room ── */
  const handleOfferRoom = useCallback(async (entry: WaitlistEntry, roomId: string) => {
    setRoomPicker({ entry: null, rooms: {}, loading: false });
    setSubmitting(true);
    try {
      const h = headers();
      const offerRes = await fetch(getApiUrl(`/api/v1/waitlist/${entry.id}/offer`), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId: roomId }),
      });
      if (!offerRes.ok) {
        const err = await offerRes.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Offer failed');
      }
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Offer failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, fetchData]);

  /* ── Start upgrade payment ── */
  const handleStartUpgrade = useCallback(async (entry: WaitlistEntry) => {
    setSubmitting(true);
    try {
      const h = headers();
      if (!entry.resourceId) throw new Error('No room offered');

      const res = await fetch(getApiUrl('/api/v1/upgrades/fulfill'), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlistId: entry.id, resourceId: entry.resourceId, acknowledgedDisclaimer: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Fulfill failed');
      }
      const result: FulfillResult = await res.json();
      setPaymentModal({ open: true, entry, fulfill: result, paymentStatus: 'DUE' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upgrade failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers]);

  /* ── Payment ── */
  const handlePay = useCallback(async (method: 'CREDIT' | 'CASH') => {
    if (!paymentModal.fulfill) return;
    setSubmitting(true);
    try {
      const h = headers();
      const payRes = await fetch(
        getApiUrl(`/api/v1/payments/${paymentModal.fulfill.orderId}/mark-paid`),
        {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentMethod: method }),
        }
      );
      if (!payRes.ok) throw new Error('Payment failed');
      setPaymentModal((prev) => ({ ...prev, paymentStatus: 'PAID' }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, paymentModal.fulfill]);

  /* ── Complete upgrade ── */
  const handleComplete = useCallback(async () => {
    if (!paymentModal.fulfill) return;
    setSubmitting(true);
    try {
      const h = headers();
      const res = await fetch(getApiUrl('/api/v1/upgrades/complete'), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waitlistId: paymentModal.fulfill.waitlistId,
          orderId: paymentModal.fulfill.orderId,
        }),
      });
      if (!res.ok) throw new Error('Complete failed');
      setPaymentModal({ open: false, entry: null, fulfill: null, paymentStatus: null });
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Complete failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, paymentModal.fulfill, fetchData]);

  /* ── Cancel (two-tap) ── */
  const handleCancelTap = useCallback((entryId: string) => {
    if (confirmingCancelId === entryId) return;
    setConfirmingCancelId(entryId);
    setTimeout(() => setConfirmingCancelId((prev) => (prev === entryId ? null : prev)), 3000);
  }, [confirmingCancelId]);

  const handleCancelConfirm = useCallback(async (entry: WaitlistEntry) => {
    setConfirmingCancelId(null);
    setSubmitting(true);
    try {
      const h = headers();
      const res = await fetch(getApiUrl(`/api/v1/waitlist/${entry.id}/cancel`), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlistId: entry.id, reason: 'Cancelled by staff' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Cancel failed');
      }
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, fetchData]);

  /* ── Derived state (memoized) ── */
  const canOffer = useCallback((entry: WaitlistEntry): boolean => {
    if (entry.status !== 'ACTIVE') return false;
    // Enable when any room of desired tier or higher is available
    // Tier hierarchy: STANDARD (1) < DOUBLE (2) < SPECIAL (3)
    const tier = getPrimaryTier(entry);
    const rank = TIER_RANK[tier] ?? 1;
    return TIER_COLUMNS.some(
      (t) => (TIER_RANK[t] ?? 0) >= rank && (availability[t as keyof RoomAvailability] ?? 0) > 0
    );
  }, [availability]);

  /** Only show tier columns that have entries wanting that tier */
  const activeTiers = useMemo(() => {
    const tiersWithEntries = new Set<string>();
    for (const entry of entries) {
      tiersWithEntries.add(getPrimaryTier(entry));
    }
    return TIER_COLUMNS.filter(
      (t) => tiersWithEntries.has(t)
    ) as string[];
  }, [entries]);

  const firstEligibleIds = useMemo(() => {
    const ids = new Set<string>();
    const claimedTiers = new Set<string>();
    for (const entry of entries) {
      if (entry.status !== 'ACTIVE') continue;
      const tier = getPrimaryTier(entry);
      if (!claimedTiers.has(tier) && (availability[tier as keyof RoomAvailability] ?? 0) > 0) {
        ids.add(entry.id);
        claimedTiers.add(tier);
      }
    }
    return ids;
  }, [entries, availability]);

  /* ── Loading state ── */
  if (loading) {
    return (
      <PanelShell align="center">
        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading upgrades…</div>
      </PanelShell>
    );
  }

  /* ── Render ── */
  return (
    <PanelShell align="top" card={false} scroll="hidden">
      <div
        className="flex flex-col flex-1 min-h-0 rounded-xl border p-5 w-full"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-default)',
        }}
      >
        {/* Header with availability */}
        <PanelHeader
          title="Upgrades"
          subtitle="Waitlist queue — rooms offered first-come-first-served"
          action={
            error ? (
              <span className="text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>
                {error}
              </span>
            ) : (
              <div className="flex gap-3">
                {TIER_COLUMNS.map((tier) => (
                  <TierAvailBadge key={tier} tier={tier} count={availability[tier]} />
                ))}
              </div>
            )
          }
        />

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-3xl">🎉</span>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
              No active upgrade requests
            </p>
          </div>
        ) : (
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {/* Column headers — only active tiers */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${activeTiers.length}, 1fr)`, gap: '2px', marginBottom: '2px' }}>
              {activeTiers.map((tier) => (
                <TierColumnHeader key={tier} tier={tier} count={availability[tier as keyof RoomAvailability]} />
              ))}
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {entries.map((entry, idx) => (
                <WaitlistRow
                  key={entry.id}
                  entry={entry}
                  queuePos={idx + 1}
                  isFirstEligible={firstEligibleIds.has(entry.id)}
                  eligible={canOffer(entry)}
                  submitting={submitting}
                  confirmingCancelId={confirmingCancelId}
                  activeTiers={activeTiers}
                  onOfferClick={(e) => void handleOpenRoomPicker(e)}
                  onUpgrade={(e) => void handleStartUpgrade(e)}
                  onCancelTap={handleCancelTap}
                  onCancelConfirm={(e) => void handleCancelConfirm(e)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Room picker modal */}
      {roomPicker.entry ? (
        <RoomPickerModal
          entry={roomPicker.entry}
          rooms={roomPicker.rooms}
          loadingRooms={roomPicker.loading}
          onSelectRoom={handleOfferRoom}
          onClose={() => setRoomPicker({ entry: null, rooms: {}, loading: false })}
        />
      ) : null}

      {/* Payment modal */}
      {paymentModal.open && paymentModal.entry && paymentModal.fulfill ? (
        <UpgradePaymentModal
          isOpen={paymentModal.open}
          onClose={() => setPaymentModal({ open: false, entry: null, fulfill: null, paymentStatus: null })}
          customerLabel={paymentModal.entry.customerName}
          newRoomNumber={paymentModal.fulfill.newRoomNumber}
          originalCharges={paymentModal.fulfill.originalCharges}
          originalTotal={paymentModal.fulfill.originalTotal}
          upgradeFee={paymentModal.fulfill.upgradeFee}
          paymentStatus={paymentModal.paymentStatus}
          isSubmitting={submitting}
          canComplete={paymentModal.paymentStatus === 'PAID'}
          onPayCredit={() => void handlePay('CREDIT')}
          onPayCash={() => void handlePay('CASH')}
          onComplete={() => void handleComplete()}
        />
      ) : null}
    </PanelShell>
  );
}
