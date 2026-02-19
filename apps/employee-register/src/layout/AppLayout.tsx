import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '@the-clubs/ui';
import { TopNavbar } from './TopNavbar';
import { ScanPanel } from '../panels/ScanPanel';
import { SearchPanel } from '../panels/SearchPanel';
import { InventoryPanel } from '../panels/InventoryPanel';
import { UpgradesPanel } from '../panels/UpgradesPanel';
import { RetailPanel } from '../panels/RetailPanel';
import { CheckoutPanel } from '../panels/CheckoutPanel';
import { AccountPanel } from '../panels/AccountPanel';
import { ClubLogPanel } from '../panels/ClubLogPanel';
import { ManualEntryPanel } from '../panels/ManualEntryPanel';
import { RoomCleaningPanel } from '../panels/RoomCleaningPanel';

export type NavTab =
  | 'scan'
  | 'search'
  | 'inventory'
  | 'upgrades'
  | 'retail'
  | 'checkout'
  | 'account'
  | 'clubLog'
  | 'firstTime'
  | 'roomCleaning';

const PANELS: Record<NavTab, React.FC> = {
  scan: ScanPanel,
  search: SearchPanel,
  inventory: InventoryPanel,
  upgrades: UpgradesPanel,
  retail: RetailPanel,
  checkout: CheckoutPanel,
  account: AccountPanel,
  clubLog: ClubLogPanel,
  firstTime: ManualEntryPanel,
  roomCleaning: RoomCleaningPanel,
};

export function AppLayout() {
  const [activeTab, setActiveTab] = useState<NavTab>('scan');
  const session = useAuthStore((s) => s.session);
  const clearSession = useAuthStore((s) => s.clearSession);

  const handleNav = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    // Auto-focus first interactive element in new panel
    requestAnimationFrame(() => {
      setTimeout(() => {
        const main = document.querySelector('[data-main-content]');
        const el = main?.querySelector<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        );
        el?.focus();
      }, 100);
    });
  }, []);

  // F-key shortcuts (F1–F10)
  useEffect(() => {
    const tabs: NavTab[] = ['scan', 'search', 'inventory', 'upgrades', 'retail', 'checkout', 'account', 'clubLog', 'firstTime', 'roomCleaning'];
    const fKeyMap: Record<string, number> = {
      F1: 0, F2: 1, F3: 2, F4: 3, F5: 4, F6: 5, F7: 6, F8: 7, F9: 8, F10: 9,
    };

    const handler = (e: KeyboardEvent) => {
      const idx = fKeyMap[e.key];
      if (idx === undefined) return;
      if (document.querySelector('[role="dialog"]')) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      e.preventDefault();
      handleNav(tabs[idx]);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNav]);

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-surface-base)' }}>
      <TopNavbar
        activeTab={activeTab}
        onNavigate={handleNav}
        employeeName={session?.name ?? ''}
        onSignOut={clearSession}
      />

      <main className="flex-1 min-h-0 overflow-auto p-4" data-main-content>
        <ActivePanel />
      </main>
    </div>
  );
}
