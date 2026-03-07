import { useNavigate } from 'react-router-dom';
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
}

const QUICK_LINKS = [
  { label: 'Lane Monitor', desc: 'Live register + customer session status', path: '/monitor' },
  { label: 'Waitlist', desc: 'Active / offered entries, offer upgrades', path: '/waitlist' },
  { label: 'Customer Tools', desc: 'Search customers, waive past-due', path: '/customers' },
  { label: 'Reports', desc: 'Inventory summary, cash totals', path: '/reports' },
  { label: 'Products', desc: 'Manage retail catalog + pricing', path: '/products' },
  { label: 'Analytics', desc: 'Activity trends & charts', path: '/analytics' },
];

export function OverviewView() {
  const navigate = useNavigate();
  const { data: kpi, loading, error } = useDashboardFetch<Kpi>('/api/v1/admin/kpi');

  const totalRooms = kpi ? kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty + kpi.roomsOccupied : 0;
  const available = kpi ? kpi.roomsClean : 0;
  const cleaning = kpi ? kpi.roomsCleaning : 0;
  const waitlist = kpi ? kpi.waitingListCount : 0;

  const STATS = [
    { label: 'Total Rooms', value: totalRooms, color: 'var(--color-text-primary)' },
    { label: 'Available', value: available, color: 'var(--color-status-success)' },
    { label: 'Cleaning', value: cleaning, color: 'var(--color-status-warning)' },
    { label: 'Waitlist', value: waitlist, color: 'var(--color-accent-primary)' },
  ];

  // Compute low availability tiers from KPI
  const LOW_AVAILABILITY: { tier: string; available: number }[] = [];
  if (kpi) {
    if (kpi.lockersAvailable <= 5) LOW_AVAILABILITY.push({ tier: 'Lockers', available: kpi.lockersAvailable });
    if (kpi.roomsClean <= 5) LOW_AVAILABILITY.push({ tier: 'Rooms', available: kpi.roomsClean });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: s.color }}>
              {loading ? '—' : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Quick links grid */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Quick Access</h2>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {QUICK_LINKS.map((link) => (
            <button key={link.path} className="flex flex-col gap-1 rounded-lg border p-4 text-left transition"
              style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; }}
              onClick={() => navigate(link.path)}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{link.label}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{link.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Low availability */}
      {LOW_AVAILABILITY.length > 0 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Low Availability</h2>
          <div className="mt-3 flex flex-col gap-2">
            {LOW_AVAILABILITY.map((r) => (
              <div key={r.tier} className="flex items-center justify-between rounded-lg border px-4 py-3"
                style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.tier}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-warning)' }}>{r.available} available</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
