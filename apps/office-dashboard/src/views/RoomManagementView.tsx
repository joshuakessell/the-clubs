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
  CLEAN:          { bg: 'rgba(34,197,94,0.12)',  text: '#22c55e', label: 'Clean' },
  DIRTY:          { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444', label: 'Dirty' },
  OCCUPIED:       { bg: 'rgba(99,102,241,0.12)', text: '#6366f1', label: 'Occupied' },
  OUT_OF_SERVICE: { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af', label: 'Out of Service' },
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

  const doMutate = useCallback(async (fn: () => Promise<unknown>) => {
    setMutating(true);
    setMutateError(null);
    try {
      await fn();
      await refetch();
    } catch (err: any) {
      const parsed = tryParseJson(err?.message);
      setMutateError(parsed?.error ?? err?.message ?? 'Operation failed');
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

  const handleSetLockerStatus = (lockerId: string, status: string) => {
    void doMutate(() =>
      dashboardMutate(`/api/v1/admin/room-management/lockers/${lockerId}/set-status`, 'POST', { status })
    );
  };

  const rooms = data?.rooms ?? [];
  const lockers = data?.lockers ?? [];

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
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: '#ef4444',
            fontSize: 13,
          }}
        >
          {error || mutateError}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--color-border-default)' }}>
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

      {/* ─── ROOMS TAB ─────────────────────────────────────────── */}
      {tab === 'rooms' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
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
                  onChange={(e) => setNewRoomNumber(e.target.value.replace(/\D/g, '').slice(0, 3))}
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
                  onChange={(e) => setNewRoomType(e.target.value as any)}
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

          {/* Rooms table */}
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
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                          Room {room.number}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {isEditing ? (
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as any)}
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
                                  onClick={() => { setEditingRoomId(room.id); setEditType(room.type as any); }}
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
                    <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No rooms configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                  onChange={(e) => setNewLockerNumber(e.target.value.replace(/\D/g, '').slice(0, 3))}
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
          ? 'rgba(239,68,68,0.3)'
          : accent
            ? 'var(--color-accent-primary)'
            : 'var(--color-border-default)',
        backgroundColor: danger
          ? 'rgba(239,68,68,0.08)'
          : accent
            ? 'rgba(0,212,255,0.08)'
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
