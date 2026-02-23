import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelShell } from '../views/PanelShell';
import { ProfileTab } from './account/ProfileTab';
import { EmployeeAssistTab } from './account/EmployeeAssistTab';
import { ChargesTab } from './account/ChargesTab';

/**
 * AccountPanel — Responsive customer account view.
 *
 * Layout adapts based on customer state:
 *  - Not checked in → Profile only (full width)
 *  - Checked in (from Rentals) → Profile + Charges (2 columns)
 *  - Checking in (active session) → Profile + Assist + Charges (3 columns)
 */
export function AccountPanel() {
  const { currentSessionId, customerId, customerName, activeCheckinInfo } = useRegisterStore();

  if (!currentSessionId && !customerId && !customerName) {
    return (
      <PanelShell align= "center" >
      <div className="flex flex-col items-center gap-3 text-center py-12" >
        <span className="text-5xl" >👤</span>
          < h3 className = "text-lg font-semibold" style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }
  }>
    No Customer Selected
      </h3>
      < p className = "text-sm max-w-xs" style = {{ color: 'var(--color-text-muted)' }
}>
  Scan an ID or search for a customer to view their account.
          </p>
    </div>
    </PanelShell>
    );
  }

const hasSession = !!currentSessionId;
const isCheckedIn = !!activeCheckinInfo;
const showAssist = hasSession;
const showCharges = hasSession || isCheckedIn;

return (
  <PanelShell align= "top" scroll = "hidden" >
    <div className="flex flex-1 min-h-0 gap-4 w-full" >
      {/* Column 1: Profile — always shown */ }
      < div className = "flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" >
        <h3
            className="mb-2 text-[10px] font-bold uppercase tracking-widest"
style = {{ color: 'var(--color-text-muted)' }}
          >
            👤 Profile
  </h3>
  < div
className = "flex-1 overflow-y-auto rounded-lg border p-2.5"
style = {{
  backgroundColor: 'var(--color-surface-overlay)',
    borderColor: 'var(--color-border-subtle)',
      scrollbarWidth: 'thin',
            }}
          >
  <ProfileTab />
  </div>
  </div>

{/* Column 2: Assist — only during active check-in session */ }
{
  showAssist && (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" >
      <h3
              className="mb-2 text-[10px] font-bold uppercase tracking-widest"
  style = {{ color: 'var(--color-text-muted)' }
}
            >
              📋 Assist
  </h3>
  < div
className = "flex-1 overflow-y-auto rounded-lg border p-2.5"
style = {{
  backgroundColor: 'var(--color-surface-overlay)',
    borderColor: 'var(--color-border-subtle)',
      scrollbarWidth: 'thin',
              }}
            >
  <EmployeeAssistTab />
  </div>
  </div>
        )}

{/* Column 3: Charges — during active session or when checked in */ }
{
  showCharges && (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" >
      <h3
              className="mb-2 text-[10px] font-bold uppercase tracking-widest"
  style = {{ color: 'var(--color-text-muted)' }
}
            >
              💰 Charges
  </h3>
  < div
className = "flex-1 overflow-y-auto rounded-lg border p-2.5"
style = {{
  backgroundColor: 'var(--color-surface-overlay)',
    borderColor: 'var(--color-border-subtle)',
      scrollbarWidth: 'thin',
              }}
            >
  <ChargesTab />
  </div>
  </div>
        )}
</div>
  </PanelShell>
  );
}
