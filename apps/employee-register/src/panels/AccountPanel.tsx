import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/**
 * AccountPanel — Customer account management.
 * Shows customer profile, membership options, rental selection, and check-in flow.
 *
 * In the original ClubOperationsPOS this was 482 lines with a complex multi-step
 * state machine (CustomerProfileCard, EmployeeAssistPanel, etc).
 * This version provides the core shell — sub-components will be migrated incrementally.
 */
export function AccountPanel() {
  const { currentSessionId, customerName } = useRegisterStore();

  if (!currentSessionId) {
    return (
      <PanelShell align="center">
        <div className="flex flex-col items-center gap-3 text-center py-12">
          <span className="text-5xl">👤</span>
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
            No Customer Selected
          </h3>
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            Scan an ID or search for a customer to view their account.
          </p>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell align="top">
      <PanelHeader
        title={customerName ?? 'Customer Account'}
        subtitle={`Session: ${currentSessionId.slice(0, 8)}…`}
      />

      {/* Customer Profile Section */}
      <div className="mt-4 rounded-lg border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold"
            style={{ backgroundColor: 'var(--color-accent-glow)', color: 'var(--color-accent-primary)', border: '1px solid var(--color-border-accent)' }}>
            {customerName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {customerName}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Check-in flow ready
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: 'Membership', icon: '🎫', desc: 'Select membership type' },
          { label: 'Room / Locker', icon: '🚪', desc: 'Choose rental option' },
          { label: 'Agreement', icon: '📋', desc: 'Review terms' },
          { label: 'Complete', icon: '✅', desc: 'Finalize check-in' },
        ].map((action) => (
          <button key={action.label} className="rounded-lg border p-3 text-left transition"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)'; }}
          >
            <span className="text-xl">{action.icon}</span>
            <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{action.label}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{action.desc}</p>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}
