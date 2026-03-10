/**
 * LaneSessionDrawer — bottom pull-tab that exposes the Account panel globally.
 *
 * - A horizontal pill tab is always visible at the bottom of the screen
 * - When opened, a drawer slides up from the bottom, spanning from below the
 *   navbar to the bottom of the viewport (same vertical range as KioskDrawer)
 * - Shows active session info and opens the full AccountPanel
 * - Available on every tab
 */
import { useEffect, useRef, useCallback } from 'react';
import { useRegisterStore } from '../stores/useRegisterStore';
import { AccountPanel } from '../panels/AccountPanel';

const NAVBAR_HEIGHT = 90;
const TAB_HEIGHT = 48;

export function LaneSessionDrawer() {
  const { currentSessionId, customerName, customerId, accountDrawerOpen: open, setAccountDrawerOpen: setOpen } = useRegisterStore();
  const drawerRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (drawerRef.current?.contains(target)) return;
      if (tabRef.current?.contains(target)) return;
      setOpen(false);
    };
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handler);
    });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, setOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setOpen]);

  const handleToggle = useCallback(() => {
    const current = useRegisterStore.getState().accountDrawerOpen;
    setOpen(!current);
  }, [setOpen]);

  const hasActiveProfile = Boolean(currentSessionId || customerId);
  useEffect(() => {
    if (!hasActiveProfile && open) {
      setOpen(false);
    }
  }, [hasActiveProfile, open, setOpen]);

  return (
    <div
      ref={drawerRef}
      className={`fixed inset-0 z-[8500] flex flex-col items-center justify-end pointer-events-none ${
        !hasActiveProfile && !open ? 'invisible' : 'visible'
      }`}
    >
      {/* Drawer panel */}
      <div
        className={`absolute left-0 right-0 bottom-0 bg-[var(--color-surface-base)] border-t border-[var(--color-border-default)] rounded-t-xl shadow-[0_-8px_32px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden transition-transform duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open ? 'translate-y-0 pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          top: NAVBAR_HEIGHT,
          transform: open ? 'translateY(0)' : `translateY(calc(100vh - ${NAVBAR_HEIGHT}px))`,
          paddingBottom: TAB_HEIGHT,
        }}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-[var(--color-border-default)]" />
        </div>

        {/* Account panel fills the drawer */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <AccountPanel />
        </div>
      </div>

      {/* Pull tab */}
      {(open || hasActiveProfile) && (
        <button
          ref={tabRef}
          onClick={handleToggle}
          aria-label={open ? 'Close account panel' : 'Open account panel'}
          className={`relative flex items-center gap-2.5 border border-[var(--color-border-default)] cursor-pointer shadow-[0_-4px_12px_rgba(0,0,0,0.2)] transition-all duration-[280ms] pointer-events-auto shrink-0 ${
            open
              ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent-primary)] rounded-b-xl border-t-0'
              : 'bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] rounded-t-xl border-b-0'
          }`}
          style={{ height: TAB_HEIGHT, paddingLeft: 20, paddingRight: 20, minWidth: 180, maxWidth: 360 }}
        >
          {/* Active indicator dot */}
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-200 ${
              currentSessionId
                ? 'bg-[var(--color-status-success)] shadow-[0_0_6px_var(--color-status-success)]'
                : 'bg-transparent border-2 border-white/15'
            }`}
          />

          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>

          <span className="text-sm font-extrabold tracking-wide whitespace-nowrap overflow-hidden text-ellipsis max-w-[240px]">
            {customerName ?? 'Account'}
          </span>

          {/* Chevron */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 ml-1 transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
