import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/**
 * InventoryPanel — Room & locker availability grid.
 * Wraps InventoryDrawer from original — will be migrated as a full tree view.
 */
export function InventoryPanel() {
  const rooms = [
    { number: '101', type: 'Standard', status: 'available' },
    { number: '102', type: 'Standard', status: 'occupied' },
    { number: '103', type: 'Double', status: 'available' },
    { number: '201', type: 'Special', status: 'cleaning' },
    { number: '202', type: 'Double', status: 'occupied' },
    { number: '203', type: 'Standard', status: 'available' },
    { number: 'L01', type: 'Locker', status: 'available' },
    { number: 'L02', type: 'Locker', status: 'occupied' },
    { number: 'L03', type: 'Gym Locker', status: 'available' },
  ];

  const statusColor: Record<string, string> = {
    available: 'var(--color-status-success)',
    occupied: 'var(--color-status-error)',
    cleaning: 'var(--color-status-warning)',
  };

  return (
    <PanelShell align="top" scroll="hidden">
      <PanelHeader title="Inventory" subtitle="Room & locker availability" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {rooms.map((r) => (
          <button key={r.number} className="flex flex-col items-center gap-1 rounded-lg border p-3 transition"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = statusColor[r.status]; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; }}
          >
            <span className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              {r.number}
            </span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{r.type}</span>
            <span className="mt-0.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: statusColor[r.status] }} />
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {Object.entries(statusColor).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {label.charAt(0).toUpperCase() + label.slice(1)}
          </span>
        ))}
      </div>
    </PanelShell>
  );
}
