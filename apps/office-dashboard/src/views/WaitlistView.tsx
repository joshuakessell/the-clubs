import { useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface WaitlistEntry {
  id: string;
  customerId: string;
  customerName: string;
  desiredRentalType: string;
  backupRentalType: string | null;
  status: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, 'warning' | 'primary' | 'success' | 'gray'> = {
  ACTIVE: 'warning',
  OFFERED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'gray',
};

export function WaitlistView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ entries: WaitlistEntry[] }>(
    '/api/v1/waitlist',
  );
  const entries = data?.entries ?? [];

  const handleOffer = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/waitlist/${id}/offer`, 'POST');
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const handleComplete = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/waitlist/${id}/complete`, 'POST');
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const handleCancel = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/waitlist/${id}/cancel`, 'POST');
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Waitlist Management</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{entries.length} entries</p>
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
        <ViewSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Customer', 'Desired', 'Backup', 'Status', 'Created', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b transition"
                  style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{e.customerName}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{e.desiredRentalType}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{e.backupRentalType ?? '—'}</td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLOR[e.status] ?? 'gray'} variant="light" size="sm">{e.status}</Badge></td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(e.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {e.status === 'ACTIVE' && <Button size="sm" variant="primary" onClick={() => handleOffer(e.id)}>Offer</Button>}
                      {e.status === 'OFFERED' && <Button size="sm" variant="primary" onClick={() => handleComplete(e.id)}>Complete</Button>}
                      {(e.status === 'ACTIVE' || e.status === 'OFFERED') && (
                        <Button size="sm" variant="ghost" onClick={() => handleCancel(e.id)}>Cancel</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No waitlist entries
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
