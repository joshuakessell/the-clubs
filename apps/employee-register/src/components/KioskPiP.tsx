/**
 * KioskPiP — Picture-in-Picture container for the kiosk mirror view.
 *
 * Features:
 * - Thumbnail mode: scaled-down KioskMirrorView fixed to a corner
 * - Expanded mode: full KioskMirrorView in a dimmed modal
 * - Draggable: pointer events + snap-to-nearest-corner on release
 * - Corner preference persisted in localStorage
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { KioskMirrorView } from './KioskMirrorView';
import { useRegisterStore } from '../stores/useRegisterStore';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_POSITIONS: Record<Corner, { top?: number; bottom?: number; left?: number; right?: number }> = {
  'top-left': { top: 72, left: 16 },
  'top-right': { top: 72, right: 16 },
  'bottom-left': { bottom: 16, left: 16 },
  'bottom-right': { bottom: 16, right: 16 },
};

const STORAGE_KEY = 'kiosk-pip-corner';

function loadCorner(): Corner {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in CORNER_POSITIONS) return v as Corner;
  } catch { /* ignore */ }
  return 'bottom-right';
}

// Thumbnail dimensions — 9:16 aspect ratio scaled down
const THUMB_W = 135;
const THUMB_H = 240;
// Scale factor: mirror is 360×640, thumbnail is 135×240
const SCALE = THUMB_W / 360;

export function KioskPiP() {
  const sessionPayload = useRegisterStore((s) => s.sessionPayload);
  const [corner, setCorner] = useState<Corner>(loadCorner);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const thumbRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; elX: number; elY: number } | null>(null);

  // Persist corner preference
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, corner); } catch { /* ignore */ }
  }, [corner]);

  // ── Drag handlers ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (expanded) return;
    const el = thumbRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      elX: rect.left,
      elY: rect.top,
    };
    el.setPointerCapture(e.pointerId);
  }, [expanded]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Only start dragging after 5px of movement (prevents tap-drag)
    if (!isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
      setIsDragging(true);
    }

    if (isDragging || Math.abs(dx) + Math.abs(dy) > 5) {
      setDragPos({
        x: start.elX + dx,
        y: start.elY + dy,
      });
    }
  }, [isDragging]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasActuallyDragging = isDragging;
    dragStartRef.current = null;

    if (wasActuallyDragging && dragPos) {
      // Snap to nearest corner
      const cx = dragPos.x + THUMB_W / 2;
      const cy = dragPos.y + THUMB_H / 2;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const isRight = cx > vw / 2;
      const isBottom = cy > vh / 2;

      const newCorner: Corner = isBottom
        ? isRight ? 'bottom-right' : 'bottom-left'
        : isRight ? 'top-right' : 'top-left';

      setCorner(newCorner);
      setDragPos(null);
      setIsDragging(false);
    } else {
      // It was a tap, not a drag → expand
      setDragPos(null);
      setIsDragging(false);
      setExpanded(true);
    }

    const el = thumbRef.current;
    if (el) el.releasePointerCapture(e.pointerId);
  }, [isDragging, dragPos]);

  // ── Compute thumbnail style ──
  const cornerPos = CORNER_POSITIONS[corner];
  const thumbStyle: React.CSSProperties = isDragging && dragPos
    ? {
        position: 'fixed',
        left: dragPos.x,
        top: dragPos.y,
        zIndex: 9990,
        transition: 'none',
      }
    : {
        position: 'fixed',
        ...cornerPos,
        zIndex: 9990,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      };

  return (
    <>
      {/* ── Thumbnail ── */}
      {!expanded && (
        <div
          ref={thumbRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            ...thumbStyle,
            width: THUMB_W,
            height: THUMB_H,
            borderRadius: 10,
            overflow: 'hidden',
            cursor: isDragging ? 'grabbing' : 'grab',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              transform: `scale(${SCALE})`,
              transformOrigin: 'top left',
              width: 360,
              height: 640,
              pointerEvents: 'none',
            }}
          >
            <KioskMirrorView sessionPayload={sessionPayload ?? null} />
          </div>
        </div>
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
              boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              cursor: 'default',
              animation: 'kioskPipFadeIn 0.2s ease-out',
            }}
          >
            <KioskMirrorView sessionPayload={sessionPayload ?? null} />
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
        @keyframes kioskPipFadeIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}
