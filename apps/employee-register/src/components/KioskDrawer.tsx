import { useEffect, useRef, useState } from 'react';
import { KioskMirrorView } from './KioskMirrorView';
import { useRegisterStore } from '../stores/useRegisterStore';

const NAVBAR_HEIGHT = 92;
const DRAWER_WIDTH = 400;
const TAB_WIDTH = 48;
const TAB_VISIBLE_STRIP = 6;

/**
 * KioskDrawer — right-side slide-out showing a centered mirror of the customer kiosk.
 * Tab is mostly hidden until the cursor approaches the right edge.
 */
export function KioskDrawer() {
  const sessionPayload = useRegisterStore((s) => s.sessionPayload);
  const laneId = useRegisterStore((s) => s.laneId);
  const [open, setOpen] = useState(false);
  const [tabRevealed, setTabRevealed] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reveal tab when cursor is near the right edge of the viewport
  useEffect(() => {
    if (open) return;
    const handler = (e: MouseEvent) => {
      const distanceFromEdge = window.innerWidth - e.clientX;
      if (distanceFromEdge <= 32) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setTabRevealed(true);
      } else if (distanceFromEdge > 80) {
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => {
            setTabRevealed(false);
            hideTimerRef.current = null;
          }, 400);
        }
      }
    };
    document.addEventListener('mousemove', handler);
    return () => {
      document.removeEventListener('mousemove', handler);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [open]);

  // When drawer opens, reset revealed state
  useEffect(() => {
    if (open) setTabRevealed(false);
  }, [open]);

  const tabOffset = open
    ? 0
    : tabRevealed
      ? 0
      : TAB_WIDTH - TAB_VISIBLE_STRIP;

  return (
    <div
      ref={drawerRef}
      className="fixed right-0 bottom-0 z-[9000] flex flex-col items-end pointer-events-none"
      style={{ top: NAVBAR_HEIGHT }}
    >
      {/* Drawer panel */}
      <div
        className={`absolute top-0 flex flex-col overflow-hidden border-l border-t border-[var(--color-border-default)] bg-[var(--color-surface-raised)] rounded-tl-xl shadow-[-8px_0_32px_rgba(0,0,0,0.35)] transition-all duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
          open ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          right: 0,
          width: DRAWER_WIDTH,
          height: `calc(100vh - ${NAVBAR_HEIGHT}px)`,
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_WIDTH}px)`,
        }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="flex items-center gap-2">
            <MonitorIcon />
            <span className="text-[13px] font-bold text-[var(--color-text-primary)]">
              Customer Kiosk
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close kiosk drawer"
            className="flex items-center justify-center w-[26px] h-[26px] rounded-md border border-[var(--color-border-default)] bg-transparent text-[var(--color-text-muted)] cursor-pointer text-sm leading-none hover:bg-[var(--color-surface-raised)]"
          >
            ✕
          </button>
        </div>

        {/* Body: full-size mirror */}
        <div className="flex-1 flex flex-col items-center justify-center overflow-auto">
          <KioskMirrorView sessionPayload={sessionPayload ?? null} laneId={laneId ?? undefined} />
        </div>

        {/* Tab — attached to left edge of drawer when open */}
        {open && (
          <button
            onClick={() => setOpen(false)}
            aria-label="Close customer kiosk"
            className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-2.5 border cursor-pointer shadow-[-6px_0_16px_rgba(0,0,0,0.2)] pointer-events-auto bg-[var(--color-accent-glow)] text-[var(--color-accent-primary)] rounded-l-xl border-r-0 border-[var(--color-border-default)]"
            style={{ width: TAB_WIDTH, height: 140, left: -TAB_WIDTH }}
          >
            <MonitorIcon size={18} />
            <span className="text-[11px] font-extrabold tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">
              Kiosk
            </span>
          </button>
        )}
      </div>

      {/* Pull tab on right edge — mostly hidden until hover */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open customer kiosk"
          className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-2.5 border cursor-pointer shadow-[-6px_0_16px_rgba(0,0,0,0.2)] pointer-events-auto bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] rounded-l-xl border-r-0 border-[var(--color-border-default)]"
          style={{
            width: TAB_WIDTH,
            height: 140,
            right: -tabOffset,
            opacity: tabRevealed ? 1 : 0.3,
            transition: 'right 250ms cubic-bezier(0.4,0,0.2,1), opacity 250ms ease',
          }}
          onMouseEnter={() => setTabRevealed(true)}
          onMouseLeave={() => {
            hideTimerRef.current = setTimeout(() => {
              setTabRevealed(false);
              hideTimerRef.current = null;
            }, 600);
          }}
        >
          <MonitorIcon size={18} />
          <span className="text-[11px] font-extrabold tracking-widest uppercase [writing-mode:vertical-rl] rotate-180">
            Kiosk
          </span>
        </button>
      )}
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
      className="shrink-0"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
