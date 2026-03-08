/**
 * KioskMirrorView — Interactive mirror of the customer kiosk.
 *
 * Renders a fixed-size 360×640 container that mirrors the kiosk's visual
 * state based on the register's sessionPayload. Fully interactive — the
 * employee can take over for the customer at any step, including signing
 * the agreement.
 *
 * Designed to be CSS-scaled inside KioskPiP for thumbnail mode.
 */
import { useState, useRef, useCallback } from 'react';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { getApiUrl, AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';

type KioskView = 'idle' | 'checkin' | 'agreement' | 'complete';

function flowStepToView(flowStep: string | undefined | null, status?: string): KioskView {
  if (status === 'COMPLETED') return 'complete';
  switch (flowStep) {
    case 'LANGUAGE':
    case 'RENTAL':
    case 'ADD_ONS':
    case 'WAITLIST_PREFERENCES':
    case 'WAITLIST_BACKUP':
    case 'WAITLIST_DISCLAIMER':
    case 'PAYMENT':
      return 'checkin';
    case 'AGREEMENT':
      return 'agreement';
    case 'ASSIGNMENT':
    case 'COMPLETE':
      return 'complete';
    default:
      return 'idle';
  }
}

interface KioskMirrorViewProps {
  sessionPayload: SessionUpdatedPayload | null;
  laneId?: string;
}

export function KioskMirrorView({ sessionPayload, laneId }: Readonly<KioskMirrorViewProps>) {
  const view = sessionPayload
    ? flowStepToView(sessionPayload.flowStep, sessionPayload.status)
    : 'idle';

  const lineItems = sessionPayload?.ledgerLineItems ?? sessionPayload?.paymentLineItems ?? [];
  const total = sessionPayload?.ledgerTotal ?? sessionPayload?.paymentTotal;
  const flowStep = sessionPayload?.flowStep;
  const paymentStatus = sessionPayload?.paymentStatus;
  const customerName = sessionPayload?.customerName ?? 'Customer';

  const isMember = (() => {
    const validUntil = sessionPayload?.customerMembershipValidUntil;
    if (!validUntil) return false;
    return new Date(validUntil + 'T23:59:59') >= new Date();
  })();

  const showPaymentInstructions = flowStep === 'PAYMENT' && paymentStatus !== 'PAID';
  const showPaymentReceived = paymentStatus === 'PAID';
  const showTotal = flowStep === 'PAYMENT' && total != null && total > 0;
  const showWaitlistOverlay = flowStep === 'WAITLIST_DISCLAIMER';

  return (
    <div
      style={{
        width: 360,
        height: 640,
        background: 'var(--color-surface-base, #0a1628)',
        color: 'var(--color-text-primary, #e5e7eb)',
        fontFamily: "var(--font-body, 'Plus Jakarta Sans', system-ui, sans-serif)",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 12,
      }}
    >
      {/* ── Idle state ── */}
      {view === 'idle' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 36,
            padding: 32,
            textAlign: 'center',
            width: '100%',
          }}
        >
          {/* Logo with glow */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                inset: 16,
                borderRadius: '50%',
                boxShadow: '0 0 60px 20px color-mix(in oklch, var(--color-accent-primary) 40%, transparent)',
                opacity: 0.5,
                animation: 'kioskMirrorPulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
            <img
              src="/club-dallas-logo.svg"
              alt="Club Dallas"
              width="160"
              height="160"
              style={{
                width: 160,
                height: 160,
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 14px color-mix(in oklch, var(--color-accent-primary) 50%, transparent))',
                position: 'relative',
              }}
            />
          </div>

          {/* Brand */}
          <div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                textTransform: 'uppercase' as const,
                fontFamily: "var(--font-brand, 'Archivo', system-ui, sans-serif)",
              }}
            >
              CLUB DALLAS
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 15,
                color: 'var(--color-text-muted, #9ca3af)',
              }}
            >
              Customer Kiosk
            </div>
          </div>

          {/* Status pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 12,
              padding: '8px 18px',
              fontSize: 12,
              fontWeight: 500,
              backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 5%, transparent)',
              border: '1px solid color-mix(in oklch, var(--color-text-primary) 8%, transparent)',
              color: 'var(--color-text-muted, #9ca3af)',
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: 'var(--color-status-success, #22c55e)',
                animation: 'kioskMirrorPulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
            Ready for Check-in
          </div>
        </div>
      )}

      {/* ── Check-in state ── */}
      {view === 'checkin' && (
        <>
          {/* Shrunk logo */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 20,
              transform: 'scale(0.55)',
              transformOrigin: 'top center',
            }}
          >
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 12,
                  borderRadius: '50%',
                  boxShadow: '0 0 70px 28px color-mix(in oklch, var(--color-accent-primary) 40%, transparent)',
                  opacity: 0.5,
                }}
              />
              <img
                src="/club-dallas-logo.svg"
                alt="Club Dallas"
                width="160"
                height="160"
                style={{
                  width: 160,
                  height: 160,
                  filter: 'drop-shadow(0 0 14px color-mix(in oklch, var(--color-accent-primary) 50%, transparent))',
                  position: 'relative',
                }}
              />
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                textTransform: 'uppercase' as const,
                fontFamily: "var(--font-brand, 'Archivo', system-ui, sans-serif)",
              }}
            >
              CLUB DALLAS
            </div>
          </div>

          {/* Check-in card */}
          <div
            style={{
              position: 'absolute',
              top: '48%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '88%',
              maxWidth: 320,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 4%, transparent)',
                border: '1px solid color-mix(in oklch, var(--color-text-primary) 8%, transparent)',
                overflow: 'hidden',
              }}
            >
              {/* Card header */}
              <div
                style={{
                  padding: '10px 16px',
                  backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 3%, transparent)',
                  borderBottom: '1px solid color-mix(in oklch, var(--color-text-primary) 6%, transparent)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {isMember ? `Welcome back, ${customerName}!` : `Welcome, ${customerName}`}
                </div>
              </div>

              {/* Card body */}
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lineItems.map((item, i) => (
                  <div
                    key={`${item.description}-${i}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted, #9ca3af)', whiteSpace: 'nowrap', fontStyle: item.description.includes('(waitlist)') ? 'italic' : undefined }}>
                      {item.description}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        marginLeft: 12,
                        minWidth: 50,
                        textAlign: 'right' as const,
                      }}
                    >
                      ${item.amount.toFixed(2)}
                    </span>
                  </div>
                ))}

                {/* Total */}
                {showTotal && total != null && (
                  <div
                    style={{
                      borderTop: '1px solid color-mix(in oklch, var(--color-text-primary) 8%, transparent)',
                      marginTop: 2,
                      paddingTop: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Total Due</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--color-accent-primary, #60a5fa)',
                        marginLeft: 12,
                        minWidth: 50,
                        textAlign: 'right' as const,
                      }}
                    >
                      ${total.toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Payment instruction */}
                {showPaymentInstructions && total != null && total > 0 && (
                  <p style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-muted, #6b7280)', textAlign: 'center', marginTop: 4 }}>
                    Please provide cash or card to the attendant.
                  </p>
                )}

                {/* Payment received */}
                {showPaymentReceived && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      borderRadius: 8,
                      padding: '6px 12px',
                      backgroundColor: 'color-mix(in oklch, var(--color-status-success) 10%, transparent)',
                      border: '1px solid color-mix(in oklch, var(--color-status-success) 30%, transparent)',
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: 'var(--color-status-success, #22c55e)', fontSize: 12 }}>✓</span>
                    <span style={{ color: 'var(--color-status-success, #22c55e)', fontSize: 11, fontWeight: 600 }}>Payment Received</span>
                  </div>
                )}

                {/* Welcome for members with no charges */}
                {lineItems.length === 0 && isMember && (
                  <p style={{ fontSize: 10, color: 'var(--color-text-muted, #6b7280)', opacity: 0.7, textAlign: 'center' }}>
                    Welcome back! Your attendant is preparing your visit.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Active status pill */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 12,
                padding: '6px 14px',
                fontSize: 11,
                fontWeight: 500,
                backgroundColor: 'color-mix(in oklch, var(--color-status-success) 8%, transparent)',
                color: 'var(--color-status-success, #22c55e)',
                border: '1px solid color-mix(in oklch, var(--color-status-success) 30%, transparent)',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-status-success, #22c55e)',
                  animation: 'kioskMirrorPulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
                }}
              />
              Check-in Active
            </div>
          </div>

          {/* ── Waitlist Disclaimer modal overlay ── */}
          {showWaitlistOverlay && sessionPayload && (
            <WaitlistDisclaimerOverlay
              sessionId={sessionPayload.sessionId}
              laneId={laneId}
            />
          )}
        </>
      )}

      {/* ── Agreement state — interactive signing ── */}
      {view === 'agreement' && sessionPayload && (
        <AgreementMirrorScreen
          sessionId={sessionPayload.sessionId}
          laneId={laneId}
        />
      )}

      {/* ── Complete state ── */}
      {view === 'complete' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: 'color-mix(in oklch, var(--color-status-success) 15%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
            }}
          >
            ✓
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Check-in Complete</div>
          {sessionPayload?.assignedResourceNumber && (
            <div
              style={{
                borderRadius: 10,
                padding: '12px 24px',
                backgroundColor: 'var(--color-surface-raised, #111827)',
                border: '1px solid var(--color-border-default, #374151)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-muted, #9ca3af)' }}>
                {sessionPayload.assignedResourceType === 'locker' ? 'Your Locker' : 'Your Room'}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-accent-primary, #60a5fa)',
                  fontFamily: "var(--font-display, 'JetBrains Mono', monospace)",
                  marginTop: 4,
                }}
              >
                {sessionPayload.assignedResourceNumber}
              </div>
              {sessionPayload.checkoutAt && (
                <div style={{ fontSize: 10, color: 'var(--color-text-muted, #9ca3af)', marginTop: 6 }}>
                  Checkout by{' '}
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary, #e5e7eb)' }}>
                    {new Date(sessionPayload.checkoutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Animations */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes kioskMirrorPulse {
            50% { opacity: 0.5; }
          }
          @keyframes kioskMirrorSpin {
            to { transform: rotate(360deg); }
          }
        }
      `}
      </style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * AgreementMirrorScreen — Interactive agreement signing within the 360×640 mirror.
 * Mirrors the real AgreementScreen from customer-kiosk, including signature canvas.
 * ───────────────────────────────────────────────────────────────────────────── */

function AgreementMirrorScreen({ sessionId, laneId }: Readonly<{ sessionId: string; laneId?: string }>) {
  const [signed, setSigned] = useState(false);
  const [showSignCanvas, setShowSignCanvas] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const signatureDataRef = useRef<string>('');

  /* ─── Canvas drawing ─── */
  const getCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return { x: e.nativeEvent.offsetX * scaleX, y: e.nativeEvent.offsetY * scaleY };
  };

  const startDraw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      drawingRef.current = true;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { x, y } = getCoords(e, canvas);
      ctx.beginPath();
      ctx.moveTo(x, y);
    },
    [],
  );

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { x, y } = getCoords(e, canvas);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    [],
  );

  const endDraw = useCallback(() => { drawingRef.current = false; }, []);
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  /* ─── Submit ─── */
  async function submitAgreement() {
    if (!signatureDataRef.current || submitting || !laneId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const authToken = globalThis.__authToken as string | null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/sign-agreement`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            signaturePayload: signatureDataRef.current,
            sessionId,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to sign' }));
        setSubmitError((data as { error?: string }).error ?? 'Failed to sign agreement');
        setSubmitting(false);
        return;
      }
      // SSE will push SESSION_UPDATED which transitions the view
    } catch {
      setSubmitError('Network error — please try again');
      setSubmitting(false);
    }
  }

  const legalHtml = AGREEMENT_LEGAL_BODY_HTML_BY_LANG?.EN ?? '';

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-text-muted, #9ca3af)' }}>
          Step Required
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
          Facility Agreement
        </div>
      </div>

      {/* Document card */}
      <div
        style={{
          flex: 1,
          margin: '0 12px',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--color-border-default, #374151)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* Document header bar */}
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface-raised, #111827)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--color-border-default, #374151)',
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'color-mix(in oklch, var(--color-text-primary) 50%, transparent)' }}>
            Club Dallas
          </span>
          <span style={{ fontSize: 9, color: 'color-mix(in oklch, var(--color-text-primary) 35%, transparent)', fontFamily: 'Georgia, serif' }}>
            Official Document
          </span>
        </div>

        {/* Scrollable legal body */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            padding: '10px 12px',
            fontSize: 9,
            lineHeight: 1.5,
            color: 'var(--color-text-primary, #e5e7eb)',
          }}
          dangerouslySetInnerHTML={{ __html: legalHtml }}
        />

        {/* Signature section */}
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface-raised, #111827)',
            borderTop: '1px solid var(--color-border-default, #374151)',
          }}
        >
          {signed ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 8,
                padding: '6px 10px',
                backgroundColor: 'color-mix(in oklch, var(--color-status-success) 12%, transparent)',
                border: '1px solid color-mix(in oklch, var(--color-status-success) 30%, transparent)',
              }}
            >
              <span style={{ color: 'var(--color-status-success, #16a34a)', fontSize: 14 }}>✓</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-status-success, #15803d)' }}>Signature Captured</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { clearCanvas(); setShowSignCanvas(true); }}
              style={{
                width: '100%',
                borderRadius: 8,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--color-accent-primary, #60a5fa)',
                color: '#fff',
                transition: 'background 0.15s',
              }}
            >
              ✦ Tap to Sign
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!signed || submitting}
          onClick={() => void submitAgreement()}
          style={{
            flex: 1,
            borderRadius: 8,
            padding: '10px 0',
            fontSize: 12,
            fontWeight: 700,
            border: 'none',
            cursor: signed && !submitting ? 'pointer' : 'not-allowed',
            backgroundColor: signed ? 'var(--color-status-success, #16a34a)' : 'color-mix(in oklch, var(--color-text-primary) 10%, transparent)',
            color: signed ? '#fff' : 'var(--color-text-muted, #6b7280)',
            opacity: signed && !submitting ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit Agreement →'}
        </button>
      </div>

      {submitError && (
        <p style={{ fontSize: 10, textAlign: 'center', color: 'var(--color-status-error, #ef4444)', padding: '0 12px 8px' }}>
          {submitError}
        </p>
      )}

      {/* ── Signature canvas overlay ── */}
      {showSignCanvas && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'color-mix(in oklch, var(--color-surface-base) 85%, transparent)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            zIndex: 20,
            borderRadius: 12,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface-raised, #111827)',
              borderRadius: '16px 16px 0 0',
              overflow: 'hidden',
              boxShadow: '0 -8px 48px color-mix(in oklch, var(--color-surface-base) 50%, transparent)',
            }}
          >
            {/* Sheet handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
              <div style={{ width: 32, height: 3, borderRadius: 3, backgroundColor: 'var(--color-border-strong, #4b5563)' }} />
            </div>

            {/* Sheet header */}
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--color-border-subtle, #1f2937)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Georgia, serif' }}>Sign Below</div>
              <div style={{ fontSize: 9, color: 'var(--color-text-muted, #888)', marginTop: 2 }}>Draw your signature in the area below</div>
            </div>

            {/* Canvas */}
            <div style={{ padding: '10px 16px', position: 'relative' }}>
              <canvas
                ref={canvasRef}
                width={600}
                height={150}
                style={{
                  width: '100%',
                  display: 'block',
                  borderRadius: 8,
                  backgroundColor: 'var(--color-surface-base, #0a1628)',
                  border: '1px solid var(--color-border-default, #374151)',
                  cursor: 'crosshair',
                  touchAction: 'none',
                }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              {/* Signature baseline */}
              <div
                style={{
                  position: 'absolute',
                  left: 28,
                  right: 28,
                  bottom: 36,
                  borderBottom: '1px dashed var(--color-border-strong, #4b5563)',
                  pointerEvents: 'none',
                }}
              />
              <p style={{ fontSize: 9, textAlign: 'center', color: 'var(--color-text-muted, #888)', fontFamily: 'Georgia, serif', fontStyle: 'italic', marginTop: 4 }}>
                × Sign here
              </p>
            </div>

            {/* Sheet actions */}
            <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px', borderTop: '1px solid var(--color-border-subtle, #1f2937)' }}>
              <button
                type="button"
                onClick={() => { clearCanvas(); setShowSignCanvas(false); }}
                style={{
                  flex: 1,
                  borderRadius: 8,
                  padding: '8px 0',
                  fontSize: 11,
                  fontWeight: 600,
                  border: '1px solid var(--color-border-default, #374151)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-secondary, #9ca3af)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const canvas = canvasRef.current;
                  if (canvas) signatureDataRef.current = canvas.toDataURL('image/png');
                  setSigned(true);
                  setShowSignCanvas(false);
                }}
                style={{
                  flex: 1,
                  borderRadius: 8,
                  padding: '8px 0',
                  fontSize: 11,
                  fontWeight: 700,
                  border: 'none',
                  backgroundColor: 'var(--color-accent-primary, #60a5fa)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Confirm Signature
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * WaitlistDisclaimerOverlay — modal overlay inside the 360×640 mirror
 * Mirrors the real WaitlistDisclaimerModal.tsx from customer-kiosk.
 * ───────────────────────────────────────────────────────────────────────────── */

const WAITLIST_PROCEDURES = [
  'You will be given the backup rental you selected while you wait for your desired room.',
  'When your desired room type becomes available, an attendant will notify you.',
  'You can upgrade to your desired room by paying the price difference at the front desk.',
];

function WaitlistDisclaimerOverlay({ sessionId, laneId }: Readonly<{ sessionId: string; laneId?: string }>) {
  const [loading, setLoading] = useState(false);

  const handleAgree = async () => {
    if (loading || !laneId) return;
    setLoading(true);
    try {
      const kioskToken = (import.meta.env.VITE_KIOSK_TOKEN as string) || '';
      const authToken = globalThis.__authToken as string | null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (kioskToken) headers['x-kiosk-token'] = kioskToken;
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/flow-command`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId,
            commandId: globalThis.crypto.randomUUID(),
            actor: 'EMPLOYEE',
            type: 'SET_STEP',
            payload: { step: 'PAYMENT' },
          }),
        },
      );
      if (!res.ok) {
        console.error('Mirror waitlist command failed', res.status, await res.text());
        setLoading(false);
      }
      // On success SSE will push SESSION_UPDATED which removes the overlay
    } catch (err) {
      console.error('Failed to accept waitlist disclaimer from mirror', err);
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'color-mix(in oklch, var(--color-surface-base) 70%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 10,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 310,
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: 'var(--color-surface-raised, #111827)',
          border: '1px solid color-mix(in oklch, var(--color-text-primary) 10%, transparent)',
          boxShadow: '0 20px 60px color-mix(in oklch, var(--color-surface-base) 50%, transparent)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 3%, transparent)',
            borderBottom: '1px solid color-mix(in oklch, var(--color-text-primary) 8%, transparent)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            Waitlist Procedures
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted, #6b7280)', marginTop: 2 }}>
            Please read and acknowledge to continue
          </div>
        </div>

        {/* Body — procedure steps */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {WAITLIST_PROCEDURES.map((text, i) => (
            <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 10%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--color-status-warning) 25%, transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--color-status-warning, #f59e0b)',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #d1d5db)', lineHeight: 1.4 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Footer — OK button */}
        <div style={{ padding: '0 16px 14px' }}>
          <button
            disabled={loading || !laneId}
            onClick={() => void handleAgree()}
            style={{
              width: '100%',
              borderRadius: 10,
              padding: '10px 0',
              fontSize: 13,
              fontWeight: 700,
              border: '1px solid color-mix(in oklch, var(--color-text-primary) 10%, transparent)',
              cursor: loading ? 'not-allowed' : 'pointer',
              backgroundColor: loading ? 'color-mix(in oklch, var(--color-text-primary) 5%, transparent)' : 'var(--color-accent-primary, #60a5fa)',
              color: loading ? 'var(--color-text-muted, #6b7280)' : '#fff',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Processing…' : 'OK, I Understand →'}
          </button>
        </div>
      </div>
    </div>
  );
}
