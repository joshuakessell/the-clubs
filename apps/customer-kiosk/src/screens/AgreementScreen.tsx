import { useRef, useState, useCallback } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';
import { useKioskSession } from '../KioskSessionContext';
import { getApiUrl } from '@the-clubs/shared';

/**
 * AgreementScreen — Premium legal document signing experience.
 *
 * Design: Official printed-document aesthetic with cream-white body,
 * deep ink typography, and a focused signature ceremony.
 */
export function AgreementScreen() {
  const { reset, laneId, kioskToken, sessionPayload } = useKioskSession();
  const { t } = useI18n();
  const [signed, setSigned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSignModal, setShowSignModal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const signatureDataRef = useRef<string>('');

  /* ─── Canvas drawing ─────────────────────────────────── */
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
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    [],
  );

  const endDraw = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  /* ─── Submission ─────────────────────────────────────── */
  async function submitAgreement() {
    if (!signatureDataRef.current || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (kioskToken) headers['x-kiosk-token'] = kioskToken;
      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/sign-agreement`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            signaturePayload: signatureDataRef.current,
            sessionId: sessionPayload?.sessionId,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to sign' }));
        setSubmitError((data as { error?: string }).error ?? 'Failed to sign agreement');
        setSubmitting(false);
        return;
      }
      // SSE will handle UI transition
    } catch {
      setSubmitError('Network error — please try again');
      setSubmitting(false);
    }
  }

  return (
    <ScreenShell>
      <div
        className="flex w-full max-w-xl flex-col gap-5 px-4 py-6"
        style={{ touchAction: 'manipulation' }}
      >

        {/* ── Screen heading ── */}
        <div className="text-center">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--color-text-muted)', letterSpacing: '0.18em' }}
          >
            Step Required
          </p>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}
          >
            {t('agreement.facilityAgreement')}
          </h1>
        </div>

        {/* ── Document card ── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            boxShadow: '0 4px 32px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2)',
            border: '1px solid rgba(0,0,0,0.15)',
          }}
        >
          {/* Document header bar */}
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{
              backgroundColor: '#1a1a1a',
            }}
          >
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.2em' }}
            >
              Club Dallas
            </span>
            <span
              className="text-xs"
              style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'Georgia, serif' }}
            >
              Official Document
            </span>
          </div>

          {/* Scrollable legal body */}
          <div
            className="overflow-y-auto"
            style={{
              maxHeight: '42vh',
              backgroundColor: '#fafaf7',
              overscrollBehavior: 'contain',
            }}
          >
            <div
              style={{
                padding: '24px 28px',
                color: '#1a1a1a',
              }}
              dangerouslySetInnerHTML={{ __html: t('agreement.legalBodyHtml') }}
            />
          </div>

          {/* Signature section */}
          <div
            className="px-5 py-4"
            style={{
              backgroundColor: '#f0ede6',
              borderTop: '1px solid #d4cfc4',
            }}
          >
            {!signed ? (
              <button
                type="button"
                className="w-full rounded-lg py-3.5 text-base font-bold transition-all"
                style={{
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  letterSpacing: '0.03em',
                }}
                onClick={() => { clearCanvas(); setShowSignModal(true); }}
              >
                ✦ {t('agreement.tapToSign')}
              </button>
            ) : (
              <div
                className="flex items-center gap-3 rounded-lg px-4 py-3"
                style={{
                  backgroundColor: 'rgba(22, 163, 74, 0.12)',
                  border: '1px solid rgba(22, 163, 74, 0.3)',
                }}
              >
                <span style={{ color: '#16a34a', fontSize: '1.25rem' }}>✓</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#15803d' }}>
                    {t('agreement.signed')}
                  </p>
                  <p className="text-xs" style={{ color: '#4ade80' }}>
                    Signature captured — review and submit below
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Action row ── */}
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-xl border px-5 py-4 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--color-border-default)',
              color: 'var(--color-text-muted)',
              backgroundColor: 'transparent',
            }}
            onClick={reset}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!signed || submitting}
            onClick={submitAgreement}
            className="flex-1 rounded-xl py-4 text-base font-bold transition-all disabled:opacity-40"
            style={{
              backgroundColor: signed ? '#16a34a' : 'var(--color-surface-overlay)',
              color: signed ? '#ffffff' : 'var(--color-text-muted)',
              ...(signed && !submitting ? { animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' } : {}),
            }}
          >
            {submitting ? 'Submitting…' : t('agreement.submitAgreement')}
          </button>
        </div>

        {submitError && (
          <p
            className="text-sm text-center"
            style={{ color: 'var(--color-status-error)' }}
          >
            {submitError}
          </p>
        )}
      </div>

      {/* ── Signature modal ── */}
      {showSignModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
          role="dialog"
          aria-modal="true"
          aria-label={t('a11y.signatureDialog')}
        >
          <div
            className="w-full rounded-t-3xl flex flex-col gap-0 overflow-hidden"
            style={{
              backgroundColor: '#fafaf7',
              maxWidth: '600px',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.5)',
            }}
          >
            {/* Sheet handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div
                className="rounded-full"
                style={{ width: 40, height: 4, backgroundColor: '#cccccc' }}
              />
            </div>

            {/* Sheet header */}
            <div
              className="px-6 py-4"
              style={{ borderBottom: '1px solid #e0ddd6' }}
            >
              <h3
                className="text-lg font-bold"
                style={{
                  fontFamily: 'Georgia, serif',
                  color: '#1a1a1a',
                  textAlign: 'center',
                }}
              >
                {t('agreement.signBelow')}
              </h3>
              <p className="text-xs text-center mt-1" style={{ color: '#888888' }}>
                Draw your signature in the area below
              </p>
            </div>

            {/* Canvas */}
            <div className="px-6 py-4" style={{ position: 'relative' }}>
              <canvas
                ref={canvasRef}
                width={800}
                height={200}
                className="w-full rounded-lg"
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1cec7',
                  cursor: 'crosshair',
                  touchAction: 'none',
                  display: 'block',
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
                  left: 40,
                  right: 40,
                  bottom: 52,
                  borderBottom: '1px dashed #cccccc',
                  pointerEvents: 'none',
                }}
              />
              <p
                className="text-xs text-center mt-2"
                style={{ color: '#aaaaaa', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
              >
                × Sign here
              </p>
            </div>

            {/* Sheet actions */}
            <div
              className="flex gap-3 px-6 pb-8 pt-2"
              style={{ borderTop: '1px solid #e0ddd6' }}
            >
              <button
                type="button"
                className="flex-1 rounded-xl border py-3.5 text-sm font-semibold transition-colors"
                style={{
                  borderColor: '#cccccc',
                  color: '#555555',
                  backgroundColor: 'transparent',
                }}
                onClick={() => { clearCanvas(); setShowSignModal(false); }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl py-3.5 text-sm font-bold transition-all"
                style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
                onClick={() => {
                  const canvas = canvasRef.current;
                  if (canvas) signatureDataRef.current = canvas.toDataURL('image/png');
                  setSigned(true);
                  setShowSignModal(false);
                }}
              >
                {t('agreement.confirmSignature')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
