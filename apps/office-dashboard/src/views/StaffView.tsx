import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface StaffMember {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  active: boolean;
  lastLogin: string | null;
  forcePinChange: boolean;
}

export function StaffView() {
  const [showInactive, setShowInactive] = useState(false);
  const activeFilter = showInactive ? '' : '?active=true';
  const { data, loading, error, refetch } = useDashboardFetch<{ staff: StaffMember[] }>(
    `/api/v1/admin/staff${activeFilter}`,
  );
  const staff = data?.staff ?? [];

  /* ── Create form state ── */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'STAFF' | 'ADMIN'>('STAFF');

  /* ── Edit state ── */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'STAFF' | 'ADMIN'>('STAFF');

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
      const result = await dashboardMutate<{ name?: string }>(`/api/v1/admin/staff/${id}/pin-reset`, 'POST', {});
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

  const handleForcePinChange = useCallback(async (id: string, current: boolean) => {
    try {
      await dashboardMutate(`/api/v1/admin/staff/${id}`, 'PATCH', { forcePinChange: !current });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const startEdit = (s: StaffMember) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditRole(s.role);
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName) return;
    try {
      await dashboardMutate(`/api/v1/admin/staff/${editingId}`, 'PATCH', { name: editName, role: editRole });
      setEditingId(null);
      refetch();
    } catch { /* ignore */ }
  }, [editingId, editName, editRole, refetch]);

  return (
    <div className="flex flex-col gap-6">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-1/2 z-[10000] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-8 py-5 text-center text-sm font-medium shadow-2xl"
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            borderColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-primary)',
            maxWidth: '480px',
            boxShadow: '0 0 60px rgba(0,0,0,0.3)',
          }}
        >
          <div className="mb-2 text-base font-bold text-(--color-accent-primary)">
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
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Staff Management</h2>
            <p className="text-sm text-(--color-text-muted)">{staff.length} staff members</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={showInactive ? 'primary' : 'outline'} onClick={() => setShowInactive(!showInactive)}>
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add Staff</Button>
          </div>
        </div>

        {showCreate && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-input)' }}>
            <input className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              placeholder="Name" aria-label="Staff member name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              aria-label="Staff role"
              value={newRole} onChange={(e) => setNewRole(e.target.value as 'STAFF' | 'ADMIN')}>
              <option value="STAFF">STAFF</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <Button size="sm" onClick={handleCreate}>Create</Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && staff.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Name', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3">
                    {editingId === s.id ? (
                      <input className="w-full rounded border px-2 py-1 text-sm"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }} />
                    ) : (
                      <span className="text-sm font-semibold text-(--color-text-primary)">{s.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === s.id ? (
                      <select className="rounded border px-2 py-1 text-sm"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        value={editRole} onChange={(e) => setEditRole(e.target.value as 'STAFF' | 'ADMIN')}>
                        <option value="STAFF">STAFF</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    ) : (
                      <Badge color={s.role === 'ADMIN' ? 'primary' : 'gray'} variant="light" size="sm">{s.role}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Badge color={s.active ? 'success' : 'error'} variant="light" size="sm">{s.active ? 'Active' : 'Inactive'}</Badge>
                      {s.forcePinChange && <Badge color="warning" variant="light" size="sm">PIN Change Required</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">
                    {s.lastLogin ? new Date(s.lastLogin).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {editingId === s.id ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => void handleSaveEdit()}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startEdit(s)}>Edit</Button>
                          <Button size="sm" variant="outline" onClick={() => handlePinReset(s.id)}>Reset PIN</Button>
                          <Button size="sm" variant={s.forcePinChange ? 'primary' : 'outline'}
                            onClick={() => handleForcePinChange(s.id, s.forcePinChange)}>
                            {s.forcePinChange ? '✓ Clear PIN Flag' : 'Force PIN Change'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggle(s.id, s.active)}>{s.active ? 'Disable' : 'Enable'}</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                    No staff members
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* RBAC Audit — Role Permissions Reference */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
          🔑 Role Permissions
        </h3>
        <div className="mt-3 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-overlay)' }}>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-(--color-text-muted)">Permission</th>
                <th className="px-4 py-2 text-center text-xs font-semibold uppercase text-(--color-text-muted)">Admin</th>
                <th className="px-4 py-2 text-center text-xs font-semibold uppercase text-(--color-text-muted)">Staff</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Dashboard & Analytics', true, false],
                ['Manage Staff', true, false],
                ['Room & Locker Management', true, false],
                ['Manage Devices', true, false],
                ['Manage Products', true, false],
                ['View Reports & Z-Report', true, false],
                ['Manage Schedule & Shifts', true, false],
                ['Approve Time-Off Requests', true, false],
                ['Customer CRM & Notes', true, false],
                ['Check-in / Check-out', true, true],
                ['Cash Register Operations', true, true],
                ['View Own Schedule', true, true],
                ['Request Time Off', true, true],
                ['Timeclock (Clock In/Out)', true, true],
              ].map(([perm, admin, staff]) => (
                <tr key={String(perm)} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="px-4 py-2 text-xs font-medium text-(--color-text-primary)">{String(perm)}</td>
                  <td className="px-4 py-2 text-center text-xs">{admin ? '✅' : '—'}</td>
                  <td className="px-4 py-2 text-center text-xs">{staff ? '✅' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
