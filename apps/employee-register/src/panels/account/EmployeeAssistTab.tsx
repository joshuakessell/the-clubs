import { useEffect, useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';

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
  { type: 'LOCKER', label: 'Locker', emoji: '🔐' },
  { type: 'STANDARD', label: 'Standard Room', emoji: '🛏️' },
  { type: 'DOUBLE', label: 'Double Room', emoji: '🛋️' },
  { type: 'SPECIAL', label: 'Special Room', emoji: '⭐' },
] as const;

/**
 * EmployeeAssistTab — Mirrors the customer kiosk flow step by step,
 * giving the employee full control over RENTAL selection, PAYMENT,
 * AGREEMENT, and COMPLETE steps.
 */
export function EmployeeAssistTab() {
  const { sessionPayload, sendFlowCommand, currentSessionId } = useRegisterStore();
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
      {flowStep === 'RENTAL' && (
        <RentalStep sp={sp} sendFlowCommand={sendFlowCommand} token={token} />
      )}
      {flowStep === 'PAYMENT' && (
        <PaymentStep sp={sp} sendFlowCommand={sendFlowCommand} />
      )}
      {flowStep === 'AGREEMENT' && (
        <AgreementStep sp={sp} sendFlowCommand={sendFlowCommand} />
      )}
      {flowStep === 'COMPLETE' && (
        <CompleteStep sp={sp} />
      )}
      {(flowStep === 'WAITLIST_PREFERENCES' || flowStep === 'WAITLIST_BACKUP') && (
        <WaitlistStep sp={sp} sendFlowCommand={sendFlowCommand} />
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
}: {
  sp: NonNullable<ReturnType<typeof useRegisterStore>['sessionPayload']>;
  sendFlowCommand: ReturnType<typeof useRegisterStore>['sendFlowCommand'];
  token?: string | null;
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

  const handleTap = async (rentalType: string) => {
    setLoading(true);
    try {
      if (proposed === rentalType && !confirmed) {
        // Second tap → confirm
        await sendFlowCommand({ type: 'CONFIRM_SELECTION' });
      } else {
        // First tap → propose
        await sendFlowCommand({ type: 'PROPOSE_SELECTION', payload: { rentalType } });
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

      {/* Membership indicator */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{
            backgroundColor: hasMembership ? 'rgba(34,197,94,0.1)' : 'rgba(156,163,175,0.1)',
            color: hasMembership ? 'var(--color-status-success)' : 'var(--color-text-muted)',
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hasMembership ? 'var(--color-status-success)' : 'var(--color-text-muted)' }} />
          {hasMembership ? 'Member' : sp.membershipChoice === 'SIX_MONTH' ? 'Membership Pending' : 'Non-Member'}
        </span>
      </div>

      {/* Rental cards */}
      <div className="grid grid-cols-2 gap-3">
        {RENTAL_OPTIONS.map(({ type, label, emoji }) => {
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
              disabled={loading || isUnavailable || !allowed || confirmed === true}
              onClick={() => void handleTap(type)}
              className="flex flex-col items-center gap-1.5 rounded-xl border p-4 transition"
              style={{
                backgroundColor: isProposed
                  ? 'rgba(0, 212, 255, 0.12)'
                  : 'var(--color-surface-input)',
                borderColor: isProposed
                  ? 'var(--color-accent-primary)'
                  : 'var(--color-border-default)',
                borderWidth: isProposed ? 2 : 1,
                opacity: isUnavailable || !allowed ? 0.4 : 1,
                cursor: isUnavailable || !allowed || confirmed === true ? 'not-allowed' : 'pointer',
              }}
            >
              <span className="text-2xl">{emoji}</span>
              <span className="text-sm font-semibold" style={{ color: isProposed ? 'var(--color-accent-primary)' : 'var(--color-text-primary)' }}>
                {label}
              </span>
              <span className="text-xs tabular-nums" style={{ color: available <= 3 && available > 0 ? 'var(--color-status-warning)' : 'var(--color-text-muted)' }}>
                {isUnavailable ? 'Unavailable' : `${count} available`}
              </span>
              {isProposed && !confirmed && (
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-primary)' }}>
                  Tap again to confirm
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Room picker — shown when type is proposed and it's a room (not locker) */}
      {proposed && proposed !== 'LOCKER' && !confirmed && (
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

/* ────── PAYMENT step ────── */
function PaymentStep({
  sp,
  sendFlowCommand,
}: {
  sp: NonNullable<ReturnType<typeof useRegisterStore>['sessionPayload']>;
  sendFlowCommand: ReturnType<typeof useRegisterStore>['sendFlowCommand'];
}) {
  const isPaid = sp.paymentStatus === 'PAID';
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Payment
      </h3>

      {/* Line items */}
      {sp.paymentLineItems && sp.paymentLineItems.length > 0 && (
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          {sp.paymentLineItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 text-sm">
              <span style={{ color: 'var(--color-text-secondary)' }}>{item.description}</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                ${(item.amount / 100).toFixed(2)}
              </span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--color-border-default)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Total</span>
            <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
              ${((sp.paymentTotal ?? 0) / 100).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {!sp.paymentLineItems?.length && (
        <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Waiting for payment quote from server…
          </p>
        </div>
      )}

      {/* Payment status */}
      {isPaid ? (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.2)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            ✓ Paid via {sp.paymentMethod ?? 'N/A'}
          </span>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            disabled={loading}
            onClick={() => void handleMarkPaid('CASH')}
            className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition"
            style={{ borderColor: 'var(--color-status-success)', color: 'var(--color-status-success)', backgroundColor: 'rgba(34,197,94,0.05)' }}
          >
            {loading ? '…' : '💵 Cash'}
          </button>
          <button
            disabled={loading}
            onClick={() => void handleMarkPaid('CREDIT')}
            className="flex-1 rounded-lg border px-4 py-3 text-sm font-bold transition"
            style={{ borderColor: 'var(--color-accent-primary)', color: 'var(--color-accent-primary)', backgroundColor: 'rgba(0,212,255,0.05)' }}
          >
            {loading ? '…' : '💳 Credit'}
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => void sendFlowCommand({ type: 'BACK_STEP' })}
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
  sp: NonNullable<ReturnType<typeof useRegisterStore>['sessionPayload']>;
  sendFlowCommand: ReturnType<typeof useRegisterStore>['sendFlowCommand'];
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
        <span className="text-3xl">{signed ? '✅' : '📝'}</span>
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
}: {
  sp: NonNullable<ReturnType<typeof useRegisterStore>['sessionPayload']>;
}) {
  const { cancelSession } = useRegisterStore();

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

      <button
        onClick={() => void cancelSession()}
        className="rounded-lg px-6 py-3 text-sm font-bold transition"
        style={{
          backgroundColor: 'var(--color-accent-primary)',
          color: 'var(--color-text-inverse)',
          boxShadow: '0 0 20px var(--color-accent-glow)',
        }}
      >
        Reset Lane
      </button>
    </div>
  );
}

/* ────── WAITLIST step ────── */
function WaitlistStep({
  sp,
  sendFlowCommand,
}: {
  sp: NonNullable<ReturnType<typeof useRegisterStore>['sessionPayload']>;
  sendFlowCommand: ReturnType<typeof useRegisterStore>['sendFlowCommand'];
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        {sp.flowStep === 'WAITLIST_PREFERENCES' ? 'Upgrade Preferences' : 'Backup Selection'}
      </h3>

      <div className="rounded-lg border p-4 text-center" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Customer is selecting waitlist preferences on the kiosk.
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
