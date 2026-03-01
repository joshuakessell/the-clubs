import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface DailySummary {
  totalCheckins: number;
  totalCheckouts: number;
  totalRevenue: number;
  avgSessionMinutes: number;
  hourlyCheckins: { hour: string; count: number }[];
}

export function AnalyticsView() {
  const { data, loading, error } = useDashboardFetch<DailySummary>(
    '/api/v1/admin/reports/daily-summary',
  );

  const metrics = [
    { label: 'Check-ins Today', value: data?.totalCheckins ?? 0 },
    { label: 'Checkouts Today', value: data?.totalCheckouts ?? 0 },
    { label: 'Revenue Today', value: data ? `$${data.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '$0' },
    { label: 'Avg Session (min)', value: data?.avgSessionMinutes ?? 0 },
  ];

  const hourly = data?.hourlyCheckins ?? [];
  const maxCheckins = Math.max(...hourly.map((h) => h.count), 1);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{m.label}</p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}>
              {loading ? '—' : m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Hourly bar chart */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Check-in Activity
        </h2>
        {loading ? (
          <ViewSpinner />
        ) : hourly.length === 0 ? (
          <p className="mt-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No hourly data available</p>
        ) : (
          <div className="mt-6 flex items-end gap-3" style={{ height: 180 }}>
            {hourly.map((h) => {
              const pct = maxCheckins > 0 ? (h.count / maxCheckins) * 100 : 0;
              return (
                <div key={h.hour} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{h.count}</span>
                  <div className="w-full rounded-t-md transition-all duration-500"
                    style={{ height: `${pct}%`, minHeight: 4, backgroundColor: 'var(--color-accent-primary)', opacity: 0.7 }} />
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{h.hour}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
