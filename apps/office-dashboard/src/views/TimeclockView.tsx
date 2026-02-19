import { Badge, Button } from '@the-clubs/ui';

interface ClockEntry {
  id: string;
  employee: string;
  clockIn: string;
  clockOut: string | null;
  hours: string;
  status: 'active' | 'closed';
}

const MOCK_ENTRIES: ClockEntry[] = [
  { id: 't1', employee: 'Sarah Johnson', clockIn: '9:00 AM', clockOut: null, hours: '4h 52m', status: 'active' },
  { id: 't2', employee: 'Mike Torres', clockIn: '10:00 AM', clockOut: null, hours: '3h 52m', status: 'active' },
  { id: 't3', employee: 'Lisa Kim', clockIn: '8:00 AM', clockOut: '4:00 PM', hours: '8h 0m', status: 'closed' },
  { id: 't4', employee: 'Tom Brown', clockIn: '6:00 AM', clockOut: '2:00 PM', hours: '8h 0m', status: 'closed' },
];

export function TimeclockView() {
  const activeCount = MOCK_ENTRIES.filter((e) => e.status === 'active').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Timeclock</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{activeCount} currently clocked in</p>
          </div>
          <Button size="sm" variant="outline">Export</Button>
        </div>
      </div>

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
            {MOCK_ENTRIES.map((e) => (
              <tr key={e.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{e.employee}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{e.clockIn}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: e.clockOut ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>{e.clockOut ?? '—'}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{e.hours}</td>
                <td className="px-4 py-3">
                  <Badge color={e.status === 'active' ? 'success' : 'gray'} variant="light" size="sm">{e.status === 'active' ? 'Clocked In' : 'Closed'}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {e.status === 'active' && <Button size="sm" variant="primary">Clock Out</Button>}
                    <Button size="sm" variant="ghost">Edit</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
