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

/** Compute grid span relative to the visible (active) tier columns only */
function computeSpan(
  desiredTiersRaw: string[] | string | null | undefined,
  activeTiers: string[],
): { startCol: number; span: number } {
  const desiredTiers = normalizeDesiredTiers(desiredTiersRaw);
  // Map desired tiers to their index within the active columns
  const indices = desiredTiers
    .map((t) => activeTiers.indexOf(t))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (indices.length === 0) return { startCol: 0, span: 1 };
  const min = indices[0] ?? 0;
  const max = indices.at(-1) ?? 0;
  return { startCol: min, span: max - min + 1 };
}

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
  onOffer,
  onUpgrade,
  onCancelTap,
  onCancelConfirm,
}: Readonly<{
  entry: WaitlistEntry;
  isOffered: boolean;
  eligible: boolean;
  submitting: boolean;
  confirmingCancelId: string | null;
  onOffer: (e: WaitlistEntry) => void;
  onUpgrade: (e: WaitlistEntry) => void;
  onCancelTap: (id: string) => void;
  onCancelConfirm: (e: WaitlistEntry) => void;
}>) {
  const actionBtnBase = 'rounded-lg px-3 py-1.5 text-xs font-bold';

  return (
    <div className="shrink-0 ml-2 flex items-center gap-1.5">
      {isOffered ? (
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
      ) : (
        <button
          onClick={() => onOffer(entry)}
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
      )}

      {confirmingCancelId === entry.id ? (
        <button
          onClick={() => onCancelConfirm(entry)}
          disabled={submitting}
          className={`${actionBtnBase}`}
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
          className="rounded-lg px-2 py-1.5 text-xs font-semibold"
          aria-label={`Cancel upgrade for ${entry.customerName}`}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-status-error)',
            border: '1px solid color-mix(in oklch, var(--color-status-error) 40%, transparent)',
            opacity: submitting ? 0.4 : 0.7,
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.15s ease',
          }}
        >
          ✕
        </button>
      )}
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
  onOffer,
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
  onOffer: (e: WaitlistEntry) => void;
  onUpgrade: (e: WaitlistEntry) => void;
  onCancelTap: (id: string) => void;
  onCancelConfirm: (e: WaitlistEntry) => void;
}>) {
  const { startCol, span } = computeSpan(entry.desiredTiers, activeTiers);
  const isOffered = entry.status === 'OFFERED';
  const colCount = activeTiers.length;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, 1fr)`,
        gap: '2px',
      }}
    >
      {/* Empty cells before span */}
      {startCol > 0 ? <div style={{ gridColumn: `1 / ${startCol + 1}` }} /> : null}

      {/* Entry cell */}
      <div
        className="flex items-center justify-between rounded-xl px-3 py-2.5"
        style={{
          gridColumn: `${startCol + 1} / ${startCol + span + 1}`,
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
        {/* Left: customer info */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Queue position */}
          <span
            className="text-[11px] font-bold tabular-nums shrink-0"
            style={{
              color: isFirstEligible ? 'var(--color-status-success)' : 'var(--color-text-muted)',
              minWidth: 24,
            }}
          >
            #{String(queuePos).padStart(2, '0')}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-semibold"
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
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {entry.displayIdentifier}
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
          </div>
        </div>

        {/* Right: actions */}
        <EntryActions
          entry={entry}
          isOffered={isOffered}
          eligible={eligible}
          submitting={submitting}
          confirmingCancelId={confirmingCancelId}
          onOffer={onOffer}
          onUpgrade={onUpgrade}
          onCancelTap={onCancelTap}
          onCancelConfirm={onCancelConfirm}
        />
      </div>

      {/* Empty cells after span */}
      {startCol + span < colCount ? <div style={{ gridColumn: `${startCol + span + 1} / ${colCount + 1}` }} /> : null}
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
      all.sort((a: WaitlistEntry, b: WaitlistEntry) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
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

  /* ── Offer room ── */
  const handleOffer = useCallback(async (entry: WaitlistEntry) => {
    setSubmitting(true);
    try {
      const h = headers();
      const tiers = normalizeDesiredTiers(entry.desiredTiers);
      const availableTier = tiers.find((t) => (availability[t as keyof RoomAvailability] ?? 0) > 0);
      if (!availableTier) throw new Error('No rooms available for desired tier');

      const roomsRes = await fetch(
        getApiUrl(`/api/v1/rooms/offerable?tier=${encodeURIComponent(availableTier)}`),
        { headers: h }
      );
      if (!roomsRes.ok) throw new Error('No rooms available');
      const { rooms } = await roomsRes.json();
      if (!rooms?.length) throw new Error('No rooms available');

      const offerRes = await fetch(getApiUrl(`/api/v1/waitlist/${entry.id}/offer`), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: rooms[0].id }),
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
  }, [headers, fetchData, availability]);

  /* ── Start upgrade payment ── */
  const handleStartUpgrade = useCallback(async (entry: WaitlistEntry) => {
    setSubmitting(true);
    try {
      const h = headers();
      if (!entry.roomId) throw new Error('No room offered');

      const res = await fetch(getApiUrl('/api/v1/upgrades/fulfill'), {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlistId: entry.id, roomId: entry.roomId, acknowledgedDisclaimer: true }),
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
        getApiUrl(`/api/v1/payments/${paymentModal.fulfill.paymentIntentId}/mark-paid`),
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
          paymentIntentId: paymentModal.fulfill.paymentIntentId,
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
    return normalizeDesiredTiers(entry.desiredTiers).some(
      (t) => (availability[t as keyof RoomAvailability] ?? 0) > 0
    );
  }, [availability]);

  /** Only show tier columns that have entries or available rooms */
  const activeTiers = useMemo(() => {
    const tiersWithEntries = new Set<string>();
    for (const entry of entries) {
      for (const t of normalizeDesiredTiers(entry.desiredTiers)) {
        tiersWithEntries.add(t);
      }
    }
    return TIER_COLUMNS.filter(
      (t) => tiersWithEntries.has(t) || availability[t] > 0
    ) as string[];
  }, [entries, availability]);

  const firstEligibleIds = useMemo(() => {
    const ids = new Set<string>();
    const claimedTiers = new Set<string>();
    for (const entry of entries) {
      if (entry.status !== 'ACTIVE') continue;
      const tiers = normalizeDesiredTiers(entry.desiredTiers);
      for (const t of tiers) {
        if (!claimedTiers.has(t) && (availability[t as keyof RoomAvailability] ?? 0) > 0) {
          ids.add(entry.id);
          claimedTiers.add(t);
        }
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
                  onOffer={(e) => void handleOffer(e)}
                  onUpgrade={(e) => void handleStartUpgrade(e)}
                  onCancelTap={handleCancelTap}
                  onCancelConfirm={(e) => void handleCancelConfirm(e)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

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
