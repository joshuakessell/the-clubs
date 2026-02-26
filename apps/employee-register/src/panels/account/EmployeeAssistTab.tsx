import { useEffect, useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';

type FlowCommandFn = (cmd: { type: string; payload?: Record<string, unknown> }) => Promise<void>;

interface RoomOption {
  id: string;
  number: string;
}

interface AvailableInventory {
  rooms: Record<string, number>;
  lockers: number;
}

interface RoomsByTier {
  available: RoomOption[];
}

const RENTAL_OPTIONS = [
  { type: 'LOCKER', label: 'Locker' },
  { type: 'STANDARD', label: 'Standard Room' },
  { type: 'DOUBLE', label: 'Double Room' },
  { type: 'SPECIAL', label: 'Special Room' },
] as const;

/**
 * EmployeeAssistTab — Mirrors the customer kiosk flow step by step,
 * giving the employee full control over RENTAL selection, PAYMENT,
 * AGREEMENT, and COMPLETE steps.
 */
export function EmployeeAssistTab() {
  const { sessionPayload, sendFlowCommand, currentSessionId, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);

  const sp = sessionPayload;
  const flowStep = sp?.flowStep;

  // No active session — show prompt
  if (!currentSessionId || !sp) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <span className="text-4xl" aria-hidden="true">📋</span>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No active check-in session. Select a customer and start check-in from the Profile tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Flow step indicator */}
      <FlowIndicator step={flowStep} />

      {/* Step-specific UI */}
      {(flowStep === 'LANGUAGE' || flowStep === 'RENTAL') && (
        <RentalStep sp={sp} sendFlowCommand={sendFlowCommand} token={token} laneId={laneId} />
      )}
      {flowStep === 'WAITLIST_PREFERENCES' && (
        <WaitlistPreferencesStep sp={sp} sendFlowCommand={sendFlowCommand} token={token} laneId={laneId} />
      )}
      {flowStep === 'WAITLIST_BACKUP' && (
        <WaitlistStep sp={sp} sendFlowCommand={sendFlowCommand} />
      )}
      {flowStep === 'PAYMENT' && (
        <PaymentStep sp={sp} sendFlowCommand={sendFlowCommand} token={token} laneId={laneId} currentSessionId={currentSessionId} />
      )}
      {flowStep === 'AGREEMENT' && (
        <AgreementStep sp={sp} sendFlowCommand={sendFlowCommand} />
      )}
      {flowStep === 'COMPLETE' && (
        <CompleteStep sp={sp} sendFlowCommand={sendFlowCommand} />
      )}

    </div>
  );
}

/* ────── Flow step indicator ────── */
const STEPS = ['RENTAL', 'PAYMENT', 'AGREEMENT', 'COMPLETE'] as const;

