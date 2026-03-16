import { useState, useCallback } from 'react';
import { Badge, Button, useAuthStore } from '@the-clubs/ui';
import { getApiUrl } from '@the-clubs/shared';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface Customer {
  id: string;
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  membershipCardType: string | null;
  membershipValidUntil: string | null;
  pastDueBalance: number;
  lastVisit: string | null;
}

interface CheckinBlock {
  checkinBlockId: string;
  startsAt: string;
  endsAt: string;
  rentalType: string;
  resourceNumber: string | null;
  resourceKind: string | null;
  agreementSigned: boolean;
  hasPdf: boolean;
  paymentTotal: number | null;
  paymentMethod: string | null;
}

interface CustomerNote {
  id: string;
  note: string;
  isImportant: boolean;
  createdByStaffName: string;
  createdAt: string;
}

interface Visit {
  visitId: string;
  visitStartedAt: string;
  visitEndedAt: string | null;
  checkinBlocks: CheckinBlock[];
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatMembership(type: string | null, validUntil: string | null): { label: string; color: 'success' | 'warning' | 'error' } {
  if (!type || type === 'NONE') return { label: 'No Membership', color: 'error' };
  const valid = validUntil && new Date(validUntil) >= new Date();
  if (type === 'SIX_MONTH') return { label: valid ? '6-Month Active' : '6-Month Expired', color: valid ? 'success' : 'warning' };
  return { label: valid ? 'Active' : 'Expired', color: valid ? 'success' : 'warning' };
}

/* ── Customer Detail Panel ─────────────────────────────────────── */

function CustomerDetail({ customer }: Readonly<{ customer: Customer }>) {
  const { data, loading, error } = useDashboardFetch<{ visits: Visit[] }>(
    `/api/v1/admin/customers/${customer.id}/agreements`,
  );
  const visits = data?.visits ?? [];
  const membership = formatMembership(customer.membershipCardType, customer.membershipValidUntil);
  const lifetimeSpend = visits.reduce((sum, v) => sum + v.checkinBlocks.reduce((bs, b) => bs + (b.paymentTotal ?? 0), 0), 0);

  // Notes
  const { data: notesData, loading: notesLoading, refetch: refetchNotes } = useDashboardFetch<{ notes: CustomerNote[] }>(
    `/api/v1/customers/${customer.id}/notes`,
  );
  const notes = notesData?.notes ?? [];
  const [newNote, setNewNote] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  const [addingNote, setAddingNote] = useState(false);

  const handleAddNote = useCallback(async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      await dashboardMutate(`/api/v1/customers/${customer.id}/notes`, 'POST', {
        note: newNote.trim(), isImportant, sourceApp: 'OFFICE_DASHBOARD',
      });
      setNewNote(''); setIsImportant(false);
      refetchNotes();
    } catch { /* ignore */ }
    setAddingNote(false);
  }, [customer.id, newNote, isImportant, refetchNotes, setNewNote, setIsImportant]);

  const handleDownloadPdf = useCallback(async (blockId: string) => {
    const token = useAuthStore.getState().session?.sessionToken;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(getApiUrl(`/api/v1/documents/${blockId}/download`), { headers });
    if (!res.ok) {
      alert('PDF not available for this visit.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agreement-${blockId.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* Profile Card */}
      <div
        className="rounded-lg border p-4"
        style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Name
            </span>
            <p className="font-semibold text-(--color-text-primary)">{customer.name}</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Date of Birth
            </span>
            <p className="text-(--color-text-secondary)">{customer.dob ?? '—'}</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Membership #
            </span>
            <p className="font-mono text-(--color-text-secondary)">{customer.membershipNumber ?? '—'}</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Membership Status
            </span>
            <p><Badge color={membership.color} variant="light" size="sm">{membership.label}</Badge></p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Balance Due
            </span>
            <p className="font-bold tabular-nums" style={{ color: customer.pastDueBalance > 0 ? 'var(--color-status-error)' : 'var(--color-text-secondary)' }}>
              ${customer.pastDueBalance.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Last Visit
            </span>
            <p className="text-(--color-text-secondary)">{customer.lastVisit ? formatDate(customer.lastVisit) : '—'}</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
              Lifetime Spend
            </span>
            <p className="font-bold tabular-nums text-(--color-status-success)">
              ${lifetimeSpend.toFixed(2)}
            </p>
          </div>
          {customer.membershipCardType && customer.membershipCardType !== 'NONE' && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
                Card Type
              </span>
              <p><Badge color="primary" variant="light" size="sm">{customer.membershipCardType.replaceAll('_', ' ')}</Badge></p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions — Ban Toggle + ID Verification */}
      <div className="flex items-center gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-overlay)' }}>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Actions</span>
        <BanToggle customerId={customer.id} />
        <IdVerificationToggle customerId={customer.id} />
      </div>

      {/* Notes Section */}
      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Notes ({notes.length})
        </h4>

        {/* Add note form */}
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddNote(); }}
          />
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
            style={{ borderColor: isImportant ? 'var(--color-status-warning)' : 'var(--color-border-default)', color: isImportant ? 'var(--color-status-warning)' : 'var(--color-text-muted)' }}>
            <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} className="sr-only" />
            <span>⚠️ Important</span>
          </label>
          <Button size="sm" onClick={() => void handleAddNote()} disabled={addingNote || !newNote.trim()}>
            {addingNote ? 'Adding…' : 'Add'}
          </Button>
        </div>

        {(() => {
          if (notesLoading) return <div className="py-2 text-center text-sm text-(--color-text-muted)">Loading notes…</div>;
          if (notes.length === 0) return <div className="py-2 text-center text-sm text-(--color-text-muted)">No notes yet</div>;
          return (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: n.isImportant ? 'color-mix(in oklch, var(--color-status-warning) 30%, var(--color-border-default))' : 'var(--color-border-subtle)',
                    backgroundColor: n.isImportant ? 'color-mix(in oklch, var(--color-status-warning) 4%, transparent)' : 'transparent',
                  }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-(--color-text-muted)">
                      {n.createdByStaffName} · {formatDate(n.createdAt)}
                    </span>
                    {n.isImportant && <Badge color="warning" variant="light" size="sm">Important</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-(--color-text-primary)">{n.note}</p>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Visit History */}
      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-(--color-text-muted)">
          Visit History ({visits.length})
        </h4>

        {(() => {
          if (loading) {
            return <div className="py-4 text-center text-sm text-(--color-text-muted)">Loading visits…</div>;
          }
          if (error) {
            return (
              <div className="rounded-lg border px-3 py-2 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
                {error}
              </div>
            );
          }
          if (visits.length === 0) {
            return <div className="py-4 text-center text-sm text-(--color-text-muted)">No visit history</div>;
          }
          return (
            <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-overlay)' }}>
                    {['Date', 'Check-in', 'Check-out', 'Type', 'Room/Locker', 'Total', 'Agreement'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visits.map((visit) => {
                    const block = visit.checkinBlocks[0]; // Primary checkin block
                    if (!block) return null;
                    const total = visit.checkinBlocks.reduce((sum, b) => sum + (b.paymentTotal ?? 0), 0);
                    return (
                      <tr
                        key={visit.visitId}
                        className="border-b transition"
                        style={{ borderColor: 'var(--color-border-subtle)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        <td className="px-3 py-2 text-sm tabular-nums text-(--color-text-primary)">
                          {formatDate(visit.visitStartedAt)}
                        </td>
                        <td className="px-3 py-2 text-sm tabular-nums text-(--color-text-secondary)">
                          {formatTime(block.startsAt)}
                        </td>
                        <td className="px-3 py-2 text-sm tabular-nums text-(--color-text-secondary)">
                          {visit.visitEndedAt ? formatTime(visit.visitEndedAt) : '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-(--color-text-secondary)">
                          {block.rentalType}
                        </td>
                        <td className="px-3 py-2 text-sm font-mono text-(--color-text-secondary)">
                          {block.resourceNumber ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-sm font-bold tabular-nums text-(--color-accent-primary)">
                          {total > 0 ? `$${total.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {block.hasPdf ? (
                            <button
                              type="button"
                              onClick={() => void handleDownloadPdf(block.checkinBlockId)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80"
                              style={{
                                backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 8%, transparent)',
                                color: 'var(--color-accent-primary)',
                                border: '1px solid color-mix(in oklch, var(--color-accent-primary) 20%, transparent)',
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              PDF
                            </button>
                          ) : (
                            <span className="text-[10px] text-(--color-text-muted)">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ── Main View ─────────────────────────────────────────────────── */

export function CustomersView() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, loading, error, refetch } = useDashboardFetch<{ customers: Customer[] }>(
    query ? `/api/v1/admin/customers?q=${encodeURIComponent(query)}` : null,
    { skip: !query },
  );
  const customers = data?.customers ?? [];

  const handleSearch = useCallback(() => {
    setQuery(search);
    setExpandedId(null);
  }, [search]);

  const handleWaive = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/customers/${id}`, 'PATCH', { pastDueBalance: 0 });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Customer Lookup</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            placeholder="Search by name or membership #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <Button size="sm" onClick={handleSearch}>Search</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {(() => {
        if (!query) {
          return (
            <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="text-sm text-(--color-text-muted)">Enter a name or membership number to search</p>
            </div>
          );
        }
        if (loading) {
          return <ViewSpinner />;
        }
        return (
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                  {['Name', 'DOB', 'Membership #', 'Status', 'Last Visit', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const isExpanded = expandedId === c.id;
                  const membership = formatMembership(c.membershipCardType, c.membershipValidUntil);
                  return (
                    <tr key={c.id} className="group" style={{ verticalAlign: 'top' }}>
                      <td colSpan={6} className="p-0">
                        {/* Summary row */}
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center border-b text-left transition"
                          style={{ borderColor: 'var(--color-border-subtle)', background: 'none' }}
                          onClick={() => setExpandedId(isExpanded ? null : c.id)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                        >
                          <div className="flex-1 px-4 py-3 text-sm font-semibold text-(--color-accent-primary)">{c.name}</div>
                          <div className="w-[100px] px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">{c.dob ?? '—'}</div>
                          <div className="w-[120px] px-4 py-3 text-sm font-mono text-(--color-text-secondary)">{c.membershipNumber ?? '—'}</div>
                          <div className="w-[120px] px-4 py-3"><Badge color={membership.color} variant="light" size="sm">{membership.label}</Badge></div>
                          <div className="w-[110px] px-4 py-3 text-sm tabular-nums text-(--color-text-muted)">
                            {c.lastVisit ? formatDate(c.lastVisit) : '—'}
                          </div>
                          <div className="w-[110px] px-4 py-3">
                            <div className="flex items-center gap-2">
                              {c.pastDueBalance > 0 && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); void handleWaive(c.id); }}>Waive</Button>}
                              <svg
                                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </div>
                          </div>
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div
                            className="border-b px-4 py-4"
                            style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-base)' }}
                          >
                            <CustomerDetail customer={c} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                      No customers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Ban Toggle ────────────────────────────────────────────────── */

function BanToggle({ customerId }: Readonly<{ customerId: string }>) {
  const [banning, setBanning] = useState(false);

  const handleBan = useCallback(async () => {
    setBanning(true);
    const thirtyDays = new Date(Date.now() + 30 * 86_400_000).toISOString();
    try {
      await dashboardMutate(`/api/v1/admin/ban-alerts/${customerId}/extend`, 'POST', { bannedUntil: thirtyDays });
    } catch { /* ignore */ }
    setBanning(false);
  }, [customerId]);

  const handleUnban = useCallback(async () => {
    setBanning(true);
    try {
      await dashboardMutate(`/api/v1/admin/ban-alerts/${customerId}/remove`, 'DELETE');
    } catch { /* ignore */ }
    setBanning(false);
  }, [customerId]);

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" onClick={() => void handleBan()} disabled={banning}
        style={{ color: 'var(--color-status-error)' }}>
        {banning ? '…' : '🚫 Ban (30d)'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void handleUnban()} disabled={banning}
        style={{ color: 'var(--color-status-success)' }}>
        {banning ? '…' : '✅ Unban'}
      </Button>
    </div>
  );
}
/* ── ID Verification Toggle ───────────────────────────────────── */

function IdVerificationToggle({ customerId }: Readonly<{ customerId: string }>) {
  const storageKey = `id-verified:${customerId}`;
  const [verified, setVerified] = useState(() => localStorage.getItem(storageKey) === 'true');

  const toggle = useCallback(() => {
    const next = !verified;
    if (next) {
      localStorage.setItem(storageKey, 'true');
    } else {
      localStorage.removeItem(storageKey);
    }
    setVerified(next);
  }, [verified, storageKey]);

  return (
    <div className="flex items-center gap-2">
      {verified && <Badge color="success" variant="light" size="sm">🪪 ID Verified</Badge>}
      <Button size="sm" variant={verified ? 'ghost' : 'outline'} onClick={toggle}>
        {verified ? 'Unverify ID' : '🪪 Verify ID'}
      </Button>
    </div>
  );
}
