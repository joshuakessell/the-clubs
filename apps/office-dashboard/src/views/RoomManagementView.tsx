import { useState, useCallback } from 'react';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';

/* ─── Types ──────────────────────────────────────────────────── */

interface RoomItem {
  id: string;
  number: string;
  type: string;
  status: string;
  floor: number;
  isOccupied: boolean;
}

interface LockerItem {
  id: string;
  number: string;
  status: string;
  isOccupied: boolean;
}

interface ApiData {
  rooms: RoomItem[];
  lockers: LockerItem[];
}

type Tab = 'rooms' | 'lockers';

/* ─── Status Styles ──────────────────────────────────────────── */

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  CLEAN:          { bg: 'color-mix(in oklch, var(--color-status-success) 12%, transparent)',  text: '#22c55e', label: 'Clean' },
  DIRTY:          { bg: 'color-mix(in oklch, var(--color-status-error) 12%, transparent)',  text: '#ef4444', label: 'Dirty' },
  OCCUPIED:       { bg: 'color-mix(in oklch, #6366f1 12%, transparent)', text: '#6366f1', label: 'Occupied' },
  OUT_OF_SERVICE: { bg: 'color-mix(in oklch, #9ca3af 15%, transparent)', text: '#9ca3af', label: 'Out of Service' },
};

const TYPE_LABELS: Record<string, string> = {
  STANDARD: 'Standard',
  DOUBLE: 'Double',
  SPECIAL: 'Special',
};

/* ─── Component ──────────────────────────────────────────────── */

