import { useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface Alert {
  id: string;
  customerName: string;
  roomNumber: string | null;
  type: string;
  overdueMinutes: number;
  status: string;
}

export function LateAlertsView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ alerts: Alert[] }>(
    '/api/v1/admin/late-checkout-ban-alerts',
  );
  const alerts = data?.alerts ?? [];

  const handleDecide = useCallback(async (id: string, decision: 'RESOLVE' | 'ESCALATE') => {
    try {
      await dashboardMutate(`/api/v1/admin/late-checkout-ban-alerts/${id}/decide`, 'POST', { decision });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Late Checkout & Ban Alerts</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{alerts.length} active alerts</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && alerts.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border p-4"
              style={{
                backgroundColor: a.status === 'ESCALATED' ? 'color-mix(in oklch, var(--color-status-error) 6%, transparent)' : 'var(--color-surface-raised)',
                borderColor: a.status === 'ESCALATED' ? 'color-mix(in oklch, var(--color-status-error) 20%, transparent)' : 'var(--color-border-default)',
              }}>
              <div className="flex items-center gap-4">
                <span className="text-base font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                  {a.roomNumber ?? '—'}
                </span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{a.customerName}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {a.type}{a.overdueMinutes > 0 ? ` — ${a.overdueMinutes} min overdue` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge color={a.status === 'ESCALATED' ? 'error' : 'warning'} variant="light" size="sm">{a.status}</Badge>
                <Button size="sm" variant={a.status === 'ESCALATED' ? 'danger' : 'primary'}
                  onClick={() => handleDecide(a.id, a.status === 'ESCALATED' ? 'RESOLVE' : 'ESCALATE')}>
                  {a.status === 'ESCALATED' ? 'Resolve' : 'Escalate'}
                </Button>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No active alerts</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
