import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface OverdueAlert {
  occupancyId: string;
  visitId: string;
  customerId: string;
  customerName: string;
  resourceType: string;
  resourceNumber: string;
  checkinAt: string;
  scheduledCheckoutAt: string;
  lateMinutes: number;
  estimatedFee: number;
  banWouldApply: boolean;
}

interface BannedCustomer {
  id: string;
  customerName: string;
  membershipNumber: string | null;
  bannedUntil: string;
}

/* ── Helpers ───────────────────────────────────────────────────── */

type Tab = 'overdue' | 'bans';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatBanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function urgencyColor(lateMinutes: number): string {
  if (lateMinutes >= 90) return 'var(--color-status-error)';
  if (lateMinutes >= 60) return 'color-mix(in oklch, var(--color-status-error) 80%, var(--color-status-warning))';
  return 'var(--color-status-warning)';
}

/* ── Component ─────────────────────────────────────────────────── */

export function LateAlertsView() {
  const [tab, setTab] = useState<Tab>('overdue');

  return (
    <div className="flex flex-col gap-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border p-1.5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        {(['overdue', 'bans'] as const).map((t) => {
          const active = tab === t;
          return (
            <button key={t} type="button"
              className="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: active ? 'var(--color-accent-primary)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-secondary)',
              }}
              onClick={() => setTab(t)}>
              {t === 'overdue' ? '🚨 Overdue Alerts' : '🚫 Ban Management'}
            </button>
          );
        })}
      </div>

      {tab === 'overdue' ? <OverdueTab /> : <BanTab />}
    </div>
  );
}

/* ── Overdue Tab ───────────────────────────────────────────────── */

const POLL_MS = 30_000;

function OverdueTab() {
  const { data, loading, error, refetch } = useDashboardFetch<{ alerts: OverdueAlert[] }>(
    '/api/v1/admin/overdue-alerts',
  );
  const alerts = data?.alerts ?? [];

  // Auto-refresh every 30 seconds
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    const id = setInterval(() => void refetchRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">
              Overdue Guests
            </h2>
            <p className="text-sm text-(--color-text-muted)">
              {alerts.length} guest{alerts.length === 1 ? '' : 's'} past checkout time
            </p>
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
          {alerts.map((a) => (
            <div key={a.occupancyId} className="rounded-xl border p-4"
              style={{
                backgroundColor: `color-mix(in oklch, ${urgencyColor(a.lateMinutes)} 4%, var(--color-surface-raised))`,
                borderColor: `color-mix(in oklch, ${urgencyColor(a.lateMinutes)} 15%, var(--color-border-default))`,
              }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Timer icon */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: `color-mix(in oklch, ${urgencyColor(a.lateMinutes)} 12%, transparent)` }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={urgencyColor(a.lateMinutes)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-(--color-text-primary)">{a.customerName}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      {a.resourceType === 'ROOM' ? '🛏️' : '🔒'}{' '}
                      {a.resourceType} {a.resourceNumber} · Checked in {formatTime(a.checkinAt)} · Due {formatTime(a.scheduledCheckoutAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Late duration badge */}
                  <Badge color={a.lateMinutes >= 90 ? 'error' : 'warning'} variant="light" size="sm">
                    {formatDuration(a.lateMinutes)} late
                  </Badge>
                  {/* Fee estimate */}
                  {a.estimatedFee > 0 && (
                    <span className="text-sm font-bold tabular-nums" style={{ color: urgencyColor(a.lateMinutes) }}>
                      ${a.estimatedFee}
                    </span>
                  )}
                  {/* Ban warning */}
                  {a.banWouldApply && (
                    <Badge color="error" variant="light" size="sm">BAN</Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="rounded-xl border p-8 text-center border-(--color-border-default)">
              <p className="text-sm text-(--color-text-muted)">
                ✅ No overdue guests — all sessions are within their scheduled time
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ── Ban Management Tab ────────────────────────────────────────── */

function BanTab() {
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
    } catch { /* logged by dashboardMutate */ }
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
    } catch { /* logged by dashboardMutate */ }
    setProcessing(false);
  }, [extendDate, refetch]);

  return (
    <>
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Banned Customers</h2>
            <p className="text-sm text-(--color-text-muted)">{alerts.length} active ban{alerts.length === 1 ? '' : 's'}</p>
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
                    <div className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-(--color-text-primary)">{a.customerName}</p>
                      <p className="text-xs text-(--color-text-muted)">
                        {a.membershipNumber ? `#${a.membershipNumber} · ` : ''}
                        Banned until {formatBanDate(a.bannedUntil)}
                        <span className="font-semibold text-(--color-status-error)">{' '}({days} day{days === 1 ? '' : 's'} remaining)</span>
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

                {isExtending && (
                  <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'color-mix(in oklch, var(--color-status-error) 10%, transparent)' }}>
                    <label htmlFor={`extend-${a.id}`} className="text-xs font-semibold text-(--color-text-muted)">
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
            <div className="rounded-xl border p-8 text-center border-(--color-border-default)">
              <p className="text-sm text-(--color-text-muted)">No banned customers</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
