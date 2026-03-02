import { useState } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useRegisterStore } from '../../../stores/useRegisterStore';
import { useCheckinFlow } from '../CheckinFlowContext';

export function CompleteStep() {
  const { state, actions, meta } = useCheckinFlow();
  const { sp } = state;
  const { sendFlowCommand } = actions;
  const { token, laneId } = meta;

  const { completeTransaction } = useRegisterStore();

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

  const needsMembershipEntry =
    (sp.membershipChoice === 'SIX_MONTH' || !!sp.membershipPurchaseIntent) &&
    !membershipSaved &&
    !sp.membershipNumber;

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
      await completeTransaction();
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

      {/* Membership card number entry */}
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
