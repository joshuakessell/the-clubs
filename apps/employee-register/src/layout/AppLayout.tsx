import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '@the-clubs/ui';
import { TopNavbar } from './TopNavbar';
import { ScanPanel } from '../panels/ScanPanel';
import { InventoryPanel } from '../panels/InventoryPanel';
import { UpgradesPanel } from '../panels/UpgradesPanel';
import { RetailPanel } from '../panels/RetailPanel';
import { CheckoutPanel } from '../panels/CheckoutPanel';
import { ClubLogPanel } from '../panels/ClubLogPanel';
import { ManualEntryPanel } from '../panels/ManualEntryPanel';
import { RoomCleaningPanel } from '../panels/RoomCleaningPanel';
import { useRegisterStore } from '../stores/useRegisterStore';
import { KioskDrawer } from '../components/KioskDrawer';
import { LaneSessionDrawer } from '../components/LaneSessionDrawer';

export type NavTab =
  | 'scan'
  | 'inventory'
  | 'upgrades'
  | 'retail'
  | 'checkout'
  | 'clubLog'
  | 'firstTime'
  | 'roomCleaning';

const PANELS: Record<NavTab, React.FC> = {
  scan: ScanPanel,
  inventory: InventoryPanel,
  upgrades: UpgradesPanel,
  retail: RetailPanel,
  checkout: CheckoutPanel,
  clubLog: ClubLogPanel,
  firstTime: ManualEntryPanel,
  roomCleaning: RoomCleaningPanel,
};

export function AppLayout() {
  const [activeTab, setActiveTab] = useState<NavTab>('scan');
  const session = useAuthStore((s) => s.session);
  const clearSession = useAuthStore((s) => s.clearSession);

  const handleNav = useCallback((tab: NavTab) => {
    // Close account drawer before navigating
    useRegisterStore.getState().setAccountDrawerOpen(false);
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

  // F-key shortcuts (F1–F9)
  useEffect(() => {
    // Account tab removed from nav bar — accessible only via LaneSessionDrawer
    const tabs: NavTab[] = ['scan', 'inventory', 'upgrades', 'retail', 'checkout', 'clubLog', 'firstTime', 'roomCleaning'];
    const fKeyMap: Record<string, number> = {
      F1: 0, F2: 1, F3: 2, F4: 3, F5: 4, F6: 5, F7: 6, F8: 7,
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

    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [handleNav]);

  // Wire store's selectNavTab to our local handleNav
  useEffect(() => {
    useRegisterStore.setState({ selectNavTab: (tab: string) => handleNav(tab as NavTab) });
    return () => {
      useRegisterStore.setState({ selectNavTab: () => {} });
    };
  }, [handleNav]);

  const toastMessage = useRegisterStore((s) => s.successToastMessage);
  const setToastMessage = useRegisterStore((s) => s.setSuccessToastMessage);
  const [visibleToast, setVisibleToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toastMessage) {
      setVisibleToast(toastMessage);
      setToastMessage(null);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setVisibleToast(null), 2000);
    }
  }, [toastMessage, setToastMessage]);

  const isErrorToast = visibleToast
    ? /ban|fail|error|denied|blocked|declined/i.test(visibleToast)
    : false;

  const ActivePanel = PANELS[activeTab] ?? ScanPanel;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-surface-base)]">
      {/* Skip link for keyboard/screen-reader users */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-[var(--color-surface-raised)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold text-[var(--color-accent-primary)]">
        Skip to main content
      </a>
      <TopNavbar
        activeTab={activeTab}
        onNavigate={handleNav}
        employeeName={session?.name ?? ''}
        onSignOut={clearSession}
      />

      {/* Right-side kiosk drawer and bottom session drawer */}
      <KioskDrawer />
      <LaneSessionDrawer />

      <main id="main-content" className="flex flex-col flex-1 min-h-0 overflow-hidden p-4" data-main-content>
        <ActivePanel />
      </main>

      {/* Global toast — aria-live for screen readers */}
      <div aria-live="polite" aria-atomic="true">
      {visibleToast && (
        <div
          className="fixed top-1/2 left-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 animate-slideDown pointer-events-auto"
        >
          <div
            className={`flex items-center gap-3 rounded-xl border px-5 py-3 shadow-lg backdrop-blur-[12px] max-w-[480px] ${
              isErrorToast
                ? 'bg-[color-mix(in_oklch,var(--color-status-error)_12%,transparent)] border-[color-mix(in_oklch,var(--color-status-error)_30%,transparent)]'
                : 'bg-[color-mix(in_oklch,var(--color-status-success)_12%,transparent)] border-[color-mix(in_oklch,var(--color-status-success)_30%,transparent)]'
            }`}
          >
            <span className="text-lg">{isErrorToast ? '⛔' : '✓'}</span>
            <span className={`text-sm font-semibold ${isErrorToast ? 'text-[#fca5a5]' : 'text-[#86efac]'}`}>
              {visibleToast}
            </span>
            <button
              onClick={() => setVisibleToast(null)}
              className={`ml-2 text-xs opacity-60 hover:opacity-100 ${isErrorToast ? 'text-[#fca5a5]' : 'text-[#86efac]'}`}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
