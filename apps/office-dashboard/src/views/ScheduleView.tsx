import { Badge } from '@the-clubs/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SHIFTS = [
  { employee: 'Sarah J.', role: 'STAFF', shifts: [true, true, true, true, true, false, false] },
  { employee: 'Mike T.', role: 'STAFF', shifts: [false, true, true, true, true, true, false] },
  { employee: 'Lisa K.', role: 'ADMIN', shifts: [true, true, true, false, false, true, true] },
  { employee: 'Tom B.', role: 'STAFF', shifts: [true, false, false, true, true, true, true] },
];

export function ScheduleView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Weekly Schedule</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Feb 17 – Feb 23, 2026</p>
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Employee</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Role</th>
              {DAYS.map((d) => (
                <th key={d} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((s) => (
              <tr key={s.employee} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.employee}</td>
                <td className="px-4 py-3"><Badge color={s.role === 'ADMIN' ? 'primary' : 'gray'} variant="light" size="sm">{s.role}</Badge></td>
                {s.shifts.map((on, i) => (
                  <td key={i} className="px-3 py-3 text-center">
                    <span
                      className="inline-block h-4 w-4 rounded-full"
                      style={{ backgroundColor: on ? 'var(--color-status-success)' : 'var(--color-surface-overlay)' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
