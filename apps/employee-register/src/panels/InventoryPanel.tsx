import { useEffect, useState, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

interface InventoryItem {
  id: string;
  number: string;
  status: string;
  assignedTo?: string;
  assignedMemberName?: string;
  checkoutAt?: string;
  checkinAt?: string;
  occupancyId?: string;
  visitId?: string;
}

interface RoomItem extends InventoryItem {
  tier: string;
  floor: number;
}

const STATUS_DOT: Record<string, string> = {
  CLEAN: 'var(--color-status-success)',
  OCCUPIED: 'var(--color-accent-primary)',
  DIRTY: 'var(--color-status-error)',
  OUT_OF_SERVICE: 'var(--color-text-muted)',
};

const STATUS_LABEL: Record<string, string> = {
  CLEAN: 'Available',
  OCCUPIED: 'Occupied',
  DIRTY: 'Dirty',
  OUT_OF_SERVICE: 'OOS',
};

interface ColumnDef {
  key: string;
  label: string;
  emoji: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'LOCKER', label: 'Lockers', emoji: '🔐' },
  { key: 'STANDARD', label: 'Private Rooms', emoji: '🛏️' },
  { key: 'DOUBLE', label: 'Double Rooms', emoji: '🛋️' },
  { key: 'SPECIAL', label: 'Special Rooms', emoji: '⭐' },
];

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isOverdue(checkoutAt?: string): boolean {
  if (!checkoutAt) return false;
  return new Date(checkoutAt) < new Date();
}

/**
 * InventoryPanel — 4-column live inventory view.
 * Columns: Lockers | Private Rooms | Double Rooms | Special Rooms
 * Each column shows items sorted by checkout time (soonest first).
 */
