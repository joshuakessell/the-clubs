import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';

interface Customer {
  id: string;
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  pastDue: boolean;
  lastVisit: string | null;
}

export function CustomersView() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, loading, error, refetch } = useDashboardFetch<{ customers: Customer[] }>(
    query ? `/api/v1/admin/customers?q=${encodeURIComponent(query)}` : null,
    { skip: !query },
  );
  const customers = data?.customers ?? [];

  const handleSearch = useCallback(() => {
    setQuery(search);
  }, [search]);

  const handleWaive = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/customers/${id}`, 'PATCH', { pastDue: false });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Customer Admin</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <Button size="sm" onClick={handleSearch}>Search</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {!query ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-border-default)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Enter a name to search for customers</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
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
              {customers.map((c) => (
                <tr key={c.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-accent-primary)' }}>{c.name}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{c.dob ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--color-text-secondary)' }}>{c.membershipNumber ?? '—'}</td>
                  <td className="px-4 py-3"><Badge color={c.pastDue ? 'error' : 'success'} variant="light" size="sm">{c.pastDue ? 'Past Due' : 'Active'}</Badge></td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    {c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {c.pastDue && <Button size="sm" variant="primary" onClick={() => handleWaive(c.id)}>Waive</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No customers found
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
