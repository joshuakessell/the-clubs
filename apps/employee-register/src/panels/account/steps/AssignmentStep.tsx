import { useState } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../../stores/useRegisterStore';
import { useCheckinFlow } from '../CheckinFlowContext';

/**
 * AssignmentStep — Final step before completion.
 *
 * - Shows a room/locker picker for available rooms of the selected type
 * - Employee can change the room number until "Complete Check-In" is clicked
 * - Room is NOT removed from the pool until Complete is clicked
 * - Customer kiosk shows the room/locker number + checkout time
 */
export function AssignmentStep() {
  const { state, actions } = useCheckinFlow();
  const { sp, roomsByTier } = state;
  const { sendFlowCommand } = actions;
  const token = useAuthStore((s) => s.session?.sessionToken);
  const { laneId } = useRegisterStore();

  const [selectedRoom, setSelectedRoom] = useState<string>(sp.assignedResourceNumber ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rentalType = sp.desiredRentalType ?? sp.backupRentalType ?? sp.proposedRentalType ?? 'LOCKER';
  const isLocker = rentalType === 'LOCKER';

  // Get available rooms for this type
  const availableRooms = roomsByTier[rentalType]?.available ?? [];

  const handleCompleteCheckin = async () => {
    if (!selectedRoom && !isLocker) {
      setError('Please select a room number.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Complete the check-in — this removes the room from the pool
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/complete`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId: sp.sessionId,
            assignedResourceNumber: selectedRoom || undefined,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to complete check-in');
      }

      // Server will broadcast SESSION_UPDATED with COMPLETE status
      await sendFlowCommand({ type: 'SET_STEP', payload: { step: 'COMPLETE' } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete check-in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Room Assignment
      </h3>

      {/* Assignment details */}
      <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Rental Type
        </p>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {rentalType}
        </p>
      </div>

      {/* Room picker */}
      {!isLocker ? (
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Assign Room Number
          </label>
          <select
            className="w-full rounded-lg border px-3 py-2.5 text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            value={selectedRoom}
            onChange={(e) => { setSelectedRoom(e.target.value); setError(null); }}
          >
            <option value="">Select a room…</option>
            {availableRooms.map((r) => (
              <option key={r.id} value={r.number}>
                Room {r.number}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="rounded-lg border p-3 text-center" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-success) 5%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-success) 20%, transparent)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-status-success)' }}>
            Locker will be auto-assigned
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border px-3 py-2 text-xs font-medium" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {/* Complete button */}
      <button
        disabled={loading}
        onClick={() => void handleCompleteCheckin()}
        className="mt-2 w-full rounded-lg px-4 py-3 text-sm font-bold transition-colors"
        style={{
          backgroundColor: 'var(--color-status-success)',
          color: '#fff',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Completing…' : '✓ Complete Check-In'}
      </button>
    </div>
  );
}
