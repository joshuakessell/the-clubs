import { useState, useEffect } from 'react';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelShell } from '../views/PanelShell';
import { ProfileTab } from './account/ProfileTab';
import { EmployeeAssistTab } from './account/EmployeeAssistTab';
import { ChargesTab } from './account/ChargesTab';

type AccountSubTab = 'profile' | 'assist' | 'charges';

const TAB_CONFIG: { id: AccountSubTab; label: string; icon: string }[] = [
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'assist', label: 'Assist', icon: '📋' },
  { id: 'charges', label: 'Charges', icon: '💰' },
];

/**
 * AccountPanel — 3-tab customer account view.
 * - Profile: customer details, Start/Cancel check-in
 * - Employee Assist: mirrors kiosk flow step by step
 * - Charges: payment ledger for current session
 *
 * Auto-switches to Assist tab when a check-in session starts (scan/search auto-start),
 * and defaults to Profile when a customer is opened via search (manual start).
 */
export function AccountPanel() {
  const { currentSessionId, customerId, customerName, sessionPayload } = useRegisterStore();
  const [activeTab, setActiveTab] = useState<AccountSubTab>('profile');

  // Auto-switch to Assist tab when a flow step appears (session started)
  useEffect(() => {
    if (sessionPayload?.flowStep && activeTab === 'profile') {
      setActiveTab('assist');
    }
    // Reset to profile when session and customer are cleared
    if (!currentSessionId && !customerId) {
      setActiveTab('profile');
    }
  }, [sessionPayload?.flowStep, currentSessionId, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentSessionId && !customerId && !customerName) {
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
    <PanelShell align="top" scroll="hidden">
      {/* Tab bar */}
      <div
        className="flex rounded-lg border overflow-hidden"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition"
            style={{
              backgroundColor: activeTab === tab.id ? 'var(--color-accent-primary)' : 'transparent',
              color: activeTab === tab.id ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
            }}
          >
            <span className="text-sm">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4 flex-1 overflow-y-auto">
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'assist' && <EmployeeAssistTab />}
        {activeTab === 'charges' && <ChargesTab />}
      </div>
    </PanelShell>
  );
}
