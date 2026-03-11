import { useNavigate } from 'react-router-dom';
import { Badge } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';

interface Kpi {
  roomsOccupied: number;
  roomsUnoccupied: number;
  roomsDirty: number;
  roomsCleaning: number;
  roomsClean: number;
  lockersOccupied: number;
  lockersAvailable: number;
  waitingListCount: number;
  todayRevenue: number;
  activeSessionCount: number;
  overdueCount: number;
}

const QUICK_LINKS = [
  { label: 'Lane Monitor', desc: 'Live register + room occupancy', path: '/monitor', icon: '📡' },
  { label: 'Late Alerts', desc: 'Overdue guests & ban management', path: '/late-alerts', icon: '🚨' },
  { label: 'Waitlist', desc: 'Active / offered entries', path: '/waitlist', icon: '📋' },
  { label: 'Customer Tools', desc: 'Search customers, waive past-due', path: '/customers', icon: '👥' },
  { label: 'Reports', desc: 'Inventory summary, cash totals', path: '/reports', icon: '📊' },
  { label: 'Analytics', desc: 'Activity trends & charts', path: '/analytics', icon: '📈' },
];

export function OverviewView() {
  const navigate = useNavigate();
  const { data: kpi, loading, error } = useDashboardFetch<Kpi>('/api/v1/admin/kpi');

  const totalRooms = kpi ? kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty + kpi.roomsOccupied : 0;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {/* Primary KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Today's Revenue" value={loading ? '—' : `$${(kpi?.todayRevenue ?? 0).toFixed(2)}`} color="var(--color-status-success)" large />
        <KpiCard label="Active Sessions" value={loading ? '—' : kpi?.activeSessionCount ?? 0} color="var(--color-accent-primary)" large />
        <KpiCard label="Overdue Guests" value={loading ? '—' : kpi?.overdueCount ?? 0}
          color={kpi?.overdueCount ? 'var(--color-status-error)' : 'var(--color-text-muted)'} large />
      </div>

      {/* Secondary KPI row */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard label="Total Rooms" value={loading ? '—' : totalRooms} color="var(--color-text-primary)" />
        <KpiCard label="Available" value={loading ? '—' : kpi?.roomsClean ?? 0} color="var(--color-status-success)" />
        <KpiCard label="Cleaning" value={loading ? '—' : kpi?.roomsCleaning ?? 0} color="var(--color-status-warning)" />
        <KpiCard label="Lockers In Use" value={loading ? '—' : kpi?.lockersOccupied ?? 0} color="var(--color-text-secondary)" />
        <KpiCard label="Waitlist" value={loading ? '—' : kpi?.waitingListCount ?? 0} color="var(--color-accent-primary)" />
      </div>

      {/* Critical alerts */}
      {kpi && kpi.overdueCount > 0 && (
        <button type="button" className="flex items-center gap-3 rounded-xl border px-5 py-3 text-left transition"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)',
            borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)',
          }}
          onClick={() => navigate('/late-alerts')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-status-error)' }}>
            {kpi.overdueCount} guest{kpi.overdueCount === 1 ? '' : 's'} overdue — click to view
          </span>
          <Badge color="error" variant="light" size="sm">Action Required</Badge>
        </button>
      )}

      {kpi && kpi.roomsClean <= 3 && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-3"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)',
            borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-warning)' }}>
            Low room availability — only {kpi.roomsClean} clean room{kpi.roomsClean === 1 ? '' : 's'} remaining
          </span>
        </div>
      )}

      {kpi && kpi.lockersAvailable <= 3 && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-3"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)',
            borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)',
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-status-warning)' }}>
            Low locker availability — only {kpi.lockersAvailable} locker{kpi.lockersAvailable === 1 ? '' : 's'} remaining
          </span>
        </div>
      )}

      {/* Quick links grid */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Quick Access</h2>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {QUICK_LINKS.map((link) => (
            <button key={link.path} type="button" className="flex items-center gap-3 rounded-lg border p-4 text-left transition"
              style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; }}
              onClick={() => navigate(link.path)}>
              <span className="text-xl">{link.icon}</span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{link.label}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{link.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── KPI Card ──────────────────────────────────────────────────── */

function KpiCard({ label, value, color, large }: Readonly<{ label: string; value: string | number; color: string; large?: boolean }>) {
  return (
    <div className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className={`mt-2 font-extrabold tabular-nums ${large ? 'text-3xl' : 'text-2xl'}`}
        style={{ fontFamily: 'var(--font-display)', color }}>{value}</p>
    </div>
  );
}
