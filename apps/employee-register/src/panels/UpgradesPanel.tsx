import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { Badge, useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
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
  roomId?: string | null;
  offeredRoomNumber?: string | null;
  displayIdentifier: string;
  currentRentalType: string;
  customerName: string;
}

interface RoomAvailability {
  STANDARD: number;
  DOUBLE: number;
  SPECIAL: number;
}

interface FulfillResult {
  waitlistId: string;
  paymentIntentId: string;
  upgradeFee: number;
  newRoomId: string;
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

const POLL_INTERVAL = 15_000;

/* ── Helpers ────────────────────────────────────────── */

function tierIndex(tier: string): number {
  return TIER_COLUMNS.indexOf(tier as (typeof TIER_COLUMNS)[number]);
}

/**
 * Normalize desiredTiers from any format the API/DB may return:
 *  - Already a JS array          → use as-is
 *  - JSON string '["A","B"]'     → parse → array
 *  - JSON string '"A"'           → parse → wrap in array
 *  - PostgreSQL text[] '{A,B}'   → strip braces, split
 *  - null / undefined / other   → empty array
 */
function normalizeDesiredTiers(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  // PostgreSQL native text-array literal: "{STANDARD,DOUBLE}"
  if (raw.startsWith('{')) {
    return raw.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  // JSON-encoded value
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return (parsed as unknown[]).map(String);
    if (parsed !== null && parsed !== undefined) return [String(parsed)];
  } catch { /* fall through */ }
  return [raw];
}

/** Returns { startCol (0-based), span } for a set of desired tiers. */
function computeSpan(desiredTiersRaw: string[] | string | null | undefined): { startCol: number; span: number } {
  const desiredTiers = normalizeDesiredTiers(desiredTiersRaw);
  const indices = desiredTiers.map(tierIndex).filter((i) => i >= 0).sort((a, b) => a - b);
  if (indices.length === 0) return { startCol: 0, span: 1 };
  const min = indices[0]!;
  const max = indices.at(-1)!;
  return { startCol: min, span: max - min + 1 };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d`;
}

/* ── Component ──────────────────────────────────────── */

/**
 * UpgradesPanel — Three-column waitlist upgrade grid.
 *
 * Columns: Private Rooms | Double Rooms | Special Rooms
 * Each entry row spans columns matching desired_tiers.
 * Sorted by createdAt ASC (first-come-first-served).
 */
export function UpgradesPanel() {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [availability, setAvailability] = useState<RoomAvailability>({ STANDARD: 0, DOUBLE: 0, SPECIAL: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upgrade payment modal state
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    entry: WaitlistEntry | null;
    fulfill: FulfillResult | null;
    paymentStatus: 'DUE' | 'PAID' | null;
  }>({ open: false, entry: null, fulfill: null, paymentStatus: null });
  const [submitting, setSubmitting] = useState(false);

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchData = useCallback(async () => {
    try {
      const h = headers();
      const [activeRes, offeredRes, invRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/waitlist?status=ACTIVE'), { headers: h }),
        fetch(getApiUrl('/api/v1/waitlist?status=OFFERED'), { headers: h }),
        fetch(getApiUrl('/api/v1/inventory/detailed'), { headers: h }),
      ]);

      if (!activeRes.ok || !offeredRes.ok || !invRes.ok) throw new Error('Fetch failed');

      const activeData = await activeRes.json();
      const offeredData = await offeredRes.json();
      const invData = await invRes.json();

      const all = [...(offeredData.entries ?? []), ...(activeData.entries ?? [])];
      all.sort((a: WaitlistEntry, b: WaitlistEntry) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setEntries(all);

      // Count CLEAN rooms per tier
      const rooms: Array<{ tier: string; status: string }> = invData.rooms ?? [];
      const avail: RoomAvailability = { STANDARD: 0, DOUBLE: 0, SPECIAL: 0 };
      for (const r of rooms) {
        if (r.status === 'CLEAN' && r.tier in avail) {
          avail[r.tier as keyof RoomAvailability]++;
        }
      }
      setAvailability(avail);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Offer upgrade ── */
  const handleOffer = useCallback(async (entry: WaitlistEntry) => {
    setSubmitting(true);
    try {
      const h = headers();
      // Find an available room for the desired tier
      const roomsRes = await fetch(
        getApiUrl(`/api/v1/rooms/offerable?tier=${encodeURIComponent(entry.desiredTier)}`),
        { headers: h }
      );
      if (!roomsRes.ok) throw new Error('No rooms available');
      const { rooms } = await roomsRes.json();
      if (!rooms || rooms.length === 0) throw new Error('No rooms available');
      const room = rooms[0];

      const offerRes = await fetch(getApiUrl(`/api/v1/waitlist/${entry.id}/offer`), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!offerRes.ok) {
        const err = await offerRes.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Offer failed');
      }

      await fetchData();
    } catch (err: any) {
      setError(err.message ?? 'Offer failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, fetchData]);

  /* ── Start upgrade payment flow ── */
  const handleStartUpgrade = useCallback(async (entry: WaitlistEntry) => {
    setSubmitting(true);
    try {
      const h = headers();
      const roomId = entry.roomId;
      if (!roomId) throw new Error('No room offered');

      const res = await fetch(getApiUrl('/api/v1/upgrades/fulfill'), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlistId: entry.id, roomId, acknowledgedDisclaimer: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Fulfill failed');
      }
      const result: FulfillResult = await res.json();
      setPaymentModal({ open: true, entry, fulfill: result, paymentStatus: 'DUE' });
    } catch (err: any) {
      setError(err.message ?? 'Upgrade failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers]);

  /* ── Payment handler ── */
  const handlePay = useCallback(async (method: 'CREDIT' | 'CASH') => {
    if (!paymentModal.fulfill) return;
    setSubmitting(true);
    try {
      const h = headers();
      // Mark payment as paid
      const payRes = await fetch(
        getApiUrl(`/api/v1/checkin/payment-intent/${paymentModal.fulfill.paymentIntentId}/pay`),
        {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, paidByStaffId: null }),
        }
      );
      if (!payRes.ok) throw new Error('Payment failed');
      setPaymentModal((prev) => ({ ...prev, paymentStatus: 'PAID' }));
    } catch (err: any) {
      setError(err.message ?? 'Payment failed');
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
          paymentIntentId: paymentModal.fulfill.paymentIntentId,
        }),
      });
      if (!res.ok) throw new Error('Complete failed');
      setPaymentModal({ open: false, entry: null, fulfill: null, paymentStatus: null });
      await fetchData();
    } catch (err: any) {
      setError(err.message ?? 'Complete failed');
    } finally {
      setSubmitting(false);
    }
  }, [headers, paymentModal.fulfill, fetchData]);

  /* ── Check if an entry can be offered ── */
  const canOffer = useCallback((entry: WaitlistEntry): boolean => {
    if (entry.status !== 'ACTIVE') return false;
    // Normalize before .some() — same raw value as desiredTiers field
    return normalizeDesiredTiers(entry.desiredTiers).some(
      (t) => (availability[t as keyof RoomAvailability] ?? 0) > 0
    );
  }, [availability]);

  /* ── Render ── */

  if (loading) {
    return (
      <PanelShell align="center">
        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading upgrades…</div>
      </PanelShell>
    );
  }


  return (
    <PanelShell align="top" card={false} scroll="hidden">
      <div className="flex flex-col flex-1 min-h-0 rounded-xl border p-5 w-full" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <PanelHeader
          title="Upgrades"
          subtitle="Waitlist queue — rooms offered first-come-first-served"
          action={
            error ? (
              <span className="text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>{error}</span>
            ) : (
              <div className="flex gap-3">
                {TIER_COLUMNS.map((tier) => (
                  <span key={tier} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {TIER_LABELS[tier]}: <strong style={{ color: availability[tier] > 0 ? 'var(--color-status-success)' : 'var(--color-text-muted)' }}>{availability[tier]}</strong> avail
                  </span>
                ))}
              </div>
            )
          }
        />

        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No active upgrade requests</p>
          </div>
        ) : (
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '2px',
                marginBottom: '2px',
              }}
            >
              {TIER_COLUMNS.map((tier) => (
                <div
                  key={tier}
                  className="rounded-t-lg px-3 py-2 text-center text-xs font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: 'var(--color-surface-overlay)',
                    color: TIER_COLORS[tier],
                    borderBottom: `2px solid ${TIER_COLORS[tier]}`,
                  }}
                >
                  {TIER_LABELS[tier]}
                </div>
              ))}
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {entries.map((entry) => {
                const { startCol, span } = computeSpan(entry.desiredTiers);
                const isOffered = entry.status === 'OFFERED';
                const eligible = canOffer(entry);

                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '2px',
                    }}
                  >
                    {/* Empty cells before the span */}
                    {startCol > 0 && (
                      <div style={{ gridColumn: `1 / ${startCol + 1}` }} />
                    )}

                    {/* The entry cell spanning the relevant columns */}
                    <div
                      className="flex items-center justify-between rounded-lg border px-3 py-2.5"
                      style={{
                        gridColumn: `${startCol + 1} / ${startCol + span + 1}`,
                        backgroundColor: isOffered
                          ? 'rgba(245, 158, 11, 0.06)'
                          : 'var(--color-surface-input)',
                        borderColor: isOffered
                          ? 'rgba(245, 158, 11, 0.25)'
                          : 'var(--color-border-subtle)',
                        transition: 'all 150ms',
                      }}
                    >
                      {/* Left: customer info */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                              {entry.customerName}
                            </span>
                            <Badge
                              color={isOffered ? 'warning' : 'primary'}
                              variant="light"
                              size="sm"
                            >
                              {isOffered ? 'Upgrade Offered' : 'Waiting'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                              {entry.displayIdentifier}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                              •
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                              {timeAgo(entry.createdAt)} ago
                            </span>
                            {isOffered && entry.offeredRoomNumber && (
                              <>
                                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>•</span>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--color-status-warning)' }}>
                                  Room {entry.offeredRoomNumber}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: action buttons */}
                      <div className="shrink-0 ml-2">
                        {isOffered ? (
                          <button
                            onClick={() => void handleStartUpgrade(entry)}
                            disabled={submitting}
                            className="rounded-md px-3 py-1.5 text-xs font-bold transition-colors"
                            style={{
                              backgroundColor: 'var(--color-status-warning)',
                              color: '#000',
                            }}
                          >
                            Upgrade
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleOffer(entry)}
                            disabled={submitting || !eligible}
                            className="rounded-md px-3 py-1.5 text-xs font-bold transition-colors"
                            style={{
                              backgroundColor: eligible ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
                              color: eligible ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                              cursor: eligible ? 'pointer' : 'not-allowed',
                              opacity: eligible ? 1 : 0.5,
                            }}
                          >
                            Offer
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Empty cells after the span */}
                    {startCol + span < 3 && (
                      <div style={{ gridColumn: `${startCol + span + 1} / 4` }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Payment modal */}
      {paymentModal.open && paymentModal.entry && paymentModal.fulfill && (
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
      )}
    </PanelShell>
  );
}
