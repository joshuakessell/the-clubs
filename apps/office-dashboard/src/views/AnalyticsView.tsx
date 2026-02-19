const METRICS = [
  { label: 'Check-ins Today', value: 47 },
  { label: 'Checkouts Today', value: 31 },
  { label: 'Revenue Today', value: '$2,610' },
  { label: 'Avg Session (min)', value: 94 },
];

const HOURLY = [
  { hour: '9 AM', checkins: 3 },
  { hour: '10 AM', checkins: 8 },
  { hour: '11 AM', checkins: 12 },
  { hour: '12 PM', checkins: 7 },
  { hour: '1 PM', checkins: 10 },
  { hour: '2 PM', checkins: 5 },
  { hour: '3 PM', checkins: 2 },
];

const maxCheckins = Math.max(...HOURLY.map((h) => h.checkins));

export function AnalyticsView() {
  return (
    <div className="flex flex-col gap-6">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{m.label}</p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Hourly bar chart */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Check-in Activity
        </h2>
        <div className="mt-6 flex items-end gap-3" style={{ height: 180 }}>
          {HOURLY.map((h) => {
            const pct = maxCheckins > 0 ? (h.checkins / maxCheckins) * 100 : 0;
            return (
              <div key={h.hour} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{h.checkins}</span>
                <div className="w-full rounded-t-md transition-all duration-500"
                  style={{ height: `${pct}%`, minHeight: 4, backgroundColor: 'var(--color-accent-primary)', opacity: 0.7 }} />
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{h.hour}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
