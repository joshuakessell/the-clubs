import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useAuthStore } from '../stores/authStore';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
const PIN_LENGTH = 6;

type Step = 'enter' | 'confirm';

export function ChangePinScreen() {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = useState<Step>('enter');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  const clearDigits = useCallback(() => {
    setDigits(['', '', '', '', '', '']);
    setTimeout(() => pinRefs.current[0]?.focus(), 30);
  }, []);

  // Auto-focus first input on mount and step change
  useEffect(() => {
    setTimeout(() => pinRefs.current[0]?.focus(), 100);
  }, [step]);

  const handleSubmit = useCallback(async (pin: string) => {
    if (step === 'enter') {
      setFirstPin(pin);
      setStep('confirm');
      setDigits(['', '', '', '', '', '']);
      setError(null);
      return;
    }

    // step === 'confirm'
    if (pin !== firstPin) {
      setError('PINs do not match. Please try again.');
      setFirstPin('');
      setStep('enter');
      clearDigits();
      return;
    }

    // PINs match — submit to server
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/change-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.sessionToken}`,
        },
        body: JSON.stringify({ newPin: pin, confirmPin: pin }),
      });

      if (!response.ok) {
        const payload: any = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to change PIN');
      }

      // Success — clear mustChangePin from session
      if (session) {
        setSession({ ...session, mustChangePin: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change PIN');
      setFirstPin('');
      setStep('enter');
      clearDigits();
    } finally {
      setIsLoading(false);
    }
  }, [step, firstPin, session, setSession, clearDigits]);

  const submitRef = useRef<(pin: string) => void>(() => {});
  submitRef.current = (pin: string) => void handleSubmit(pin);

  const handleDigitChange = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      if (digit && index === PIN_LENGTH - 1 && next.every((d) => d !== '')) {
        setTimeout(() => submitRef.current(next.join('')), 0);
      }
      return next;
    });
    if (digit && index < PIN_LENGTH - 1) {
      pinRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleDigitKeyDown = useCallback((index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = '';
        } else if (index > 0) {
          next[index - 1] = '';
          setTimeout(() => pinRefs.current[index - 1]?.focus(), 0);
        }
        return next;
      });
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      pinRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      e.preventDefault();
      pinRefs.current[index + 1]?.focus();
    }
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]!;
    setDigits(next);
    const focusIdx = Math.min(pasted.length, PIN_LENGTH - 1);
    setTimeout(() => pinRefs.current[focusIdx]?.focus(), 0);
    if (pasted.length === PIN_LENGTH) {
      setTimeout(() => submitRef.current(pasted), 0);
    }
  }, []);

  const title = step === 'enter' ? 'Choose a New PIN' : 'Confirm Your PIN';
  const subtitle = step === 'enter'
    ? 'Enter a new 6-digit PIN for your account'
    : 'Re-enter your PIN to confirm';

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--color-surface-base)' }}
    >
      <div className="w-full max-w-sm px-6">
        {/* Lock icon */}
        <div className="mb-8 flex justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'var(--color-accent-glow)',
              border: '1px solid var(--color-border-accent)',
            }}
          >
            <svg
              width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="var(--color-accent-primary)" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <div className="mb-8 text-center">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            {title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {subtitle}
          </p>
          {session?.name && (
            <p className="mt-1 text-sm font-medium" style={{ color: 'var(--color-accent-primary)' }}>
              Signed in as {session.name}
            </p>
          )}
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
            style={{
              backgroundColor: 'var(--color-accent-primary)',
              color: '#fff',
            }}
          >
            1
          </div>
          <div
            className="h-px w-8"
            style={{ backgroundColor: step === 'confirm' ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}
          />
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
            style={{
              backgroundColor: step === 'confirm' ? 'var(--color-accent-primary)' : 'var(--color-surface-raised)',
              color: step === 'confirm' ? '#fff' : 'var(--color-text-muted)',
              border: step === 'confirm' ? 'none' : '1px solid var(--color-border-default)',
            }}
          >
            2
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 text-center text-sm"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              borderColor: 'rgba(239, 68, 68, 0.2)',
              color: 'var(--color-status-error)',
            }}
          >
            {error}
          </div>
        )}

        {/* PIN digits */}
        <div className="flex items-center justify-between gap-2">
          {digits.map((digit, i) => (
            <input
              key={`${step}-${i}`}
              ref={(el) => { pinRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleDigitKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              onFocus={(e) => e.target.select()}
              disabled={isLoading}
              aria-label={`PIN digit ${i + 1}`}
              className="h-14 w-14 rounded-lg border text-center text-xl font-bold transition-all duration-200 outline-none"
              style={{
                backgroundColor: 'var(--color-surface-input)',
                borderColor: digit ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-display)',
                boxShadow: digit ? '0 0 0 1px var(--color-accent-glow)' : 'none',
                caretColor: 'transparent',
                ...({ WebkitTextSecurity: 'disc' } as React.CSSProperties),
              }}
            />
          ))}
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Saving PIN…</span>
          </div>
        )}
      </div>
    </div>
  );
}
