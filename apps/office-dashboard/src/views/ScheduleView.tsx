import { Badge } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface WeeklySummaryEntry {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  shiftCount: number;
  netHours: number;
  overtimeFlag: boolean;
}

/** Compute the Monday of the current week in YYYY-MM-DD. */
function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();          // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;  // offset to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

const weekStart = currentWeekStart();

export function ScheduleView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ summary: WeeklySummaryEntry[] }>(
    `/api/v1/admin/shifts/weekly-summary?weekStart=${weekStart}`,
  );
  const raw = data?.summary;
  const summary: WeeklySummaryEntry[] = Array.isArray(raw) ? raw : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Weekly Schedule</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Week of {new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
            onClick={() => refetch()}>Refresh</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && summary.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Employee', 'Shifts', 'Total Hours', 'Net Hours', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.employeeId} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.employeeName}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.shiftCount}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{s.totalHours.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.netHours.toFixed(1)}h</td>
                  <td className="px-4 py-3">
                    <Badge color={s.overtimeFlag ? 'warning' : 'success'} variant="light" size="sm">
                      {s.overtimeFlag ? 'Overtime' : 'Normal'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No shifts scheduled this week
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
