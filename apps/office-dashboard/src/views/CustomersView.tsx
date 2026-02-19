import { useState } from 'react';
import { Badge, Button } from '@the-clubs/ui';

const MOCK_CUSTOMERS = [
  { id: 'c1', name: 'John Smith', dob: '1990-05-12', membership: 'M-1001', status: 'ACTIVE', lastVisit: '2/19/2026' },
  { id: 'c2', name: 'Jane Doe', dob: '1988-11-23', membership: 'M-1002', status: 'ACTIVE', lastVisit: '2/18/2026' },
  { id: 'c3', name: 'Mike Wilson', dob: '1995-03-04', membership: null, status: 'PAST_DUE', lastVisit: '2/10/2026' },
  { id: 'c4', name: 'Sarah Connor', dob: '1985-07-30', membership: 'M-1003', status: 'ACTIVE', lastVisit: '2/19/2026' },
];

export function CustomersView() {
  const [search, setSearch] = useState('');
  const filtered = MOCK_CUSTOMERS.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Customer Admin</h2>
        <input
          className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
              {['Name', 'DOB', 'Membership', 'Status', 'Last Visit', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-accent-primary)' }}>{c.name}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{c.dob}</td>
                <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text-secondary)' }}>{c.membership ?? '—'}</td>
                <td className="px-4 py-3"><Badge color={c.status === 'ACTIVE' ? 'success' : 'error'} variant="light" size="sm">{c.status === 'PAST_DUE' ? 'Past Due' : 'Active'}</Badge></td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{c.lastVisit}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">View</Button>
                    {c.status === 'PAST_DUE' && <Button size="sm" variant="primary">Waive</Button>}
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
