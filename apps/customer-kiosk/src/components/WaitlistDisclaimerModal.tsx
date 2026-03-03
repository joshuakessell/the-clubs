import { useCallback, useState } from 'react';
import { useKioskSession } from '../KioskSessionContext';
import { getApiUrl } from '@the-clubs/shared';

// Waitlist procedures copy
const WAITLIST_PROCEDURES = [
  "You will be given the rental you just selected while you wait.",
  "When your desired room type becomes available, we will notify you.",
  "You can upgrade to your desired room by paying the price difference at the front desk.",
];

export function WaitlistDisclaimerModal() {
  const { laneId, kioskToken, sessionPayload } = useKioskSession();
  const [loading, setLoading] = useState(false);

  const handleAgree = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (kioskToken) headers['x-kiosk-token'] = kioskToken;

      await fetch(getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/command`), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'SET_STEP',
          payload: { step: 'PAYMENT' },
        }),
      });
    } catch (err) {
      console.error('Failed to accept waitlist disclaimer', err);
      setLoading(false);
    }
  }, [laneId, kioskToken]);

  const flowStep = sessionPayload?.flowStep;
  if (flowStep !== 'WAITLIST_DISCLAIMER') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
      <div 
        className="w-full max-w-md rounded-2xl p-8 transform transition-all shadow-2xl animate-in zoom-in-95"
        style={{
          backgroundColor: 'var(--color-surface-primary)',
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        <div className="mb-6">
          <h2 
            className="text-2xl font-bold text-center mb-2" 
            style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}
          >
            Waitlist Procedures
          </h2>
          <p className="text-sm text-center font-medium" style={{ color: 'var(--color-status-warning)' }}>
            Please read and acknowledge to continue
          </p>
        </div>
        
        <div className="mb-8 space-y-4">
          {WAITLIST_PROCEDURES.map((text, i) => (
            <div key={i} className="flex gap-4 items-start">
              <div 
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
                style={{ 
                  backgroundColor: 'rgba(245,158,11,0.1)', 
                  color: 'var(--color-status-warning)' 
                }}
              >
                {i + 1}
              </div>
              <p className="text-base pt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {text}
              </p>
            </div>
          ))}
        </div>

        <button
          disabled={loading}
          onClick={() => void handleAgree()}
          className="w-full rounded-xl py-4 text-lg font-bold transition-transform active:scale-95"
          style={{
            backgroundColor: 'var(--color-status-success)',
            color: 'var(--color-surface-base)',
          }}
        >
          {loading ? 'Processing...' : 'Ok, I Understand'}
        </button>
      </div>
    </div>
  );
}
