import { useNavigate } from 'react-router-dom';

const STATS = [
  { label: 'Total Rooms', value: 42, color: 'var(--color-text-primary)' },
  { label: 'Available', value: 28, color: 'var(--color-status-success)' },
  { label: 'Cleaning', value: 6, color: 'var(--color-status-warning)' },
  { label: 'Waitlist', value: 3, color: 'var(--color-accent-primary)' },
];

const QUICK_LINKS = [
  { label: 'Lane Monitor', desc: 'Live register + customer session status', path: '/monitor' },
  { label: 'Waitlist', desc: 'Active / offered entries, offer upgrades', path: '/waitlist' },
  { label: 'Customer Tools', desc: 'Search customers, waive past-due', path: '/customers' },
  { label: 'Reports', desc: 'Inventory summary, cash totals', path: '/reports' },
  { label: 'Products', desc: 'Manage retail catalog + pricing', path: '/products' },
  { label: 'Analytics', desc: 'Activity trends & charts', path: '/analytics' },
];

const LOW_AVAILABILITY = [
  { tier: 'Special', available: 2 },
  { tier: 'Double', available: 4 },
];

export function OverviewView() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: s.color }}>{s.value}</p>
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
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Low Availability</h2>
        <div className="mt-3 flex flex-col gap-2">
          {LOW_AVAILABILITY.map((r) => (
            <div key={r.tier} className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.06)', borderColor: 'rgba(245, 158, 11, 0.2)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.tier}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-warning)' }}>{r.available} available</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
