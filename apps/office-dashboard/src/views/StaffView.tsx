import { useState } from 'react';
import { Badge, Button } from '@the-clubs/ui';

interface StaffMember {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  active: boolean;
  lastLogin: string;
}

const MOCK_STAFF: StaffMember[] = [
  { id: 's1', name: 'Sarah Johnson', role: 'STAFF', active: true, lastLogin: '2/19/2026 1:30 PM' },
  { id: 's2', name: 'Mike Torres', role: 'STAFF', active: true, lastLogin: '2/19/2026 12:00 PM' },
  { id: 's3', name: 'Lisa Kim', role: 'ADMIN', active: true, lastLogin: '2/19/2026 9:00 AM' },
  { id: 's4', name: 'Tom Brown', role: 'STAFF', active: false, lastLogin: '2/10/2026 5:00 PM' },
];

export function StaffView() {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Staff Management</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{MOCK_STAFF.length} staff members</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add Staff</Button>
        </div>

        {showCreate && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <input className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              placeholder="Name" />
            <select className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}>
              <option>STAFF</option>
              <option>ADMIN</option>
            </select>
            <Button size="sm">Create</Button>
          </div>
        )}
      </div>

      {/* Staff table */}
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
              {['Name', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_STAFF.map((s) => (
              <tr key={s.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.name}</td>
                <td className="px-4 py-3"><Badge color={s.role === 'ADMIN' ? 'primary' : 'gray'} variant="light" size="sm">{s.role}</Badge></td>
                <td className="px-4 py-3"><Badge color={s.active ? 'success' : 'error'} variant="light" size="sm">{s.active ? 'Active' : 'Inactive'}</Badge></td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{s.lastLogin}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">Reset PIN</Button>
                    <Button size="sm" variant="ghost">{s.active ? 'Disable' : 'Enable'}</Button>
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
