import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface Device {
  deviceId: string;
  displayName: string;
  enabled: boolean;
  lastHeartbeatAt: string | null;
  secondsSinceHeartbeat: number | null;
  online: boolean;
  lastLaneId: string | null;
}

/* ── Helpers ───────────────────────────────────────────────────── */

const POLL_MS = 15_000;

function formatHeartbeat(seconds: number | null): string {
  if (seconds === null) return 'Never';
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function heartbeatColor(device: Device): string {
  if (!device.enabled) return 'var(--color-text-muted)';
  if (!device.lastHeartbeatAt) return 'var(--color-text-muted)';
  if (device.online) return 'var(--color-status-success)';
  return 'var(--color-status-error)';
}

function deviceBorderColor(d: Device): string {
  if (!d.enabled) return 'color-mix(in oklch, var(--color-status-error) 20%, transparent)';
  if (d.online) return 'color-mix(in oklch, var(--color-status-success) 25%, var(--color-border-default))';
  return 'var(--color-border-default)';
}

function deviceStatusBadge(d: Device): { color: 'error' | 'success' | 'gray'; label: string } {
  if (!d.enabled) return { color: 'error', label: 'Disabled' };
  if (d.online) return { color: 'success', label: 'Online' };
  if (d.lastHeartbeatAt) return { color: 'gray', label: 'Offline' };
  return { color: 'gray', label: 'No Heartbeat' };
}

/* ── Component ─────────────────────────────────────────────────── */

export function DevicesView() {
  const { data: devices, loading, error, refetch } = useDashboardFetch<Device[]>(
    '/api/v1/admin/devices',
  );
  const list = devices ?? [];
  const onlineCount = list.filter((d) => d.online && d.enabled).length;
  const offlineCount = list.filter((d) => !d.online && d.enabled && d.lastHeartbeatAt).length;

  // Auto-refresh every 15s to keep heartbeat indicators current
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    const id = setInterval(() => void refetchRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, []);

  /* ── Add form state ── */
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');

  const handleAdd = useCallback(async () => {
    if (!newId || !newName) return;
    try {
      await dashboardMutate('/api/v1/admin/devices', 'POST', { deviceId: newId, displayName: newName });
      setNewId(''); setNewName('');
      setShowAdd(false);
      refetch();
    } catch { /* logged by dashboardMutate */ }
  }, [newId, newName, refetch]);

  const handleToggle = useCallback(async (deviceId: string, enabled: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/devices/${deviceId}`, 'PATCH', { enabled: !enabled });
      refetch();
    } catch { /* logged by dashboardMutate */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Devices</h2>
            <p className="text-sm text-(--color-text-muted)">
              {list.length} registered · <span className="text-(--color-status-success)">{onlineCount} online</span>
              {offlineCount > 0 && (
                <span className="text-(--color-status-error)"> · {offlineCount} offline</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
            <Button size="sm" onClick={() => setShowAdd(!showAdd)}>+ Add Device</Button>
          </div>
        </div>

        {showAdd && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <input className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              placeholder="Device ID" aria-label="Device ID" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <input className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              placeholder="Display Name" aria-label="Display Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button size="sm" onClick={handleAdd}>Add</Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {/* Offline alert banner */}
      {offlineCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-3"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)',
            borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-(--color-status-error)">
            {offlineCount} device{offlineCount === 1 ? '' : 's'} offline — no heartbeat received in 90+ seconds
          </span>
        </div>
      )}

      {loading && list.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {list.map((d) => (
            <div key={d.deviceId} className="rounded-xl border p-5 transition"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                borderColor: deviceBorderColor(d),
                opacity: d.enabled ? 1 : 0.7,
              }}
              onMouseEnter={(e) => { if (d.enabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = deviceBorderColor(d);
              }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold font-(--font-display) text-(--color-text-primary)">{d.displayName}</span>
                {/* Pulse dot for online status */}
                {d.enabled && d.lastHeartbeatAt && (
                  <span className="relative inline-flex h-2.5 w-2.5">
                    {d.online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: 'var(--color-status-success)' }} />}
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: heartbeatColor(d) }} />
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-(--color-text-muted)">Status</span>
                  <Badge color={deviceStatusBadge(d).color} variant="light" size="sm">
                    {deviceStatusBadge(d).label}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-(--color-text-muted)">Heartbeat</span>
                  <span className="font-semibold tabular-nums" style={{ color: heartbeatColor(d) }}>
                    {formatHeartbeat(d.secondsSinceHeartbeat)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-(--color-text-muted)">ID</span>
                  <span className="font-mono text-[10px] text-(--color-text-secondary)">{d.deviceId}</span>
                </div>
                {d.lastLaneId && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-(--color-text-muted)">Lane</span>
                    <span className="font-mono text-[10px] text-(--color-text-secondary)">{d.lastLaneId}</span>
                  </div>
                )}
              </div>
              <div className="mt-3">
                <Button size="sm" variant={d.enabled ? 'ghost' : 'primary'} className="w-full"
                  onClick={() => handleToggle(d.deviceId, d.enabled)}>
                  {d.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="col-span-3 rounded-xl border p-8 text-center border-(--color-border-default)">
              <p className="text-sm text-(--color-text-muted)">No devices registered</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