export function InventoryPanel() {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [lockers, setLockers] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useAuthStore((s) => s.session?.sessionToken);
  const openCustomerAccount = useRegisterStore((s) => s.openCustomerAccount);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/inventory/detailed'), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRooms(data.rooms ?? []);
      setLockers(data.lockers ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Sort order: occupied first, empty (CLEAN) last
  const STATUS_SORT: Record<string, number> = {
    OCCUPIED: 0,
    DIRTY: 1,
    OUT_OF_SERVICE: 2,
    CLEAN: 3,
  };
  const sortItems = (items: InventoryItem[]) =>
    [...items].sort(
      (a, b) => (STATUS_SORT[a.status] ?? 5) - (STATUS_SORT[b.status] ?? 5),
    );

  // Group rooms by tier, lockers separately
  const grouped: Record<string, InventoryItem[]> = {
    LOCKER: sortItems(lockers),
    STANDARD: sortItems(rooms.filter((r) => r.tier === 'STANDARD')),
    DOUBLE: sortItems(rooms.filter((r) => r.tier === 'DOUBLE')),
    SPECIAL: sortItems(rooms.filter((r) => r.tier === 'SPECIAL')),
  };

  return (
    <PanelShell align= "top" scroll = "hidden" >
      <div className="flex items-center justify-between" >
        <PanelHeader title="Rentals" subtitle = "Live inventory by type" />
          <button
          onClick={ () => void fetchData() }
  disabled = { loading }
  className = "rounded-md px-3 py-1 text-xs font-semibold transition"
  style = {{
    backgroundColor: 'var(--color-surface-overlay)',
      color: 'var(--color-text-secondary)',
        border: '1px solid var(--color-border-default)',
          }
}
        >
  { loading? 'Loading…': '↻ Refresh' }
  </button>
  </div>

{
  error && (
    <p className="mt-2 text-xs font-medium" style = {{ color: 'var(--color-status-error)' }
}>
  { error }
  </p>
      )}

{/* 4-column grid */ }
<div className="mt-3 grid grid-cols-4 gap-3" style = {{ height: 'calc(100% - 60px)', overflow: 'hidden' }}>
{
  COLUMNS.map((col) => {
    const items = grouped[col.key] ?? [];
    const occupied = items.filter((i) => i.status === 'OCCUPIED').length;
    const available = items.filter((i) => i.status === 'CLEAN').length;

    return (
      <div
              key= { col.key }
    className = "flex flex-col rounded-lg border"
    style = {{
      backgroundColor: 'var(--color-surface-overlay)',
        borderColor: 'var(--color-border-subtle)',
          overflow: 'hidden',
              }
  }
            >
    {/* Column header */ }
    < div
                className = "flex items-center justify-between px-3 py-2"
                style = {{ borderBottom: '1px solid var(--color-border-subtle)' }}
  >
  <div className="flex items-center gap-1.5" >
    <span className="text-sm" > { col.emoji } </span>
      < span
className = "text-sm font-bold"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
                  >
  { col.label }
  </span>
  </div>
  < div className = "flex items-center gap-2 text-xs" >
    <span style={ { color: 'var(--color-status-success)' } }> { available } </span>
      < span style = {{ color: 'var(--color-text-muted)' }}> /</span >
        <span style={ { color: 'var(--color-text-muted)' } }> { items.length } </span>
          </div>
          </div>

{/* Scrollable item list */ }
<div className="flex-1 overflow-y-auto" >
{
  items.length === 0 && (
    <p className="px-3 py-4 text-center text-xs" style = {{ color: 'var(--color-text-muted)' }}>
      None
      </p>
                )}
{
  items.map((item) => {
    const overdue = isOverdue(item.checkoutAt);
    const statusDot = STATUS_DOT[item.status] ?? 'var(--color-text-muted)';

    return (
      <div
                      key= { item.id }
    className = "flex items-center gap-1.5 px-2 py-1"
    style = {{ borderBottom: '1px solid var(--color-border-subtle)' }
  }
                    >
    {/* Status dot */ }
    < span className = "h-2 w-2 shrink-0 rounded-full" style = {{ backgroundColor: statusDot }} />

{/* Number */ }
<span
                        className="w-7 shrink-0 text-sm font-bold tabular-nums"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
                      >
  { item.number }
  </span>

{/* Customer name + checkout */ }
<div className="min-w-0 flex-1" style = {{ containerType: 'inline-size' }}>
{
  item.assignedMemberName ? (
    <>
    <button
                              type= "button"
                              onClick={() => {
  if (item.assignedTo) {
    openCustomerAccount(item.assignedTo, item.assignedMemberName ?? '', {
      authToken: token,
      returnTab: 'inventory',
      activeCheckin: item.status === 'OCCUPIED' && item.occupancyId ? {
        visitId: item.visitId ?? item.occupancyId,
        occupancyId: item.occupancyId,
        resourceType: col.key === 'LOCKER' ? 'locker' : 'room',
        resourceNumber: item.number,
        checkinAt: item.checkinAt ?? null,
        checkoutAt: item.checkoutAt ?? null,
        overdue: isOverdue(item.checkoutAt),
      } : undefined,
    });
  }
}}
className = "text-left font-medium leading-tight w-full"
style = {{
  color: 'var(--color-accent-primary)',
    cursor: item.assignedTo ? 'pointer' : 'default',
      background: 'none',
        border: 'none',
          padding: 0,
            fontSize: 'clamp(12px, 8cqw, 16px)',
              whiteSpace: 'nowrap',
                overflow: 'hidden',
                  textOverflow: 'ellipsis',
                              }}
title = {`View ${item.assignedMemberName}'s profile`}
                            >
  { item.assignedMemberName }
  </button>
  < p
className = "text-xs leading-tight tabular-nums"
style = {{
  color: overdue ? 'var(--color-status-error)' : 'var(--color-text-muted)',
    fontWeight: overdue ? 600 : 400,
                              }}
                            >
  { overdue? 'OVERDUE': `Out ${formatTime(item.checkoutAt)}` }
  </p>
  </>
                        ) : (
  <p className= "text-xs" style = {{ color: 'var(--color-text-muted)' }}>
    { STATUS_LABEL[item.status] ?? item.status }
    </p>
                        )}
</div>
  </div>
                  );
                })}
</div>

{/* Column footer — occupied count */ }
<div
                className="flex items-center justify-center px-3 py-2 text-xs font-semibold"
style = {{
  borderTop: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-muted)',
      backgroundColor: 'var(--color-surface-input)',
                }}
              >
  { occupied } occupied
    </div>
    </div>
          );
        })}
</div>
  </PanelShell>
  );
}
