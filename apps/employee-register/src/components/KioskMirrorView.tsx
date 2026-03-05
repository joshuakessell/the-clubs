/**
 * KioskMirrorView — Read-only miniature of what the customer kiosk is showing.
 *
 * Renders a fixed-size 360×640 container that mirrors the kiosk's visual
 * state based on the register's sessionPayload. When there's no active
 * session it shows the idle branding panel; when a session is active it
 * shows the check-in card with charges, total, payment status.
 *
 * Designed to be CSS-scaled inside KioskPiP for thumbnail mode.
 */
import { useState } from 'react';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { getApiUrl } from '@the-clubs/shared';

type KioskView = 'idle' | 'checkin' | 'agreement' | 'complete';

function flowStepToView(flowStep: string | undefined | null, status?: string): KioskView {
  if (status === 'COMPLETED') return 'complete';
  switch (flowStep) {
    case 'RENTAL':
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
        background: '#0a1628',
        color: '#e5e7eb',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
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
                boxShadow: '0 0 60px 20px rgba(96,165,250,0.4)',
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
                filter: 'drop-shadow(0 0 14px rgba(96,165,250,0.5))',
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
                fontFamily: "'Archivo', system-ui, sans-serif",
              }}
            >
              CLUB DALLAS
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 15,
                color: '#9ca3af',
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
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#9ca3af',
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: '#22c55e',
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
                  boxShadow: '0 0 70px 28px rgba(96,165,250,0.4)',
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
                  filter: 'drop-shadow(0 0 14px rgba(96,165,250,0.5))',
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
                fontFamily: "'Archivo', system-ui, sans-serif",
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
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}
            >
              {/* Card header */}
              <div
                style={{
                  padding: '10px 16px',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
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
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', whiteSpace: 'nowrap', fontStyle: item.description.includes('(waitlist)') ? 'italic' : undefined }}>
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
                      borderTop: '1px solid rgba(255,255,255,0.08)',
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
                        color: '#60a5fa',
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
                  <p style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', textAlign: 'center', marginTop: 4 }}>
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
                      backgroundColor: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.3)',
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
                    <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>Payment Received</span>
                  </div>
                )}

                {/* Welcome for members with no charges */}
                {lineItems.length === 0 && isMember && (
                  <p style={{ fontSize: 10, color: '#6b7280', opacity: 0.7, textAlign: 'center' }}>
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
                backgroundColor: 'rgba(34,197,94,0.08)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.3)',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
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

      {/* ── Agreement state ── */}
      {view === 'agreement' && (
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
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                inset: 16,
                borderRadius: '50%',
                boxShadow: '0 0 60px 20px rgba(96,165,250,0.4)',
                opacity: 0.4,
              }}
            />
            <img
              src="/club-dallas-logo.svg"
              alt="Club Dallas"
              width="120"
              height="120"
              style={{
                width: 120,
                height: 120,
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 14px rgba(96,165,250,0.5))',
                position: 'relative',
              }}
            />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Signing Agreement…</div>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.15)',
              borderTopColor: '#60a5fa',
              animation: 'kioskMirrorSpin 1s linear infinite',
            }}
          />
        </div>
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
              backgroundColor: 'rgba(34,197,94,0.15)',
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
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              {sessionPayload.assignedResourceType === 'locker' ? 'Locker' : 'Room'}{' '}
              {sessionPayload.assignedResourceNumber}
            </div>
          )}
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes kioskMirrorPulse {
          50% { opacity: 0.5; }
        }
        @keyframes kioskMirrorSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
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
      const authToken = (globalThis as any).__authToken as string | null;
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
        backgroundColor: 'rgba(0,0,0,0.7)',
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
          backgroundColor: '#111827',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>
            Waitlist Procedures
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
            Please read and acknowledge to continue
          </div>
        </div>

        {/* Body — procedure steps */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {WAITLIST_PROCEDURES.map((text, i) => (
            <div key={`wl-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#f59e0b',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontSize: 11, color: '#d1d5db', lineHeight: 1.4 }}>{text}</span>
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
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: loading ? 'not-allowed' : 'pointer',
              backgroundColor: loading ? 'rgba(255,255,255,0.05)' : '#60a5fa',
              color: loading ? '#6b7280' : '#fff',
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
