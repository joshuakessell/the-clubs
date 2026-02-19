import { Badge } from '@the-clubs/ui';

const LOGS = [
  { time: '1:50 PM', user: 'Sarah J.', action: 'Check-in completed', target: 'John Smith', level: 'info' },
  { time: '1:48 PM', user: 'System', action: 'Room assigned', target: 'Room 204 → John Smith', level: 'info' },
  { time: '1:45 PM', user: 'Mike T.', action: 'Agreement signed', target: 'Jane Doe', level: 'info' },
  { time: '1:40 PM', user: 'System', action: 'Past-due blocked', target: 'Mike Wilson', level: 'warning' },
  { time: '1:35 PM', user: 'Admin', action: 'Staff PIN reset', target: 'Employee #3', level: 'admin' },
  { time: '1:30 PM', user: 'System', action: 'Inventory low', target: 'Special rooms (2 left)', level: 'warning' },
  { time: '1:25 PM', user: 'Sarah J.', action: 'Manual checkout', target: 'Room 101', level: 'info' },
];

const LEVEL_COLOR: Record<string, 'primary' | 'warning' | 'gray'> = {
  info: 'primary',
  warning: 'warning',
  admin: 'gray',
};

export function LogsView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Activity Log</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Recent system and staff activity</p>
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
              {['Time', 'User', 'Action', 'Target', 'Level'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LOGS.map((log, i) => (
              <tr key={i} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{log.time}</td>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{log.user}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-primary)' }}>{log.action}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-accent-primary)' }}>{log.target}</td>
                <td className="px-4 py-3"><Badge color={LEVEL_COLOR[log.level]} variant="light" size="sm">{log.level}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
