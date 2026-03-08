import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface BannedCustomer {
  id: string;
  customerName: string;
  membershipNumber: string | null;
  bannedUntil: string;
}

function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatBanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LateAlertsView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ alerts: BannedCustomer[] }>(
    '/api/v1/admin/late-checkout-ban-alerts',
  );
  const alerts = data?.alerts ?? [];

  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleRemoveBan = useCallback(async (id: string) => {
    if (!confirm('Remove this ban? The customer will be allowed to check in immediately.')) return;
    setProcessing(true);
    try {
      await dashboardMutate(`/api/v1/admin/late-checkout-ban-alerts/${id}/remove-ban`, 'POST', {});
      refetch();
    } catch { /* ignore */ }
    setProcessing(false);
  }, [refetch]);

  const handleExtendBan = useCallback(async (id: string) => {
    if (!extendDate) return;
    setProcessing(true);
    try {
      await dashboardMutate(`/api/v1/admin/late-checkout-ban-alerts/${id}/extend-ban`, 'POST', {
        bannedUntil: new Date(extendDate + 'T23:59:59').toISOString(),
      });
      setExtendingId(null);
      setExtendDate('');
      refetch();
    } catch { /* ignore */ }
    setProcessing(false);
  }, [extendDate, refetch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Banned Customers</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{alerts.length} active ban{alerts.length === 1 ? '' : 's'}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && alerts.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((a) => {
            const days = daysUntil(a.bannedUntil);
            const isExtending = extendingId === a.id;

            return (
              <div key={a.id} className="rounded-xl border p-4"
                style={{
                  backgroundColor: 'color-mix(in oklch, var(--color-status-error) 4%, var(--color-surface-raised))',
                  borderColor: 'color-mix(in oklch, var(--color-status-error) 15%, var(--color-border-default))',
                }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Ban icon */}
                    <div className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{a.customerName}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {a.membershipNumber ? `#${a.membershipNumber} · ` : ''}
                        Banned until {formatBanDate(a.bannedUntil)}
                        <span className="font-semibold" style={{ color: 'var(--color-status-error)' }}> ({days} day{days === 1 ? '' : 's'} remaining)</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color="error" variant="light" size="sm">BANNED</Badge>
                    <Button size="sm" variant="outline" disabled={processing}
                      onClick={() => { setExtendingId(isExtending ? null : a.id); setExtendDate(''); }}>
                      {isExtending ? 'Cancel' : 'Extend'}
                    </Button>
                    <Button size="sm" variant="primary" disabled={processing}
                      onClick={() => void handleRemoveBan(a.id)}>
                      Remove Ban
                    </Button>
                  </div>
                </div>

                {/* Extend ban inline form */}
                {isExtending && (
                  <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)' }}>
                    <label htmlFor={`extend-${a.id}`} className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      New ban end date:
                    </label>
                    <input
                      id={`extend-${a.id}`}
                      type="date"
                      className="rounded-lg border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                      style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                      value={extendDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setExtendDate(e.target.value)}
                    />
                    <Button size="sm" variant="danger" disabled={!extendDate || processing}
                      onClick={() => void handleExtendBan(a.id)}>
                      Confirm
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {alerts.length === 0 && (
            <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No banned customers</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
