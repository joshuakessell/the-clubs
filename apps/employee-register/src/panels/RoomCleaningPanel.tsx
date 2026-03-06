import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { Button, useAuthStore } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

// ── Types ────────────────────────────────────────────────────────────────────

interface Room {
  id: string;
  number: string;
  status: string;
  type?: string;
  floor?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  DIRTY: 'var(--color-status-error)',
  CLEANING: 'var(--color-status-warning, #f59e0b)',
};

const TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  DOUBLE: 'Double',
  SPECIAL: 'Special',
  LOCKER: 'Locker',
};

// ── Extracted sub-components (composition pattern) ───────────────────────────

/** Status indicator dot + label — avoids repeated inline‑style blocks. */
function StatusPill({ status }: { status: string }) {
  const dotColor = STATUS_DOT[status] ?? 'var(--color-text-muted)';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: dotColor }}>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
      />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

/** Checkbox with accent-colored styling. */
function RowCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      style={{
        cursor: 'pointer',
        accentColor: 'var(--color-accent-primary)',
        width: 16,
        height: 16,
      }}
    />
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

/**
 * RoomCleaningPanel — Batch-select dirty rooms and mark them clean.
 *
 * Performance notes (Vercel React best practices):
 * - Uses functional setState (`rerender-functional-setstate`) for immutable, stable updates
 * - Ternary conditionals instead of `&&` (`rendering-conditional-render`)
 * - Stable callbacks via useCallback
 * - Memoized derived values for selection state
 */
export function RoomCleaningPanel() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useAuthStore((s) => s.session?.sessionToken);

  // ── Data fetching ───────────────────────────────────────────────────────

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

  // ── Selection handlers (functional setState) ────────────────────────────

  const toggleRoom = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allIds = rooms.map((r) => r.id);
      return prev.size === allIds.length ? new Set<string>() : new Set(allIds);
    });
  }, [rooms]);

  // ── Batch clean ─────────────────────────────────────────────────────────

  const handleCleanSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = [...selected];

    // Optimistic removal
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
        body: JSON.stringify({
          roomIds: ids,
          targetStatus: 'CLEAN',
          override: false,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      // Rollback
      setRooms(previousRooms);
      setSelected(new Set(ids));
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setCleaning(false);
    }
  }, [selected, rooms, token]);

  // ── Derived state (memoised booleans) ───────────────────────────────────

  const allSelected = useMemo(() => rooms.length > 0 && selected.size === rooms.length, [rooms, selected]);
  const someSelected = useMemo(() => selected.size > 0 && !allSelected, [selected, allSelected]);
  const selectionCount = selected.size;
  const isEmpty = rooms.length === 0 && !loading;

  // ── Render ──────────────────────────────────────────────────────────────

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

      {/* Content */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12">
          <span className="text-3xl">✨</span>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            All rooms are clean
          </p>
        </div>
      ) : rooms.length > 0 ? (
        <>
          {/* ── Table ─────────────────────────────────────────────────── */}
          <div
            className="mt-4 overflow-hidden rounded-xl border"
            style={{
              borderColor: 'var(--color-border-default)',
              boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)',
            }}
          >
            <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-overlay)' }}>
                  <th
                    className="w-12 px-3 py-3 text-center"
                    style={{ borderBottom: '1px solid var(--color-border-default)' }}
                  >
                    <RowCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  {['Room', 'Type', 'Floor', 'Status'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-wider"
                      style={{
                        color: 'var(--color-text-muted)',
                        borderBottom: '1px solid var(--color-border-default)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r, idx) => {
                  const isSelected = selected.has(r.id);
                  const isOdd = idx % 2 === 1;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => toggleRoom(r.id)}
                      className="group"
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSelected
                          ? 'color-mix(in oklch, var(--color-accent-primary) 10%, transparent)'
                          : isOdd
                            ? 'var(--color-surface-overlay)'
                            : 'var(--color-surface-card)',
                        borderBottom: '1px solid var(--color-border-default)',
                        transition: 'background-color 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor =
                            'color-mix(in oklch, var(--color-accent-primary) 5%, transparent)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = isOdd
                            ? 'var(--color-surface-overlay)'
                            : 'var(--color-surface-card)';
                        }
                      }}
                    >
                      <td className="px-3 py-3 text-center">
                        <RowCheckbox checked={isSelected} onChange={() => toggleRoom(r.id)} />
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="text-sm font-bold"
                          style={{
                            fontFamily: 'var(--font-display)',
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          {r.number}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {r.floor != null ? `Floor ${r.floor}` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Action Bar ────────────────────────────────────────────── */}
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
              {selectionCount === 0
                ? `${rooms.length} dirty room${rooms.length !== 1 ? 's' : ''}`
                : `${selectionCount} of ${rooms.length} selected`}
            </span>
            <Button
              size="sm"
              variant="primary"
              disabled={selectionCount === 0 || cleaning}
              onClick={() => void handleCleanSelected()}
            >
              {cleaning
                ? 'Cleaning…'
                : selectionCount === 0
                  ? 'Select rooms'
                  : `Clean ${selectionCount} Room${selectionCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </>
      ) : null}
    </PanelShell>
  );
}
