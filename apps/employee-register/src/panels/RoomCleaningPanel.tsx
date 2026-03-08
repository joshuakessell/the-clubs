import { useEffect, useState, useCallback, useMemo } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { Button, useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { StatusDot } from '../components/StatusDot';

// ── Types ────────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  number: string;
  status: string;
  type?: string;
  floor?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  DOUBLE: 'Double',
  SPECIAL: 'Special',
  LOCKER: 'Locker',
};

const COLUMNS: DataTableColumn<Room>[] = [
  {
    key: 'number',
    header: 'Room',
    width: '120px',
    render: (r) => (
      <span
        className="text-sm font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
      >
        {r.number}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    render: (r) => (
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—'}
      </span>
    ),
  },
  {
    key: 'floor',
    header: 'Floor',
    render: (r) => (
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {r.floor == null ? '—' : `Floor ${r.floor}`}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusDot status={r.status} />,
  },
];

// ── Main Component ───────────────────────────────────────────────────────────

/**
 * RoomCleaningPanel — Batch-select dirty rooms and mark them clean.
 *
 * Uses the shared DataTable for consistent table styling.
 */
export function RoomCleaningPanel() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useAuthStore((s) => s.session?.sessionToken);

  // ── Data fetching ───────────────────────────────────────────────────

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/inventory/rooms'), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const dirty = (data.rooms ?? []).filter((r: Room) => r.status === 'DIRTY');
      setRooms(dirty);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  // ── Batch clean ─────────────────────────────────────────────────────

  const handleCleanSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = [...selected];

    const previousRooms = rooms;
    setRooms((prev) => prev.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    setError(null);
    setCleaning(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/cleaning/batch'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ roomIds: ids, targetStatus: 'CLEAN', override: false }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      setRooms(previousRooms);
      setSelected(new Set(ids));
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setCleaning(false);
    }
  }, [selected, rooms, token]);

  // ── Derived state ───────────────────────────────────────────────────

  const selectionCount = selected.size;
  const isEmpty = useMemo(() => rooms.length === 0 && !loading, [rooms, loading]);

  const statusLabel = selectionCount === 0
    ? `${rooms.length} dirty room${rooms.length === 1 ? '' : 's'}`
    : `${selectionCount} of ${rooms.length} selected`;

  const buttonLabel = cleaning
    ? 'Cleaning…'
    : selectionCount === 0
      ? 'Select rooms'
      : `Clean ${selectionCount} Room${selectionCount === 1 ? '' : 's'}`;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <PanelShell align="top">
      {/* Header */}
      <div className="flex items-center justify-between">
        <PanelHeader title="Room Cleaning" subtitle="Select rooms and mark them clean" />
        <button
          onClick={() => void fetchRooms()}
          disabled={loading}
          className="rounded-md px-3 py-1.5 text-xs font-semibold"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-default)',
            transition: 'opacity 0.15s ease',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Error */}
      {error ? (
        <p
          className="mt-2 rounded-md px-3 py-2 text-xs font-medium"
          style={{
            color: 'var(--color-status-error)',
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
          }}
        >
          {error}
        </p>
      ) : null}

      {/* Table */}
      {isEmpty ? (
        loading ? null : (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <span className="text-3xl">✨</span>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
              All rooms are clean
            </p>
          </div>
        )
      ) : (
        <>
          <div className="mt-4">
            <DataTable
              columns={COLUMNS}
              data={rooms}
              rowKey={(r) => r.id}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              emptyMessage="All rooms are clean ✨"
              emptyIcon="✨"
            />
          </div>

          {/* Action bar */}
          <div
            className="mt-3 flex items-center justify-between rounded-xl px-4 py-3"
            style={{
              backgroundColor: selectionCount > 0
                ? 'color-mix(in oklch, var(--color-accent-primary) 8%, transparent)'
                : 'var(--color-surface-overlay)',
              border: `1px solid ${
                selectionCount > 0
                  ? 'color-mix(in oklch, var(--color-accent-primary) 25%, transparent)'
                  : 'var(--color-border-default)'
              }`,
              transition: 'background-color 0.2s ease, border-color 0.2s ease',
            }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {statusLabel}
            </span>
            <Button
              size="sm"
              variant="primary"
              disabled={selectionCount === 0 || cleaning}
              onClick={() => void handleCleanSelected()}
            >
              {buttonLabel}
            </Button>
          </div>
        </>
      )}
    </PanelShell>
  );
}
