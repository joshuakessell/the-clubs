import { Badge } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';

interface ClubEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  eventDomain: string;
  sourceApp: string;
  staffName: string | null;
  customerName: string | null;
  summary: string;
}

const DOMAIN_COLOR: Record<string, 'primary' | 'warning' | 'gray' | 'success'> = {
  CHECKIN: 'primary',
  CHECKOUT: 'success',
  SALE: 'warning',
  ADMIN: 'gray',
  SYSTEM: 'gray',
};

export function LogsView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ events: ClubEvent[] }>(
    '/api/v1/admin/club-log?limit=50',
  );
  const events = data?.events ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Activity Log</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Recent system and staff activity</p>
          </div>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
            onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Time', 'Staff', 'Summary', 'Domain', 'Type'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(ev.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{ev.staffName ?? 'System'}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-primary)' }}>{ev.summary}</td>
                  <td className="px-4 py-3">
                    <Badge color={DOMAIN_COLOR[ev.eventDomain] ?? 'gray'} variant="light" size="sm">{ev.eventDomain}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>{ev.eventType}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No log entries
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
