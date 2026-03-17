import { useEffect, useRef } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useNow } from '../hooks/useNow';
import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface RegisterSession {
  registerNumber: 1 | 2 | 3;
  active: boolean;
  sessionId: string | null;
  employee: { id: string; displayName: string; role: string } | null;
  deviceId: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
  secondsSinceHeartbeat: number | null;
}

interface RoomExpiration {
  resourceId: string;
  roomNumber: string;
  roomTier: string;
  sessionId: string;
  customerName: string;
  membershipNumber: string | null;
  checkoutAt: string;
  minutesPast: number | null;
  minutesRemaining: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

interface KioskSession {
  id: string;
  laneId: string;
  status: string;
  staffName: string | null;
  customerName: string | null;
  membershipNumber: string | null;
  desiredRentalType: string | null;
  assignedResource: { id: string; number: string; type: string } | null;
  createdAt: string;
}

/* ── Helpers ───────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 10_000;

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function roomBadge(room: RoomExpiration): { color: 'error' | 'warning' | 'success' | 'gray'; label: string } {
  if (room.isExpired) return { color: 'error', label: `${formatMinutes(room.minutesPast ?? 0)} overdue` };
  if (room.isExpiringSoon) return { color: 'warning', label: `${formatMinutes(room.minutesRemaining ?? 0)} left` };
  return { color: 'success', label: `${formatMinutes(room.minutesRemaining ?? 0)} left` };
}

function roomCardBorder(room: RoomExpiration): string {
  if (room.isExpired) return 'color-mix(in oklch, var(--color-status-error) 30%, var(--color-border-default))';
  if (room.isExpiringSoon) return 'color-mix(in oklch, var(--color-status-warning) 25%, var(--color-border-default))';
  return 'color-mix(in oklch, var(--color-status-success) 15%, var(--color-border-default))';
}

function tierLabel(tier: string): string {
  if (tier === 'STANDARD') return 'Std';
  if (tier === 'DOUBLE') return 'Dbl';
  if (tier === 'SPECIAL') return 'VIP';
  return tier;
}

/* ── Component ─────────────────────────────────────────────────── */

export function MonitorView() {
  const { data: lanes, loading: lanesLoading, refetch: refetchLanes } = useDashboardFetch<RegisterSession[]>(
    '/api/v1/admin/register-sessions',
  );
  const { data: roomData, loading: roomsLoading, refetch: refetchRooms } = useDashboardFetch<{ expirations: RoomExpiration[] }>(
    '/api/v1/admin/rooms/expirations',
  );
  const { data: mgmtData, refetch: refetchMgmt } = useDashboardFetch<{ lockers: { id: string; status: string; isOccupied: boolean }[] }>(
    '/api/v1/admin/room-management',
  );
  const { data: kioskData, refetch: refetchKiosks } = useDashboardFetch<{ sessions: KioskSession[] }>(
    '/api/v1/checkin/lane-sessions',
  );

  const now = useNow(60000);

  const rooms = roomData?.expirations ?? [];
  const lockerList = mgmtData?.lockers ?? [];
  const lockersOccupied = lockerList.filter((l) => l.isOccupied).length;
  const lockersClean = lockerList.filter((l) => l.status === 'CLEAN' && !l.isOccupied).length;
  const lockersDirty = lockerList.filter((l) => l.status === 'DIRTY').length;
  const lockersOOS = lockerList.filter((l) => l.status === 'OUT_OF_SERVICE').length;
  const activeLanes = (lanes ?? []).filter((l) => l.active);
  const expiredCount = rooms.filter((r) => r.isExpired).length;
  const soonCount = rooms.filter((r) => r.isExpiringSoon).length;

  // Auto-poll every 10 seconds
  const refetchLanesRef = useRef(refetchLanes);
  const refetchRoomsRef = useRef(refetchRooms);
  useEffect(() => { refetchLanesRef.current = refetchLanes; }, [refetchLanes]);
  useEffect(() => { refetchRoomsRef.current = refetchRooms; }, [refetchRooms]);
  useEffect(() => {
    const id = setInterval(() => {
      void refetchLanesRef.current();
      void refetchRoomsRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const kioskSessions = kioskData?.sessions ?? [];

  const handleRefresh = () => { refetchLanes(); refetchRooms(); refetchMgmt(); refetchKiosks(); };
  const loading = lanesLoading || roomsLoading;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary header */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">
              Live Monitor
            </h2>
            <p className="text-sm text-(--color-text-muted)">
              {rooms.length} active session{rooms.length === 1 ? '' : 's'} ·{' '}
              {activeLanes.length}/3 registers active
              {expiredCount > 0 && <span className="text-(--color-status-error)"> · {expiredCount} overdue</span>}
              {soonCount > 0 && <span className="text-(--color-status-warning)"> · {soonCount} expiring soon</span>}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleRefresh}>Refresh</Button>
        </div>

        {/* Quick stats row */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          <StatCard label="Active Sessions" value={rooms.length} color="var(--color-accent-primary)" />
          <StatCard label="Registers Online" value={`${activeLanes.length}/3`} color="var(--color-status-success)" />
          <StatCard label="Overdue" value={expiredCount} color={expiredCount > 0 ? 'var(--color-status-error)' : 'var(--color-text-muted)'} />
          <StatCard label="Expiring < 30m" value={soonCount} color={soonCount > 0 ? 'var(--color-status-warning)' : 'var(--color-text-muted)'} />
        </div>
      </div>

      {loading && rooms.length === 0 && !lanes ? (
        <ViewSpinner />
      ) : (
        <>
          {/* Room Occupancy Grid */}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
              Room Occupancy
            </h3>
            {rooms.length > 0 ? (
              <div className="grid grid-cols-4 gap-3">
                {rooms.map((room) => {
                  const badge = roomBadge(room);
                  return (
                    <div key={room.resourceId} className="rounded-xl border p-4 transition hover:![border-color:var(--color-accent-primary)]"
                      style={{
                        backgroundColor: 'var(--color-surface-raised)',
                        borderColor: roomCardBorder(room),
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold tabular-nums font-(--font-display) text-(--color-text-primary)">
                            #{room.roomNumber}
                          </span>
                          <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
                            style={{ backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 10%, transparent)', color: 'var(--color-accent-primary)' }}>
                            {tierLabel(room.roomTier)}
                          </span>
                        </div>
                        <Badge color={badge.color} variant="light" size="sm">{badge.label}</Badge>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <p className="text-xs font-semibold truncate text-(--color-text-secondary)">
                          {room.customerName}
                        </p>
                        <p className="text-[10px] tabular-nums text-(--color-text-muted)">
                          Checkout: {new Date(room.checkoutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border p-6 text-center border-(--color-border-default)">
                <p className="text-sm text-(--color-text-muted)">No active room sessions</p>
              </div>
            )}
          </div>

          {/* Locker Occupancy Summary */}
          {lockerList.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
                Locker Occupancy
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="Occupied" value={lockersOccupied} color="var(--color-accent-primary)" />
                <StatCard label="Available" value={lockersClean} color="var(--color-status-success)" />
                <StatCard label="Dirty" value={lockersDirty} color={lockersDirty > 0 ? 'var(--color-status-error)' : 'var(--color-text-muted)'} />
                <StatCard label="Out of Service" value={lockersOOS} color={lockersOOS > 0 ? 'var(--color-status-warning)' : 'var(--color-text-muted)'} />
              </div>
            </div>
          )}

          {/* Kiosk Lane Sessions */}
          {kioskSessions.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
                Kiosk Sessions ({kioskSessions.length})
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {kioskSessions.map((ks) => {
                  const elapsed = Math.round((now - new Date(ks.createdAt).getTime()) / 60_000);
                  let statusColor: 'warning' | 'primary' | 'gray' = 'gray';
                  if (ks.status === 'AWAITING_ROOM') statusColor = 'warning';
                  else if (ks.status === 'PAYMENT' || ks.status === 'AGREEMENT') statusColor = 'primary';
                  return (
                    <div key={ks.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-(--color-text-primary)">
                          {ks.customerName ?? 'Guest'}
                        </span>
                        <Badge color={statusColor} variant="light" size="sm">{ks.status.replaceAll('_', ' ')}</Badge>
                      </div>
                      <div className="mt-2 flex flex-col gap-0.5 text-[10px] text-(--color-text-muted)">
                        {ks.desiredRentalType && <span>Type: {ks.desiredRentalType}</span>}
                        {ks.assignedResource && <span>Room: {ks.assignedResource.number}</span>}
                        <span>{elapsed}m elapsed</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Register Lanes */}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
              Register Lanes
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {(lanes ?? []).map((lane) => (
                <div key={lane.registerNumber} className="rounded-xl border p-5"
                  style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: lane.active ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold font-(--font-display) text-(--color-text-primary)">
                      Register {lane.registerNumber}
                    </span>
                    <Badge color={lane.active ? 'success' : 'gray'} variant="light" size="sm">{lane.active ? 'Active' : 'Idle'}</Badge>
                  </div>
                  {lane.employee ? (
                    <div className="mt-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-(--color-text-muted)">Employee</span>
                        <span className="font-semibold text-(--color-text-secondary)">{lane.employee.displayName}</span>
                      </div>
                      {lane.deviceId && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-(--color-text-muted)">Device</span>
                          <span className="font-mono text-[10px] text-(--color-text-secondary)">{lane.deviceId}</span>
                        </div>
                      )}
                      {lane.secondsSinceHeartbeat !== null && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-(--color-text-muted)">Heartbeat</span>
                          <span style={{ color: lane.secondsSinceHeartbeat > 120 ? 'var(--color-status-error)' : 'var(--color-text-secondary)' }}>
                            {lane.secondsSinceHeartbeat}s ago
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-center text-xs text-(--color-text-muted)">No active session</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────────── */

function StatCard({ label, value, color }: Readonly<{ label: string; value: string | number; color: string }>) {
  return (
    <div className="rounded-lg border px-4 py-3 border-(--color-border-default)">
      <p className="text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color }}>{value}</p>
    </div>
  );
}
