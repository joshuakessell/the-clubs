/**
 * LaneSessionDrawer — bottom pull-tab that exposes the Account panel globally.
 *
 * - A horizontal pill tab is always visible at the bottom of the screen
 * - When opened, a drawer slides up from the bottom, spanning from below the
 *   navbar to the bottom of the viewport (same vertical range as KioskDrawer)
 * - Shows active session info and opens the full AccountPanel
 * - Available on every tab
 */
import { useEffect, useRef } from 'react';
import { useRegisterStore } from '../stores/useRegisterStore';
import { AccountPanel } from '../panels/AccountPanel';

const NAVBAR_HEIGHT = 90; // px — approx combined height of top toolbar + tab bar
const TAB_HEIGHT = 48;    // px — height of the exposed pull tab

export function LaneSessionDrawer() {
  const { currentSessionId, customerName, customerId, accountDrawerOpen: open, setAccountDrawerOpen: setOpen } = useRegisterStore();
  const drawerRef = useRef<HTMLDivElement>(null);

  // NOTE: Intentionally do NOT auto-close on session changes.
  // Heartbeats can transiently clear currentSessionId and would incorrectly dismiss the drawer.
  // The drawer closes only via user interaction (click outside, Escape, ✕).

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const drawerHeight = `calc(100vh - ${NAVBAR_HEIGHT}px)`;
  const hasActiveProfile = Boolean(currentSessionId || customerId);

  return (
    <div
      ref={drawerRef}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 8500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
        // Hide the drawer fully if there's no active profile and it's closed
        visibility: (!hasActiveProfile && !open) ? 'hidden' : 'visible',
      }}
    >
      {/* ── Drawer panel — slides up from bottom ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `calc(${drawerHeight} + ${TAB_HEIGHT}px)`,
          background: 'var(--color-surface-base)',
          borderTop: '1px solid var(--color-border-default)',
          borderRadius: '12px 12px 0 0',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.35)',
          transform: open ? 'translateY(0)' : `translateY(calc(${drawerHeight} + ${TAB_HEIGHT}px))`,
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: 'auto',
          paddingBottom: TAB_HEIGHT,
        }}
      >
        {/* Drag handle indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 0 4px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'var(--color-border-default)',
            }}
          />
        </div>

        {/* Account panel fills the drawer */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <AccountPanel />
        </div>
      </div>

      {/* ── Pull tab ── */}
      {/* Only render pull tab if there's an active profile */}
      {hasActiveProfile && (
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close account panel' : 'Open account panel'}
          style={{
            position: 'relative',
            height: TAB_HEIGHT,
            paddingLeft: 20,
            paddingRight: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderRadius: '12px 12px 0 0',
            border: '1px solid var(--color-border-default)',
            borderBottom: 'none',
            background: open
              ? 'var(--color-accent-glow)'
              : 'var(--color-surface-raised)',
            color: open
              ? 'var(--color-accent-primary)'
              : 'var(--color-text-primary)',
            cursor: 'pointer',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.2)',
            transition: 'background 0.15s, color 0.15s',
            pointerEvents: 'auto',
            minWidth: 180,
            maxWidth: 360,
            flexShrink: 0,
          }}
        >
          {/* Active indicator dot */}
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: currentSessionId ? 'var(--color-status-success)' : 'transparent',
              border: currentSessionId ? 'none' : '2px solid rgba(255,255,255,0.15)',
              flexShrink: 0,
              boxShadow: currentSessionId ? '0 0 6px var(--color-status-success)' : 'none',
              transition: 'background 0.2s, box-shadow 0.2s, border 0.2s',
            }}
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
            style={{ flexShrink: 0 }}
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>

          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 240,
            }}
          >
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
            style={{
              flexShrink: 0,
              marginLeft: 4,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
