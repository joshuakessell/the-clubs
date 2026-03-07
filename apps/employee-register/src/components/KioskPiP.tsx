/**
 * KioskPiP — "Customer Kiosk" button that opens a full modal of the kiosk mirror view.
 *
 * - Collapsed: simple "Customer Kiosk" button fixed to the bottom-right corner
 * - Expanded: full KioskMirrorView in a dimmed backdrop modal
 * - Clicking outside the modal (on the backdrop) minimizes back to the button
 */
import { useState } from 'react';
import { KioskMirrorView } from './KioskMirrorView';
import { useRegisterStore } from '../stores/useRegisterStore';

export function KioskPiP() {
  const sessionPayload = useRegisterStore((s) => s.sessionPayload);
  const laneId = useRegisterStore((s) => s.laneId);
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* ── Corner button ── */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 9990,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid var(--color-border-default)',
            backgroundColor: 'var(--color-surface-raised)',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.05)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)';
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)';
            (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)';
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-raised)';
            (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)';
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Customer Kiosk
        </button>
      )}

      {/* ── Expanded modal ── */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9995,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow:
                '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              cursor: 'default',
              animation: 'kioskModalFadeIn 0.2s ease-out',
            }}
          >
            <KioskMirrorView sessionPayload={sessionPayload ?? null} laneId={laneId} />
          </div>

          {/* Close hint */}
          <div
            style={{
              position: 'absolute',
              bottom: 32,
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 13,
              fontWeight: 500,
              pointerEvents: 'none',
            }}
          >
            Tap anywhere to close
          </div>
        </div>
      )}

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes kioskModalFadeIn {
            from {
              opacity: 0;
              transform: scale(0.9);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        }
      `}</style>
    </>
  );
}