function FlowIndicator({ step }: { step?: string }) {
  const idx = STEPS.indexOf(step as any);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-1">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              backgroundColor: i <= idx ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: i <= idx ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              border: i <= idx ? 'none' : '1px solid var(--color-border-default)',
            }}
          >
            {i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className="h-0.5 flex-1"
              style={{ backgroundColor: i < idx ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ────── RENTAL step ────── */
function RentalStep({
  sp,
  sendFlowCommand,
  token,
  laneId,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
  token?: string | null;
  laneId: string;
}) {
  const [inventory, setInventory] = useState<AvailableInventory | null>(null);
  const [roomsByTier, setRoomsByTier] = useState<Record<string, RoomsByTier>>({});
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchInventory = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/inventory/available'), { headers });
      if (res.ok) {
        const data = await res.json();
        setInventory(data);
      }
    } catch { /* ignore */ }
  }, [token]);

  const fetchRoomsByTier = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/inventory/rooms-by-tier'), { headers });
      if (res.ok) {
        const data = await res.json();
        setRoomsByTier(data.rooms ?? {});
      }
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    void fetchInventory();
    void fetchRoomsByTier();
  }, [fetchInventory, fetchRoomsByTier]);

  const proposed = sp.proposedRentalType;
  const confirmed = sp.selectionConfirmed;
  const hasMembership =
    sp.customerMembershipValidUntil &&
    new Date(sp.customerMembershipValidUntil) >= new Date();

  const handleTap = async (rentalType: string, isUnavailable: boolean) => {
    setLoading(true);
    try {
      if (isUnavailable) {
        // Unavailable room — single tap proposes + confirms to join waitlist
        if (proposed === rentalType) {
          await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
        } else {
          await sendFlowCommand({ type: 'PROPOSE_SELECTION', payload: { rentalType } });
          // Small delay so the server processes the proposal before confirming
          await new Promise((r) => setTimeout(r, 150));
          await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
        }
      } else {
        // Available room — single tap proposes + confirms immediately
        if (proposed === rentalType) {
          // Already proposed, just confirm
          await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
        } else {
          // Propose and immediately confirm in one action
          await sendFlowCommand({ type: 'PROPOSE_SELECTION', payload: { rentalType } });
          await new Promise((r) => setTimeout(r, 150));
          await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Select Rental Type
      </h3>

      {/* Membership indicator — only show for members and pending */}
      {(hasMembership || sp.membershipChoice === 'SIX_MONTH') && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
            style={{
              backgroundColor: hasMembership ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
              color: hasMembership ? 'var(--color-status-success)' : 'var(--color-status-warning)',
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hasMembership ? 'var(--color-status-success)' : 'var(--color-status-warning)' }} />
            {hasMembership ? 'Member' : 'Membership Pending'}
          </span>
        </div>
      )}

      {/* Rental cards — vertically stacked */}
      <div className="flex flex-col gap-3">
        {RENTAL_OPTIONS.map(({ type, label }) => {
          const isProposed = proposed === type;
          const count =
            type === 'LOCKER'
              ? inventory?.lockers ?? '—'
              : inventory?.rooms?.[type] ?? '—';
          const available = typeof count === 'number' ? count : 0;
          const isUnavailable = typeof count === 'number' && count === 0;
          const allowed = sp.allowedRentals?.includes(type) ?? true;

          return (
            <button
              key={type}
              disabled={loading || !allowed || confirmed === true}
              onClick={() => void handleTap(type, isUnavailable)}
              className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: isProposed
                  ? 'rgba(99, 102, 241, 0.1)'
                  : 'rgba(99, 102, 241, 0.06)',
                borderColor: isProposed
                  ? 'var(--color-accent-primary)'
                  : 'rgba(99, 102, 241, 0.2)',
                borderWidth: isProposed ? 2 : 1,
                opacity: !allowed ? 0.4 : 1,
                cursor: !allowed || confirmed === true ? 'not-allowed' : 'pointer',
              }}
            >
              <span style={{ color: isProposed ? 'var(--color-accent-primary)' : 'var(--color-text-primary)' }}>
                {label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums" style={{
                  color: isUnavailable
                    ? 'var(--color-accent-secondary, #a78bfa)'
                    : available <= 3 && available > 0
                      ? 'var(--color-status-warning)'
                      : 'var(--color-text-muted)',
                }}>
                  {isUnavailable ? 'Join Waitlist' : `${count} available`}
                </span>
                {isProposed && !confirmed && (
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-primary)' }}>
                    {isUnavailable ? 'Tap to join' : 'Tap to confirm'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Room picker — shown when type is proposed and it's a room (not locker) */}
      {proposed && proposed !== 'LOCKER' && !confirmed && !isTypeUnavailable(proposed, inventory) && (
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Assign Specific Room (Optional)
          </label>
          <select
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            value={selectedRoom ?? ''}
            onChange={(e) => setSelectedRoom(e.target.value || null)}
          >
            <option value="">Auto-assign (random)</option>
            {(roomsByTier[proposed]?.available ?? []).map((r) => (
              <option key={r.id} value={r.number}>
                Room {r.number}
              </option>
            ))}
          </select>
        </div>
      )}

      {confirmed && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.2)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            ✓ {proposed} selected — waiting for next step
          </span>
        </div>
      )}
    </div>
  );
}

/** Helper to check if a rental type is unavailable */
function isTypeUnavailable(type: string, inventory: AvailableInventory | null): boolean {
  if (!inventory) return false;
  if (type === 'LOCKER') return inventory.lockers === 0;
  return (inventory.rooms?.[type] ?? 0) === 0;
}

/* ────── WAITLIST PREFERENCES step ────── */
/** Upgrade fee schedule (matches server-side pricing/engine.ts) */
const UPGRADE_FEES: Record<string, Record<string, number>> = {
  LOCKER: { STANDARD: 8, DOUBLE: 17, SPECIAL: 27 },
  STANDARD: { DOUBLE: 9, SPECIAL: 19 },
  DOUBLE: { SPECIAL: 9 },
};

interface UpgradeNotice {
  initialRental: string;
  upgradeRental: string;
  position: number;
  estimatedWaitMinutes: number | null;
  upgradeFee: number | null;
}

function WaitlistPreferencesStep({
  sp,
  sendFlowCommand,
  token,
  laneId,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
  token?: string | null;
  laneId: string;
}) {
  const [inventory, setInventory] = useState<AvailableInventory | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(sp.waitlistDesiredTypes ?? []);
  const [loading, setLoading] = useState(false);
  const [estimatedWaits, setEstimatedWaits] = useState<Record<string, number>>({});
  const [upgradeNotice, setUpgradeNotice] = useState<UpgradeNotice | null>(null);

  // Sync selectedTypes from session payload (e.g. when customer toggles on kiosk)
  useEffect(() => {
    if (sp.waitlistDesiredTypes) {
      setSelectedTypes(sp.waitlistDesiredTypes);
    }
  }, [sp.waitlistDesiredTypes]);

  // Fetch current inventory to know which types are unavailable
  useEffect(() => {
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(getApiUrl('/api/v1/inventory/available'), { headers });
        if (res.ok) setInventory(await res.json());
      } catch { /* ignore */ }
    })();
  }, [token]);

  // Fetch estimated wait times
  useEffect(() => {
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(getApiUrl('/api/v1/inventory/detailed'), { headers });
        if (res.ok) {
          const data = await res.json();
          const waits: Record<string, number> = {};
          // Calculate estimated wait from earliest checkout times
          for (const roomType of ['STANDARD', 'DOUBLE', 'SPECIAL']) {
            const rooms = (data.rooms ?? []).filter(
              (r: any) => r.type === roomType && r.status === 'OCCUPIED' && r.checkoutAt
            );
            if (rooms.length > 0) {
              const soonest = rooms
                .map((r: any) => new Date(r.checkoutAt).getTime())
                .sort((a: number, b: number) => a - b)[0];
              const minutesUntil = Math.max(0, Math.round((soonest - Date.now()) / 60000));
              waits[roomType] = minutesUntil;
            }
          }
          setEstimatedWaits(waits);
        }
      } catch { /* ignore */ }
    })();
  }, [token]);

  const ROOM_TYPES = [
    { type: 'STANDARD', label: 'Standard Room' },
    { type: 'DOUBLE', label: 'Double Room' },
    { type: 'SPECIAL', label: 'Special Room' },
  ] as const;

  const unavailableTypes = ROOM_TYPES.filter(
    ({ type }) => inventory && (inventory.rooms?.[type] ?? 0) === 0
  );

  const toggleType = (type: string) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    setSelectedTypes(next);
    // Sync to server for bidirectional sync with customer kiosk
    void sendFlowCommand({
      type: 'WAITLIST_UPDATE',
      payload: {
        waitlistDesiredTypes: next,
        waitlistDesiredType: next[0] ?? null,
      },
    });
  };

  const handleContinue = async () => {
    if (selectedTypes.length === 0) return;
    setLoading(true);
    try {
      // Send waitlist preferences
      await sendFlowCommand({
        type: 'WAITLIST_UPDATE',
        payload: {
          waitlistDesiredTypes: selectedTypes,
          waitlistDesiredType: selectedTypes[0],
        },
      });

      // Determine the initial rental (backup) — typically LOCKER for waitlist
      const initialRental = sp.backupRentalType ?? sp.proposedRentalType ?? 'LOCKER';
      const upgradeRental = selectedTypes[0] ?? 'STANDARD';
      const upgradeLabel = RENTAL_OPTIONS.find((o) => o.type === upgradeRental)?.label ?? upgradeRental;
      const initialLabel = RENTAL_OPTIONS.find((o) => o.type === initialRental)?.label ?? initialRental;

      // Fetch waitlist info from API
      let position = 1;
      let estimatedWaitMinutes: number | null = estimatedWaits[upgradeRental] ?? null;
      let upgradeFee: number | null = UPGRADE_FEES[initialRental]?.[upgradeRental] ?? null;

      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const qs = new URLSearchParams({ desiredTier: upgradeRental, currentTier: initialRental });
        const res = await fetch(
          getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/waitlist-info?${qs}`),
          { headers }
        );
        if (res.ok) {
          const info = await res.json();
          position = info.position ?? 1;
          if (info.estimatedReadyAt) {
            estimatedWaitMinutes = Math.max(0, Math.round(
              (new Date(info.estimatedReadyAt).getTime() - Date.now()) / 60000
            ));
          }
          if (info.upgradeFee != null) upgradeFee = info.upgradeFee;
        }
      } catch { /* use local estimates */ }

      // Show upgrade notice modal
      setUpgradeNotice({
        initialRental: initialLabel,
        upgradeRental: upgradeLabel,
        position,
        estimatedWaitMinutes,
        upgradeFee,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeUnderstood = async () => {
    setUpgradeNotice(null);
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'WAITLIST_BACKUP' },
      });
    } finally {
      setLoading(false);
    }
  };

  const formatWait = (minutes: number): string => {
    if (minutes < 60) return `~${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `~${hrs}h ${mins}m` : `~${hrs}h`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Upgrade Waitlist Preferences
      </h3>

      {/* Disclaimer */}
      <div className="rounded-lg border p-4" style={{ backgroundColor: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-status-warning)' }}>
          To join the waitlist, you must rent a locker.
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Note: When an upgrade becomes available, you may accept it (upgrade fees apply, and are due at that time).
        </p>
      </div>

      {/* Room type checkboxes */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Select room types to wait for:
        </label>
        {ROOM_TYPES.map(({ type, label }) => {
          const isSelected = selectedTypes.includes(type);
          const wait = estimatedWaits[type];
          const isAvailable = inventory ? (inventory.rooms?.[type] ?? 0) > 0 : false;

          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition"
              style={{
                backgroundColor: isSelected ? 'rgba(0, 212, 255, 0.08)' : 'var(--color-surface-input)',
                borderColor: isSelected ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                borderWidth: isSelected ? 2 : 1,
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-5 w-5 items-center justify-center rounded border"
                  style={{
                    backgroundColor: isSelected ? 'var(--color-accent-primary)' : 'transparent',
                    borderColor: isSelected ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                  }}
                >
                  {isSelected && <span className="text-xs text-white">✓</span>}
                </div>
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {label}
                  </span>
                  {isAvailable && (
                    <span className="ml-2 text-xs" style={{ color: 'var(--color-status-success)' }}>
                      Available now
                    </span>
                  )}
                </div>
              </div>
              {wait !== undefined && !isAvailable && (
                <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  Est. wait: {formatWait(wait)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Estimated wait summary */}
      {selectedTypes.length > 0 && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for: {selectedTypes.map((t) => {
              const label = ROOM_TYPES.find((rt) => rt.type === t)?.label ?? t;
              const wait = estimatedWaits[t];
              return wait !== undefined ? `${label} (${formatWait(wait)})` : label;
            }).join(', ')}
          </span>
        </div>
      )}

      {/* Continue button */}
      <button
        disabled={loading || selectedTypes.length === 0}
        onClick={() => void handleContinue()}
        className="w-full rounded-lg px-4 py-3 text-sm font-bold transition"
        style={{
          backgroundColor: selectedTypes.length > 0 ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
          color: selectedTypes.length > 0 ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
          opacity: selectedTypes.length === 0 ? 0.5 : 1,
          boxShadow: selectedTypes.length > 0 ? '0 0 20px var(--color-accent-glow)' : 'none',
        }}
      >
        {loading ? 'Processing…' : 'Continue'}
      </button>

      {/* Back button */}
      <button
        onClick={() => void sendFlowCommand({ type: 'BACK_STEP' })}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Rental
      </button>

      {/* ── Upgrade Notice Modal ──────── */}
      {upgradeNotice && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 24,
          }}
        >
          <div
            className="flex flex-col rounded-xl"
            style={{
              backgroundColor: 'var(--color-surface-primary)',
              border: '1px solid var(--color-border-subtle)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              maxWidth: 420,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div
              className="px-5 py-3"
              style={{
                backgroundColor: 'var(--color-surface-overlay)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <h3
                className="text-sm font-bold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
              >
                Upgrade Notice
              </h3>
            </div>

            {/* Modal body */}
            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                You will be put on a waitlist to upgrade from your{' '}
                <strong style={{ color: 'var(--color-text-primary)' }}>{upgradeNotice.initialRental}</strong>
                {' '}to a{' '}
                <strong style={{ color: 'var(--color-text-primary)' }}>{upgradeNotice.upgradeRental}</strong>.
              </p>

              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                You are{' '}
                <strong style={{ color: 'var(--color-accent-primary)' }}>
                  #{upgradeNotice.position}
                </strong>{' '}
                in line
                {upgradeNotice.estimatedWaitMinutes != null && (
                  <>, with the room estimated to be ready in{' '}
                    <strong style={{ color: 'var(--color-text-primary)' }}>
                      {formatWait(upgradeNotice.estimatedWaitMinutes)}
                    </strong>
                  </>
                )}
                .
              </p>

              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                You will be charged for the{' '}
                <strong style={{ color: 'var(--color-text-primary)' }}>{upgradeNotice.initialRental}</strong>
                {' '}now. If an upgrade becomes available, you may accept it for{' '}
                <strong style={{ color: 'var(--color-accent-primary)' }}>
                  {upgradeNotice.upgradeFee != null ? `$${upgradeNotice.upgradeFee.toFixed(2)}` : 'the upgrade fee'}
                </strong>
                . This does not extend your initial checkout time.
              </p>
            </div>

            {/* Modal footer */}
            <div
              className="px-5 py-4"
              style={{ borderTop: '1px solid var(--color-border-subtle)' }}
            >
              <button
                onClick={() => void handleUpgradeUnderstood()}
                disabled={loading}
                className="w-full rounded-lg px-4 py-3 text-sm font-bold transition"
                style={{
                  backgroundColor: 'var(--color-accent-primary)',
                  color: 'var(--color-text-inverse)',
                  boxShadow: '0 0 20px var(--color-accent-glow)',
                }}
              >
                {loading ? 'Processing…' : 'Understood'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────── PAYMENT step ────── */
function PaymentStep({
  sp,
  sendFlowCommand,
  token,
  laneId,
  currentSessionId,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
  token?: string | null;
  laneId: string;
  currentSessionId: string | null;
}) {
  const isPaid = sp.paymentStatus === 'PAID';
  const [loading, setLoading] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const totalDollars = sp.paymentTotal ?? 0;
  const [splitCashDollars, setSplitCashDollars] = useState(0);
  const splitCreditDollars = totalDollars - splitCashDollars;

  // Membership upgrade/downgrade
  const membershipChoice = sp.membershipChoice;
  const isMember = (() => {
    const validUntil = sp.customerMembershipValidUntil;
    if (!validUntil) return false;
    return new Date(validUntil + 'T23:59:59') >= new Date();
  })();
  const isMembershipItem = (item: { description: string }) =>
    item.description === 'Membership Fee' || item.description === '6-Month Membership';

  const setMembershipChoice = useCallback(async (choice: 'ONE_TIME' | 'SIX_MONTH' | 'NONE') => {
    if (!laneId || !token) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/membership-choice`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ choice, sessionId: currentSessionId ?? undefined }),
        }
      );
    } catch { /* best-effort */ }
  }, [laneId, token, currentSessionId]);

  const handleMarkPaid = async (method: 'CASH' | 'CREDIT') => {
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'AGREEMENT', paymentMethod: method },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSplitPaid = async () => {
    if (splitCreditDollars < 0) return;
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: {
          step: 'AGREEMENT',
          paymentMethod: 'SPLIT',
          splitCashAmount: splitCashDollars,
          splitCreditAmount: splitCreditDollars,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreditFailure = async () => {
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'PAYMENT', paymentMethod: 'CREDIT', paymentFailed: true, failureReason: 'Card declined — demo failure' },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Collect Payment
      </h3>

      {/* Line items */}
      {sp.paymentLineItems && sp.paymentLineItems.length > 0 && (
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          {sp.paymentLineItems.map((item: { description: string; amount: number }, i: number) => (
            <div key={i} className="flex items-center justify-between py-1.5 text-sm">
              <span style={{ color: 'var(--color-text-secondary)' }}>{item.description}</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  ${item.amount.toFixed(2)}
                </span>
                {/* Remove button for 6-month membership */}
                {!isMember && isMembershipItem(item) && item.description === '6-Month Membership' && (
                  <button
                    onClick={() => void setMembershipChoice('ONE_TIME')}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold transition-colors"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--color-status-error)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                    }}
                    title="Remove 6-month membership, revert to daily fee"
                  >
                    −
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Total</span>
            <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
              ${totalDollars.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* 6-Month Membership Upgrade — only for non-members with daily fee */}
      {!isMember && membershipChoice !== 'SIX_MONTH' && sp.paymentLineItems?.some(isMembershipItem) && (
        <button
          onClick={() => void setMembershipChoice('SIX_MONTH')}
          className="flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.06)',
            borderColor: 'rgba(99, 102, 241, 0.2)',
            color: 'var(--color-accent-primary)',
          }}
        >
          <span>⬆</span>
          Upgrade to 6-Month Membership ($43.00)
        </button>
      )}

      {!sp.paymentLineItems?.length && (
        <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for payment quote from server…
          </p>
        </div>
      )}

      {/* Payment failure notice */}
      {sp.paymentFailureReason && !isPaid && (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-error)' }}>
            ✗ {sp.paymentFailureReason}
          </span>
        </div>
      )}

      {/* Payment status / actions */}
      {isPaid ? (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.2)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            ✓ Paid via {sp.paymentMethod ?? 'N/A'}
          </span>
        </div>
      ) : showSplit ? (
        /* ── Split payment UI ── */
        <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Split Payment</span>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-status-success)' }}>Cash ($)</label>
              <input
                type="number"
                min={0}
                max={totalDollars}
                step={0.01}
                value={splitCashDollars.toFixed(2)}
                onChange={(e) => setSplitCashDollars(parseFloat(e.target.value || '0'))}
                className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: '#1f2937' }}
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-accent-primary)' }}>Credit ($)</label>
              <div
                className="mt-1 flex h-10 items-center rounded-lg border px-3 text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              >
                ${splitCreditDollars.toFixed(2)}
              </div>
            </div>
          </div>
          {splitCreditDollars < 0 && (
            <p className="text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>
              Cash amount exceeds total
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={loading || splitCreditDollars < 0}
              onClick={() => void handleSplitPaid()}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition"
              style={{ borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)', backgroundColor: 'rgba(34,197,94,0.05)', opacity: loading || splitCreditDollars < 0 ? 0.5 : 1 }}
            >
              {loading ? '…' : '✓ Confirm Split'}
            </button>
            <button
              onClick={() => setShowSplit(false)}
              className="rounded-lg border px-4 py-3 text-sm font-medium transition"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── Payment buttons ── */
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <button
              disabled={loading}
              onClick={() => void handleMarkPaid('CASH')}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition"
              style={{ borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)', backgroundColor: 'rgba(34,197,94,0.05)' }}
            >
              {loading ? '…' : 'Cash'}
            </button>
            <button
              disabled={loading}
              onClick={() => void handleMarkPaid('CREDIT')}
              className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition"
              style={{ borderColor: 'var(--color-accent-primary)', color: 'var(--color-accent-primary)', backgroundColor: 'rgba(0,212,255,0.05)' }}
            >
              {loading ? '…' : 'Credit'}
            </button>
          </div>
          <button
            disabled={loading}
            onClick={() => setShowSplit(true)}
            className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface-overlay)' }}
          >
            ✂️ Split Payment (Cash + Credit)
          </button>
          <button
            disabled={loading}
            onClick={() => void handleCreditFailure()}
            className="w-full rounded-lg border px-4 py-2 text-xs font-medium transition"
            style={{ borderColor: 'rgba(239,68,68,0.2)', color: 'var(--color-status-error)', backgroundColor: 'rgba(239,68,68,0.05)' }}
          >
            {loading ? '…' : '⚠️ Simulate Credit Failure (Demo)'}
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => void sendFlowCommand({ type: 'SET_STEP', payload: { step: 'RENTAL' } })}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Rental
      </button>
    </div>
  );
}

/* ────── AGREEMENT step ────── */
function AgreementStep({
  sp,
  sendFlowCommand,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
}) {
  const signed = sp.agreementSigned;
  const [loading, setLoading] = useState(false);

  const handleBypass = async () => {
    setLoading(true);
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'COMPLETE', agreementBypass: true },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Liability Agreement
      </h3>

      <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center"
        style={{
          backgroundColor: signed ? 'rgba(34,197,94,0.05)' : 'var(--color-surface-overlay)',
          borderColor: signed ? 'rgba(34,197,94,0.2)' : 'var(--color-border-subtle)',
        }}
      >
        <span className="text-sm font-bold" style={{ color: signed ? 'var(--color-status-success)' : 'var(--color-text-muted)' }}>{signed ? 'Signed' : 'Unsigned'}</span>
        <p className="text-sm font-semibold" style={{ color: signed ? 'var(--color-status-success)' : 'var(--color-text-secondary)' }}>
          {signed
            ? `Agreement signed (${sp.agreementSignedMethod === 'MANUAL' ? 'Manual' : 'Digital'})`
            : 'Waiting for customer to sign on kiosk…'}
        </p>
      </div>

      {!signed && (
        <button
          disabled={loading}
          onClick={() => void handleBypass()}
          className="rounded-lg border px-4 py-2 text-xs font-semibold transition"
          style={{
            borderColor: 'var(--color-status-warning)',
            color: 'var(--color-status-warning)',
            backgroundColor: 'rgba(245,158,11,0.05)',
          }}
        >
          {loading ? 'Processing…' : 'Bypass Agreement (Override)'}
        </button>
      )}

      <button
        onClick={() => void sendFlowCommand({ type: 'BACK_STEP' })}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back to Payment
      </button>
    </div>
  );
}

/* ────── COMPLETE step ────── */
function CompleteStep({
  sp,
  sendFlowCommand,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
}) {
  const { cancelSession, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [membershipCardNumber, setMembershipCardNumber] = useState('');
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipSaved, setMembershipSaved] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [completing, setCompleting] = useState(false);

  // Room override state
  const [showRoomOverride, setShowRoomOverride] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<{ id: string; number: string; type: string }[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  // Show membership entry if 6-month was purchased and not yet completed
  const needsMembershipEntry =
    (sp.membershipChoice === 'SIX_MONTH' || !!sp.membershipPurchaseIntent) &&
    !membershipSaved &&
    !sp.membershipNumber; // Already has a membership number = already completed

  // Determine the tier for the room override dropdown
  const currentTier = sp.proposedRentalType ?? 'STANDARD';
  const isRoomType = currentTier !== 'LOCKER' && currentTier !== 'GYM_LOCKER';

  const loadAvailableRooms = async () => {
    if (!isRoomType) return;
    setLoadingRooms(true);
    setOverrideError('');
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl(`/v1/rooms/offerable?tier=${encodeURIComponent(currentTier)}`),
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setAvailableRooms(data.rooms ?? []);
      } else {
        setOverrideError('Failed to load available rooms');
      }
    } catch {
      setOverrideError('Network error loading rooms');
    } finally {
      setLoadingRooms(false);
    }
  };

  const handleRoomOverride = async () => {
    if (!selectedRoom) return;
    setOverrideLoading(true);
    setOverrideError('');
    try {
      await sendFlowCommand({
        type: 'SET_STEP',
        payload: { step: 'COMPLETE', overrideRoomId: selectedRoom },
      });
      setShowRoomOverride(false);
      setSelectedRoom('');
    } catch {
      setOverrideError('Failed to override room assignment');
    } finally {
      setOverrideLoading(false);
    }
  };

  const handleSaveMembership = async () => {
    if (!membershipCardNumber.trim()) return;
    setMembershipSaving(true);
    setMembershipError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/complete-membership-purchase`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId: sp.sessionId,
            membershipNumber: membershipCardNumber.trim(),
          }),
        }
      );

      if (res.ok) {
        setMembershipSaved(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setMembershipError(data.error ?? `Failed to save membership (${res.status})`);
      }
    } catch {
      setMembershipError('Network error saving membership');
    } finally {
      setMembershipSaving(false);
    }
  };

  const handleCompleteTransaction = async () => {
    setCompleting(true);
    try {
      await cancelSession();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <span className="text-4xl">🎉</span>
      <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Check-In Complete
      </h3>

      <div className="rounded-xl border p-5 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Assigned
        </span>
        <p className="mt-1 text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}>
          {sp.assignedResourceType === 'locker' ? 'Locker' : 'Room'} {sp.assignedResourceNumber ?? '—'}
        </p>
        {sp.checkoutAt && (
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Checkout at {new Date(sp.checkoutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Room override section */}
      {isRoomType && !showRoomOverride && (
        <button
          onClick={() => { setShowRoomOverride(true); void loadAvailableRooms(); }}
          className="text-xs font-semibold"
          style={{ color: 'var(--color-accent-primary)' }}
        >
          Override Room Assignment
        </button>
      )}

      {showRoomOverride && (
        <div className="w-full rounded-xl border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Select Room ({currentTier.replace(/_/g, ' ')})
          </span>

          {loadingRooms ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading available rooms…</p>
          ) : availableRooms.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-status-error)' }}>No available rooms in this tier</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: 'var(--color-surface-input)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <option value="">Choose a room…</option>
                {availableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.number}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  disabled={!selectedRoom || overrideLoading}
                  onClick={() => void handleRoomOverride()}
                  className="flex-1 rounded-lg border px-4 py-2 text-sm font-bold transition"
                  style={{
                    borderColor: 'var(--color-accent-primary)',
                    color: 'var(--color-accent-primary)',
                    backgroundColor: 'rgba(0,212,255,0.05)',
                    opacity: !selectedRoom || overrideLoading ? 0.5 : 1,
                  }}
                >
                  {overrideLoading ? '…' : '✓ Assign This Room'}
                </button>
                <button
                  onClick={() => { setShowRoomOverride(false); setSelectedRoom(''); }}
                  className="rounded-lg border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {overrideError && (
            <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--color-status-error)' }}>
              {overrideError}
            </p>
          )}
        </div>
      )}

      {/* Membership card number entry — shown when 6-month membership was purchased */}
      {needsMembershipEntry && (
        <div className="w-full rounded-xl border-2 border-dashed p-4" style={{
          borderColor: 'var(--color-accent-secondary, #a78bfa)',
          backgroundColor: 'rgba(167, 139, 250, 0.05)',
        }}>
          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-secondary, #a78bfa)' }}>
            Enter Membership Card Number
          </label>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Scan or type the physical membership card number to complete the 6-month membership.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              autoFocus
              value={membershipCardNumber}
              onChange={(e) => setMembershipCardNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveMembership();
              }}
              placeholder="Membership card #"
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--color-surface-input)',
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
              }}
            />
            <button
              disabled={membershipSaving || !membershipCardNumber.trim()}
              onClick={() => void handleSaveMembership()}
              className="rounded-lg px-4 py-2 text-sm font-bold transition"
              style={{
                backgroundColor: membershipCardNumber.trim()
                  ? 'var(--color-accent-secondary, #a78bfa)'
                  : 'var(--color-surface-overlay)',
                color: membershipCardNumber.trim()
                  ? '#fff'
                  : 'var(--color-text-muted)',
                opacity: membershipSaving ? 0.6 : 1,
              }}
            >
              {membershipSaving ? '…' : 'Save'}
            </button>
          </div>
          {membershipError && (
            <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--color-status-error, #ef4444)' }}>
              {membershipError}
            </p>
          )}
        </div>
      )}

      {/* Membership saved confirmation */}
      {membershipSaved && (
        <div className="w-full rounded-lg border p-3 text-center" style={{ backgroundColor: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.2)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            ✓ 6-Month Membership activated — Card #{membershipCardNumber}
          </span>
        </div>
      )}

      {/* Complete Transaction button */}
      <button
        disabled={completing}
        onClick={() => void handleCompleteTransaction()}
        className="w-full rounded-lg px-6 py-3 text-sm font-bold transition"
        style={{
          backgroundColor: 'var(--color-accent-primary)',
          color: 'var(--color-text-inverse)',
          boxShadow: '0 0 20px var(--color-accent-glow)',
          opacity: completing ? 0.6 : 1,
        }}
      >
        {completing ? 'Completing…' : '✓ Complete Transaction'}
      </button>
    </div>
  );
}

/* ────── WAITLIST BACKUP step ────── */
function WaitlistStep({
  sp,
  sendFlowCommand,
}: {
  sp: SessionUpdatedPayload;
  sendFlowCommand: FlowCommandFn;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Backup Selection
      </h3>

      <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Customer is selecting a backup rental on the kiosk while waiting for an upgrade.
        </p>
        {sp.waitlistDesiredType && (
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Desired: <strong>{sp.waitlistDesiredType}</strong>
            {sp.backupRentalType && <> | Backup: <strong>{sp.backupRentalType}</strong></>}
          </p>
        )}
      </div>

      <button
        onClick={() => void sendFlowCommand({ type: 'BACK_STEP' })}
        className="self-start text-xs font-semibold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        ← Back
      </button>
    </div>
  );
}
