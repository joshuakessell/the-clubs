import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';

interface StaffMember {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  active: boolean;
  lastLogin: string | null;
}

export function StaffView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ staff: StaffMember[] }>(
    '/api/v1/admin/staff',
  );
  const staff = data?.staff ?? [];

  /* ── Create form state ── */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'STAFF' | 'ADMIN'>('STAFF');

  /* ── Toast state ── */
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 6000);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName) return;
    try {
      await dashboardMutate('/api/v1/admin/staff', 'POST', { name: newName, role: newRole });
      setNewName('');
      setShowCreate(false);
      refetch();
    } catch { /* ignore */ }
  }, [newName, newRole, refetch]);

  const handlePinReset = useCallback(async (id: string) => {
    try {
      const result = await dashboardMutate(`/api/v1/admin/staff/${id}/pin-reset`, 'POST', {}) as any;
      const name = result?.name || 'Staff member';
      showToast(
        `${name}'s PIN has been reset to 000000. They will be prompted to change it upon signing in for the first time.`
      );
    } catch { /* ignore */ }
  }, [showToast]);

  const handleToggle = useCallback(async (id: string, active: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/staff/${id}`, 'PATCH', { active: !active });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      {/* Toast notification */}
      {toast && (
        <div
          className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-8 py-5 text-center text-sm font-medium shadow-2xl"
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            borderColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-primary)',
            maxWidth: '480px',
            boxShadow: '0 0 60px rgba(0,0,0,0.3)',
          }}
        >
          <div className="mb-2 text-base font-bold" style={{ color: 'var(--color-accent-primary)' }}>
            PIN Reset
          </div>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Staff Management</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{staff.length} staff members</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add Staff</Button>
        </div>

        {showCreate && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <input className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={newRole} onChange={(e) => setNewRole(e.target.value as 'STAFF' | 'ADMIN')}>
              <option value="STAFF">STAFF</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <Button size="sm" onClick={handleCreate}>Create</Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && staff.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
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
              {staff.map((s) => (
                <tr key={s.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.name}</td>
                  <td className="px-4 py-3"><Badge color={s.role === 'ADMIN' ? 'primary' : 'gray'} variant="light" size="sm">{s.role}</Badge></td>
                  <td className="px-4 py-3"><Badge color={s.active ? 'success' : 'error'} variant="light" size="sm">{s.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {s.lastLogin ? new Date(s.lastLogin).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handlePinReset(s.id)}>Reset PIN</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleToggle(s.id, s.active)}>{s.active ? 'Disable' : 'Enable'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No staff members
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
