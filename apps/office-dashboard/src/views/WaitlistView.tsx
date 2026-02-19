import { Badge, Button } from '@the-clubs/ui';

const ENTRIES = [
  { id: 'w1', customer: 'John Smith', desired: 'Special', backup: 'Double', status: 'ACTIVE' as const, created: '1:10 PM' },
  { id: 'w2', customer: 'Jane Doe', desired: 'Double', backup: 'Standard', status: 'OFFERED' as const, created: '1:05 PM' },
  { id: 'w3', customer: 'Mike Wilson', desired: 'Special', backup: 'Double', status: 'ACTIVE' as const, created: '12:50 PM' },
];

const STATUS_COLOR: Record<string, 'warning' | 'primary' | 'success' | 'gray'> = {
  ACTIVE: 'warning',
  OFFERED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'gray',
};

export function WaitlistView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Waitlist Management</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{ENTRIES.length} entries</p>
          </div>
          <Button size="sm" variant="outline">Refresh</Button>
        </div>
      </div>

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
            {ENTRIES.map((e) => (
              <tr key={e.id} className="border-b transition"
                style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{e.customer}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{e.desired}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{e.backup}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLOR[e.status]} variant="light" size="sm">{e.status}</Badge></td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{e.created}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {e.status === 'ACTIVE' && <Button size="sm" variant="primary">Offer</Button>}
                    {e.status === 'OFFERED' && <Button size="sm" variant="primary">Complete</Button>}
                    <Button size="sm" variant="ghost">Cancel</Button>
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
