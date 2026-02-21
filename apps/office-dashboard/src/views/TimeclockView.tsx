import { useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';

interface ClockEntry {
  id: string;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  totalMinutes: number;
  status: 'active' | 'closed';
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export function TimeclockView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ entries: ClockEntry[] }>(
    '/api/v1/admin/timeclock',
  );
  const raw = data?.entries;
  const entries: ClockEntry[] = Array.isArray(raw) ? raw : [];
  const activeCount = entries.filter((e) => e.status === 'active').length;

  const handleClockOut = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/timeclock/${id}/close`, 'POST');
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Timeclock</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{activeCount} currently clocked in</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Employee', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{e.staffName}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                    {new Date(e.clockIn).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: e.clockOut ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                    {e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
                    {formatDuration(e.totalMinutes)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={e.status === 'active' ? 'success' : 'gray'} variant="light" size="sm">{e.status === 'active' ? 'Clocked In' : 'Closed'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {e.status === 'active' && <Button size="sm" variant="primary" onClick={() => handleClockOut(e.id)}>Clock Out</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No timeclock entries
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