export function RoomManagementView() {
  const { data, loading, error, refetch } = useDashboardFetch<ApiData>('/api/v1/admin/room-management');
  const [tab, setTab] = useState<Tab>('rooms');
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  /* ── Add Room form state ── */
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomType, setNewRoomType] = useState<'STANDARD' | 'DOUBLE' | 'SPECIAL'>('STANDARD');
  const [newRoomFloor, setNewRoomFloor] = useState(1);

  /* ── Add Locker form state ── */
  const [showAddLocker, setShowAddLocker] = useState(false);
  const [newLockerNumber, setNewLockerNumber] = useState('');

  /* ── Edit Room inline state ── */
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editType, setEditType] = useState<'STANDARD' | 'DOUBLE' | 'SPECIAL'>('STANDARD');

  /* ── Floor filter + view mode ── */
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  /* ── Bulk selection state ── */
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());

  const selectableRooms = (data?.rooms ?? []).filter((r) => !r.isOccupied);
  const allSelected = selectableRooms.length > 0 && selectableRooms.every((r) => selectedRoomIds.has(r.id));

  const toggleRoom = (id: string) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedRoomIds(new Set());
    } else {
      setSelectedRoomIds(new Set(selectableRooms.map((r) => r.id)));
    }
  };

  const handleBulkStatus = (status: string) => {
    void doMutate(async () => {
      await Promise.all(
        [...selectedRoomIds].map((id) =>
          dashboardMutate(`/api/v1/admin/room-management/rooms/${id}/set-status`, 'POST', { status })
        ),
      );
      setSelectedRoomIds(new Set());
    });
  };

  const doMutate = useCallback(async (fn: () => Promise<unknown>) => {
    setMutating(true);
    setMutateError(null);
    try {
      await fn();
      await refetch();
    } catch (err) {
      const parsed = tryParseJson((err as Error)?.message);
      setMutateError(parsed?.error ?? (err as Error)?.message ?? 'Operation failed');
    } finally {
      setMutating(false);
    }
  }, [refetch]);

  /* ── Room actions ── */
  const handleAddRoom = () => {
    if (!/^\d{3}$/.test(newRoomNumber)) {
      setMutateError('Room number must be exactly 3 digits');
      return;
    }
    void doMutate(async () => {
      await dashboardMutate('/api/v1/admin/room-management/rooms', 'POST', {
        number: newRoomNumber,
        type: newRoomType,
        floor: newRoomFloor,
      });
      setShowAddRoom(false);
      setNewRoomNumber('');
      setNewRoomType('STANDARD');
      setNewRoomFloor(1);
    });
  };

  const handleEditRoom = (roomId: string) => {
    void doMutate(async () => {
      await dashboardMutate(`/api/v1/admin/room-management/rooms/${roomId}`, 'PATCH', {
        type: editType,
      });
      setEditingRoomId(null);
    });
  };

  const handleSetRoomStatus = (roomId: string, status: string) => {
    void doMutate(() =>
      dashboardMutate(`/api/v1/admin/room-management/rooms/${roomId}/set-status`, 'POST', { status })
    );
  };

  /* ── Locker actions ── */
  const handleAddLocker = () => {
    if (!/^\d{3}$/.test(newLockerNumber)) {
      setMutateError('Locker number must be exactly 3 digits');
      return;
    }
    void doMutate(async () => {
      await dashboardMutate('/api/v1/admin/room-management/lockers', 'POST', {
        number: newLockerNumber,
      });
      setShowAddLocker(false);
      setNewLockerNumber('');
    });
  };

  const handleSetLockerStatus = (resourceId: string, status: string) => {
    void doMutate(() =>
      dashboardMutate(`/api/v1/admin/room-management/lockers/${resourceId}/set-status`, 'POST', { status })
    );
  };

  const rooms = (data?.rooms ?? []).filter((r) => floorFilter == null || r.floor === floorFilter);
  const allRooms = data?.rooms ?? [];
  const lockers = data?.lockers ?? [];
  const floors = [...new Set(allRooms.map((r) => r.floor))].sort((a, b) => a - b);

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Room Management
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            Add, edit, or disable rooms and lockers
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={loading}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid var(--color-border-default)',
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Error banners */}
      {(error || mutateError) && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderRadius: 8,
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
            color: '#ef4444',
            fontSize: 13,
          }}
        >
          {error || mutateError}
        </div>
      )}

      {/* Tab bar + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, borderBottom: '1px solid var(--color-border-default)' }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['rooms', 'lockers'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
                backgroundColor: 'transparent',
                color: tab === t ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t === 'rooms' ? `Rooms (${rooms.length})` : `Lockers (${lockers.length})`}
            </button>
          ))}
        </div>
        {tab === 'rooms' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 6 }}>
            {/* Floor filter */}
            {floors.length > 1 && (
              <select
                value={floorFilter ?? ''}
                onChange={(e) => setFloorFilter(e.target.value ? Number(e.target.value) : null)}
                style={{
                  padding: '4px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                  border: '1px solid var(--color-border-default)',
                  backgroundColor: 'var(--color-surface-input)', color: 'var(--color-text-primary)',
                }}
              >
                <option value="">All Floors</option>
                {floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
              </select>
            )}
            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--color-border-default)' }}>
              {(['table', 'grid'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setViewMode(m)}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                    backgroundColor: viewMode === m ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
                    color: viewMode === m ? '#fff' : 'var(--color-text-muted)',
                  }}>
                  {m === 'table' ? '☰ Table' : '⊞ Grid'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── ROOMS TAB ─────────────────────────────────────────── */}
      {tab === 'rooms' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            {/* Bulk action bar */}
            {selectedRoomIds.size > 0 && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center', padding: '6px 14px',
                borderRadius: 8, border: '1px solid var(--color-accent-primary)',
                backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 6%, transparent)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent-primary)' }}>
                  {selectedRoomIds.size} selected
                </span>
                <ActionButton label="Set Clean" onClick={() => handleBulkStatus('CLEAN')} disabled={mutating} accent />
                <ActionButton label="Set Dirty" onClick={() => handleBulkStatus('DIRTY')} disabled={mutating} danger />
                <ActionButton label="Set OOS" onClick={() => handleBulkStatus('OUT_OF_SERVICE')} disabled={mutating} />
                <ActionButton label="Clear" onClick={() => setSelectedRoomIds(new Set())} disabled={false} />
              </div>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={() => setShowAddRoom(!showAddRoom)}
                disabled={mutating}
                style={{
                  padding: '7px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid var(--color-accent-primary)',
                  backgroundColor: showAddRoom ? 'transparent' : 'var(--color-accent-primary)',
                  color: showAddRoom ? 'var(--color-accent-primary)' : '#fff',
                  cursor: 'pointer',
                }}
              >
                {showAddRoom ? 'Cancel' : '+ Add Room'}
              </button>
            </div>
          </div>

          {/* Add Room form */}
          {showAddRoom && (
            <div
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: 16,
                padding: 14,
                borderRadius: 8,
                backgroundColor: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-default)',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Number (3 digits)
                </label>
                <input
                  type="text"
                  maxLength={3}
                  value={newRoomNumber}
                  onChange={(e) => setNewRoomNumber(e.target.value.replaceAll(/\D/g, '').slice(0, 3))}
                  placeholder="101"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-surface-input)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Type
                </label>
                <select
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as 'STANDARD' | 'DOUBLE' | 'SPECIAL')}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-surface-input)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="DOUBLE">Double</option>
                  <option value="SPECIAL">Special</option>
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Floor
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newRoomFloor}
                  onChange={(e) => setNewRoomFloor(parseInt(e.target.value, 10) || 1)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-surface-input)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <button
                onClick={handleAddRoom}
                disabled={mutating || newRoomNumber.length !== 3}
                style={{
                  padding: '7px 18px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: 'var(--color-accent-primary)',
                  color: '#fff',
                  cursor: 'pointer',
                  opacity: mutating || newRoomNumber.length !== 3 ? 0.5 : 1,
                }}
              >
                Create
              </button>
            </div>
          )}

          {/* ── Cleaning Queue Priority ── */}
          {(() => {
            const TIER_PRIORITY: Record<string, number> = { SPECIAL: 0, DOUBLE: 1, STANDARD: 2 };
            const dirtyRooms = rooms
              .filter((r) => r.status === 'DIRTY')
              .sort((a, b) => (TIER_PRIORITY[a.type] ?? 9) - (TIER_PRIORITY[b.type] ?? 9));
            if (dirtyRooms.length === 0) return null;
            return (
              <div style={{
                marginBottom: 16, padding: 14, borderRadius: 10,
                border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, var(--color-border-default))',
                backgroundColor: 'color-mix(in oklch, var(--color-status-error) 4%, transparent)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-status-error)' }}>
                    🧹 Cleaning Queue ({dirtyRooms.length})
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Sorted by tier priority</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {dirtyRooms.map((room) => (
                    <div key={room.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                      border: '1px solid var(--color-border-default)',
                      backgroundColor: 'var(--color-surface-overlay)',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                        {room.number}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                        {TYPE_LABELS[room.type] ?? room.type}
                      </span>
                      <ActionButton label="✓ Clean" onClick={() => handleSetRoomStatus(room.id, 'CLEAN')} disabled={mutating} accent />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {viewMode === 'grid' ? (
            /* ── Grid Mode ── */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {rooms.map((room) => {
                const sc = STATUS_COLORS[room.status] ?? STATUS_COLORS.CLEAN;
                return (
                  <div key={room.id} style={{
                    padding: 14, borderRadius: 10, border: `1px solid ${sc.text}30`,
                    backgroundColor: sc.bg, position: 'relative',
                    transition: 'transform 0.1s, box-shadow 0.1s',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                      Room {room.number}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {TYPE_LABELS[room.type] ?? room.type} · Floor {room.floor}
                    </div>
                    <span style={{
                      display: 'inline-block', marginTop: 8, padding: '2px 8px', borderRadius: 999,
                      fontSize: 10, fontWeight: 600, backgroundColor: `${sc.text}20`, color: sc.text,
                    }}>
                      {sc.label}
                    </span>
                    {!room.isOccupied && room.status !== 'OUT_OF_SERVICE' && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                        <ActionButton label="OOS" onClick={() => handleSetRoomStatus(room.id, 'OUT_OF_SERVICE')} disabled={mutating} danger />
                      </div>
                    )}
                    {room.status === 'OUT_OF_SERVICE' && (
                      <div style={{ marginTop: 8 }}>
                        <ActionButton label="Restore" onClick={() => handleSetRoomStatus(room.id, 'CLEAN')} disabled={mutating} accent />
                      </div>
                    )}
                  </div>
                );
              })}
              {rooms.length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 32, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  No rooms configured
                </div>
              )}
            </div>
          ) : (
            /* ── Table Mode ── */
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--color-border-default)',
                overflow: 'hidden',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface-overlay)' }}>
                    <th style={{ ...thStyle, width: 36 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        style={{ accentColor: 'var(--color-accent-primary)', cursor: 'pointer' }} />
                    </th>
                    <th style={thStyle}>Room</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Floor</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => {
                    const sc = STATUS_COLORS[room.status] ?? STATUS_COLORS.CLEAN;
                    const isEditing = editingRoomId === room.id;
                    return (
                      <tr key={room.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <td style={{ ...tdStyle, width: 36 }}>
                          {!room.isOccupied && (
                            <input type="checkbox" checked={selectedRoomIds.has(room.id)} onChange={() => toggleRoom(room.id)}
                              style={{ accentColor: 'var(--color-accent-primary)', cursor: 'pointer' }} />
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                            Room {room.number}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          {isEditing ? (
                            <select
                              value={editType}
                              onChange={(e) => setEditType(e.target.value as 'STANDARD' | 'DOUBLE' | 'SPECIAL')}
                              style={{
                                padding: '3px 6px',
                                fontSize: 12,
                                borderRadius: 4,
                                border: '1px solid var(--color-border-default)',
                                backgroundColor: 'var(--color-surface-input)',
                                color: 'var(--color-text-primary)',
                              }}
                            >
                              <option value="STANDARD">Standard</option>
                              <option value="DOUBLE">Double</option>
                              <option value="SPECIAL">Special</option>
                            </select>
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)' }}>{TYPE_LABELS[room.type] ?? room.type}</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: 'var(--color-text-muted)' }}>{room.floor}</span>
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              backgroundColor: sc.bg,
                              color: sc.text,
                            }}
                          >
                            {sc.label}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {isEditing ? (
                              <>
                                <ActionButton label="Save" onClick={() => handleEditRoom(room.id)} disabled={mutating} accent />
                                <ActionButton label="Cancel" onClick={() => setEditingRoomId(null)} disabled={mutating} />
                              </>
                            ) : (
                              <>
                                {!room.isOccupied && room.status !== 'OUT_OF_SERVICE' && (
                                  <ActionButton
                                    label="Edit Type"
                                    onClick={() => { setEditingRoomId(room.id); setEditType(room.type as 'STANDARD' | 'DOUBLE' | 'SPECIAL'); }}
                                    disabled={mutating}
                                  />
                                )}
                                {room.status === 'OUT_OF_SERVICE' ? (
                                  <ActionButton label="Restore" onClick={() => handleSetRoomStatus(room.id, 'CLEAN')} disabled={mutating} accent />
                                ) : !room.isOccupied ? (
                                  <ActionButton label="Set OOS" onClick={() => handleSetRoomStatus(room.id, 'OUT_OF_SERVICE')} disabled={mutating} danger />
                                ) : null}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rooms.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No rooms configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── LOCKERS TAB ───────────────────────────────────────── */}
      {tab === 'lockers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              onClick={() => setShowAddLocker(!showAddLocker)}
              disabled={mutating}
              style={{
                padding: '7px 16px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid var(--color-accent-primary)',
                backgroundColor: showAddLocker ? 'transparent' : 'var(--color-accent-primary)',
                color: showAddLocker ? 'var(--color-accent-primary)' : '#fff',
                cursor: 'pointer',
              }}
            >
              {showAddLocker ? 'Cancel' : '+ Add Locker'}
            </button>
          </div>

          {/* Add Locker form */}
          {showAddLocker && (
            <div
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: 16,
                padding: 14,
                borderRadius: 8,
                backgroundColor: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-default)',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Number (3 digits)
                </label>
                <input
                  type="text"
                  maxLength={3}
                  value={newLockerNumber}
                  onChange={(e) => setNewLockerNumber(e.target.value.replaceAll(/\D/g, '').slice(0, 3))}
                  placeholder="001"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid var(--color-border-default)',
                    backgroundColor: 'var(--color-surface-input)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <button
                onClick={handleAddLocker}
                disabled={mutating || newLockerNumber.length !== 3}
                style={{
                  padding: '7px 18px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: 'var(--color-accent-primary)',
                  color: '#fff',
                  cursor: 'pointer',
                  opacity: mutating || newLockerNumber.length !== 3 ? 0.5 : 1,
                }}
              >
                Create
              </button>
            </div>
          )}

          {/* Lockers table */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid var(--color-border-default)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-overlay)' }}>
                  <th style={thStyle}>Locker</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lockers.map((locker) => {
                  const sc = STATUS_COLORS[locker.status] ?? STATUS_COLORS.CLEAN;
                  return (
                    <tr key={locker.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                          Locker {locker.number}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            backgroundColor: sc.bg,
                            color: sc.text,
                          }}
                        >
                          {sc.label}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {locker.status === 'OUT_OF_SERVICE' ? (
                            <ActionButton label="Restore" onClick={() => handleSetLockerStatus(locker.id, 'CLEAN')} disabled={mutating} accent />
                          ) : !locker.isOccupied ? (
                            <ActionButton label="Set OOS" onClick={() => handleSetLockerStatus(locker.id, 'OUT_OF_SERVICE')} disabled={mutating} danger />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {lockers.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No lockers configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Shared styles & helpers ────────────────────────────────── */

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border-default)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  verticalAlign: 'middle',
};

function ActionButton({
  label,
  onClick,
  disabled,
  accent,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 4,
        border: '1px solid',
        borderColor: danger
          ? 'color-mix(in oklch, var(--color-status-error) 30%, transparent)'
          : accent
            ? 'var(--color-accent-primary)'
            : 'var(--color-border-default)',
        backgroundColor: danger
          ? 'color-mix(in oklch, var(--color-status-error) 8%, transparent)'
          : accent
            ? 'color-mix(in oklch, var(--color-accent-primary) 8%, transparent)'
            : 'transparent',
        color: danger
          ? '#ef4444'
          : accent
            ? 'var(--color-accent-primary)'
            : 'var(--color-text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function tryParseJson(str: string | undefined): Record<string, string> | null {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}
