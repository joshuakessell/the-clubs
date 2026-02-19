import { useRef, useState, useCallback } from 'react';
import { ScreenShell } from '../components/ScreenShell';

interface Props {
  onAccept: () => void;
  onCancel: () => void;
}

const AGREEMENT_TEXT = `
<h3>Terms & Conditions</h3>
<p>By signing below, you acknowledge and agree to the following terms and conditions for admission to The Clubs facility:</p>
<ol>
<li>I understand that use of the facilities is at my own risk.</li>
<li>I will follow all posted rules and directives from staff members.</li>
<li>I agree to vacate my assigned room/locker by the designated checkout time.</li>
<li>I will not bring outside food or beverages into the facility (except sealed water).</li>
<li>Any damage to facility property will be charged to my account.</li>
<li>I understand that management reserves the right to refuse service.</li>
<li>I will keep my personal belongings secured; the facility is not responsible for lost/stolen items.</li>
<li>I certify that I am at least 18 years of age.</li>
</ol>
<p><em>This agreement is valid for this visit only.</em></p>
`.trim();

/**
 * AgreementScreen — Customer reads and signs the agreement.
 * Signature canvas modal + agreement text + submit flow.
 */
export function AgreementScreen({ onAccept, onCancel }: Props) {
  const [signed, setSigned] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const startDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.beginPath();
    ctx.moveTo(x * (canvas.width / rect.width), y * (canvas.height / rect.height));
  }, []);

  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineTo(x * (canvas.width / rect.width), y * (canvas.height / rect.height));
    ctx.stroke();
  }, []);

  const endDraw = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <ScreenShell>
      <div className="flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
        {/* Agreement card */}
        <div
          className="flex flex-col rounded-2xl border"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        >
          <h2
            className="px-6 pt-6 text-xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            Facility Agreement
          </h2>

          {/* Scrollable text */}
          <div className="mt-3 max-h-[40vh] overflow-y-auto px-6 pb-4">
            <div
              className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
              dangerouslySetInnerHTML={{ __html: AGREEMENT_TEXT }}
            />
          </div>

          {/* Sign button */}
          <div className="border-t px-6 py-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <button
              type="button"
              className={`w-full rounded-lg px-6 py-3 text-base font-semibold transition ${signed ? 'opacity-70' : 'animate-pulse'}`}
              style={{
                backgroundColor: signed ? 'rgba(16, 185, 129, 0.15)' : 'var(--color-accent-primary)',
                color: signed ? 'var(--color-status-success)' : 'var(--color-text-inverse)',
                border: signed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
              }}
              disabled={signed}
              onClick={() => { clearCanvas(); setShowSignModal(true); }}
            >
              {signed ? '✓ Signed' : 'Tap to Sign'}
            </button>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex gap-3">
          <button
            type="button"
            className="flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg px-6 py-4 text-base font-bold transition disabled:opacity-40 ${signed ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: signed ? 'var(--color-status-success)' : 'var(--color-surface-overlay)',
              color: signed ? 'white' : 'var(--color-text-muted)',
            }}
            disabled={!signed}
            onClick={onAccept}
          >
            Submit Agreement
          </button>
        </div>
      </div>

      {/* Signature modal */}
      {showSignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
          style={{ backgroundColor: 'rgba(10, 10, 15, 0.8)' }}
          role="dialog"
          aria-label="Signature"
        >
          <div
            className="flex flex-col gap-4 rounded-2xl border p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)', width: '90vw', maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              Sign Below
            </h3>

            <canvas
              ref={canvasRef}
              width={800}
              height={280}
              className="w-full rounded-lg border"
              style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'rgba(10, 10, 15, 0.5)', touchAction: 'none' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />

            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border px-4 py-3 font-semibold transition"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
                onClick={() => { clearCanvas(); setShowSignModal(false); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg px-4 py-3 font-bold transition"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}
                onClick={() => { setSigned(true); setShowSignModal(false); }}
              >
                Confirm Signature
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
