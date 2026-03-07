import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface Device {
  deviceId: string;
  displayName: string;
  enabled: boolean;
}

export function DevicesView() {
  const { data: devices, loading, error, refetch } = useDashboardFetch<Device[]>(
    '/api/v1/admin/devices',
  );
  const list = devices ?? [];

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
    } catch { /* ignore */ }
  }, [newId, newName, refetch]);

  const handleToggle = useCallback(async (deviceId: string, enabled: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/devices/${deviceId}`, 'PATCH', { enabled: !enabled });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Devices</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{list.length} registered devices</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}>+ Add Device</Button>
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
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
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
                borderColor: d.enabled ? 'var(--color-border-default)' : 'rgba(239, 68, 68, 0.2)',
                opacity: d.enabled ? 1 : 0.7,
              }}
              onMouseEnter={(e) => { if (d.enabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = d.enabled ? 'var(--color-border-default)' : 'rgba(239, 68, 68, 0.2)'; }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{d.displayName}</span>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--color-text-muted)' }}>Status</span>
                  <Badge color={d.enabled ? 'success' : 'error'} variant="light" size="sm">{d.enabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--color-text-muted)' }}>ID</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{d.deviceId}</span>
                </div>
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
            <div className="col-span-3 rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No devices registered</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
