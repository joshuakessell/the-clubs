import { useEffect, useRef, useState } from 'react';
import { KioskMirrorView } from './KioskMirrorView';
import { useRegisterStore } from '../stores/useRegisterStore';

const NAVBAR_HEIGHT = 90; // px — combined height of top toolbar + tab bar
const DRAWER_WIDTH = 480; // px
const TAB_WIDTH = 48; // px — width of the exposed pull tab

/**
 * KioskDrawer — right-side slide-out showing a centered mirror of the customer kiosk.
 */
export function KioskDrawer() {
  const sessionPayload = useRegisterStore((s) => s.sessionPayload);
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

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

  const drawerRange = `calc(100vh - ${NAVBAR_HEIGHT}px)`;

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: NAVBAR_HEIGHT,
    right: 0,
    bottom: 0,
    zIndex: 9000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    pointerEvents: 'none',
  };

  return (
    <div ref={drawerRef} style={containerStyle}>
      {/* Drawer panel — slides in from right */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: TAB_WIDTH,
          width: DRAWER_WIDTH,
          height: drawerRange,
          background: 'var(--color-surface-raised)',
          borderLeft: '1px solid var(--color-border-default)',
          borderTop: '1px solid var(--color-border-default)',
          borderRadius: '12px 0 0 0',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.35)',
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH + TAB_WIDTH}px)`,
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorIcon />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              Customer Kiosk
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close kiosk drawer"
            style={{
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: '1px solid var(--color-border-default)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body: centered mirror only (no extra scrolling or proxy controls) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 0 24px' }}>
          {/* Mirror view — centered */}
          <div style={{ transform: 'scale(0.8)', transformOrigin: 'center center', flexShrink: 0 }}>
            <KioskMirrorView sessionPayload={sessionPayload ?? null} />
          </div>
        </div>
      </div>

      {/* ── Pull tab — compact pill on the right edge ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close customer kiosk' : 'Open customer kiosk'}
        style={{
          position: 'absolute',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: TAB_WIDTH,
          height: 180,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          borderRadius: '12px 0 0 12px',
          border: '1px solid var(--color-border-default)',
          borderRight: 'none',
          background: open ? 'var(--color-accent-glow)' : 'var(--color-surface-raised)',
          color: open ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
          cursor: 'pointer',
          boxShadow: '-6px 0 16px rgba(0,0,0,0.2)',
          transition: 'background 0.15s, color 0.15s',
          pointerEvents: 'auto',
        }}
      >
        <MonitorIcon size={20} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
          }}
        >
          Kiosk
        </span>
      </button>
    </div>
  );
}



function MonitorIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
