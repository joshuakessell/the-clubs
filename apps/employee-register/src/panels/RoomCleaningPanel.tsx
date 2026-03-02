import { useEffect, useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { Badge, Button } from '@the-clubs/ui';
import { useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

interface Room {
  id: string;
  number: string;
  status: string;
}

/**
 * RoomCleaningPanel — Mark dirty rooms as clean with a single tap.
 * Fetches DIRTY rooms from GET /v1/inventory/rooms
 * and transitions them directly to CLEAN via POST /v1/cleaning/batch.
 */
export function RoomCleaningPanel() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const token = useAuthStore((s) => s.session?.sessionToken);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/inventory/rooms'), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Only show rooms that need cleaning (DIRTY)
      setRooms((data.rooms ?? []).filter((r: Room) => r.status === 'DIRTY'));
    } catch (err: any) {
      setError(err.message ?? 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  const handleMarkClean = async (roomId: string) => {
    setTransitioning(roomId);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/cleaning/batch'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roomIds: [roomId],
          targetStatus: 'CLEAN',
          override: false,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      // Refresh the list
      await fetchRooms();
    } catch (err: any) {
      setError(err.message ?? 'Transition failed');
    } finally {
      setTransitioning(null);
    }
  };

  return (
    <PanelShell align="top">
      <div className="flex items-center justify-between">
        <PanelHeader title="Room Cleaning" subtitle="Tap to mark dirty rooms as clean" />
        <button
          onClick={() => void fetchRooms()}
          disabled={loading}
          className="rounded-md px-3 py-1 text-xs font-semibold transition"
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

      <div className="mt-4 flex flex-col gap-2">
        {rooms.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-lg border p-3"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
          >
            <div className="flex items-center gap-3">
              <span
                className="text-base font-bold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
                {r.number}
              </span>
              <Badge color="error" variant="light" size="sm">
                dirty
              </Badge>
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={transitioning === r.id}
              onClick={() => void handleMarkClean(r.id)}
            >
              {transitioning === r.id ? 'Updating…' : 'Mark Clean'}
            </Button>
          </div>
        ))}

        {rooms.length === 0 && !loading && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>All rooms clean ✨</p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
