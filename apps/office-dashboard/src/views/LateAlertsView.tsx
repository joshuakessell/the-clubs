import { Badge, Button } from '@the-clubs/ui';

const ALERTS = [
  { id: 'a1', customer: 'Mike Wilson', room: '102', type: 'Late Checkout', overdueMin: 45, status: 'unresolved' },
  { id: 'a2', customer: 'Tom Brown', room: '205', type: 'Late Checkout', overdueMin: 15, status: 'unresolved' },
  { id: 'a3', customer: 'Lisa Chen', room: 'L04', type: 'Ban Alert', overdueMin: 0, status: 'escalated' },
];

export function LateAlertsView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Late Checkout & Ban Alerts</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{ALERTS.length} active alerts</p>
          </div>
          <Button size="sm" variant="outline">Refresh</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {ALERTS.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-xl border p-4"
            style={{
              backgroundColor: a.status === 'escalated' ? 'rgba(239, 68, 68, 0.06)' : 'var(--color-surface-raised)',
              borderColor: a.status === 'escalated' ? 'rgba(239, 68, 68, 0.2)' : 'var(--color-border-default)',
            }}>
            <div className="flex items-center gap-4">
              <span className="text-base font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{a.room}</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{a.customer}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {a.type}{a.overdueMin > 0 ? ` — ${a.overdueMin} min overdue` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge color={a.status === 'escalated' ? 'error' : 'warning'} variant="light" size="sm">{a.status}</Badge>
              <Button size="sm" variant={a.status === 'escalated' ? 'danger' : 'primary'}>
                {a.status === 'escalated' ? 'Review' : 'Resolve'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
