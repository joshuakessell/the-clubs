import { useState, useEffect, type FormEvent } from 'react';
import { useAuthStore, type StaffSession } from '../stores/authStore';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

interface LockScreenProps {
  appTitle?: string;
  onLogin?: (session: StaffSession) => void;
}

export function LockScreen({ appTitle = 'Operations', onLogin }: LockScreenProps) {
  const { deviceId, setSession } = useAuthStore();
  const [staffLookup, setStaffLookup] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Auto-focus the name input
  useEffect(() => {
    const el = document.getElementById('staff-lookup');
    el?.focus();
  }, []);

  const handlePinSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!staffLookup.trim() || !pin.trim()) {
      setError('Please enter your name/ID and PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffLookup: staffLookup.trim(),
          deviceId,
          pin: pin.trim(),
        }),
      });

      if (!response.ok) {
        const payload: any = await response.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || 'Login failed');
      }

      const data: any = await response.json();
      const session: StaffSession = {
        staffId: data.staffId,
        name: data.name,
        role: data.role,
        sessionToken: data.sessionToken,
        mustChangePin: data.mustChangePin,
      };

      setSession(session);
      onLogin?.(session);
      setPin('');
      setStaffLookup('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex" style={{ backgroundColor: 'var(--color-surface-base)' }}>
      {/* Left: Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-sm">
          {/* Logo + Title */}
          <div className="mb-10">
            <div className="mb-4 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--color-accent-glow)', border: '1px solid var(--color-border-accent)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                The Clubs
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              Staff Login
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Sign in to {appTitle}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4 rounded-lg border px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderColor: 'rgba(239, 68, 68, 0.2)',
                color: 'var(--color-status-error)',
              }}
            >
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={(e) => void handlePinSubmit(e)} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="staff-lookup"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Name or Staff ID
              </label>
              <input
                id="staff-lookup"
                type="text"
                value={staffLookup}
                onChange={(e) => setStaffLookup(e.target.value)}
                disabled={isLoading}
                placeholder="Enter your name or ID"
                className="h-11 w-full rounded-lg border px-4 text-sm transition-all duration-200"
                style={{
                  backgroundColor: 'var(--color-surface-input)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="pin-input"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                PIN
              </label>
              <input
                id="pin-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
                placeholder="••••••"
                className="h-11 w-full rounded-lg border px-4 text-sm tracking-[0.3em] transition-all duration-200"
                style={{
                  backgroundColor: 'var(--color-surface-input)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-display)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !staffLookup.trim() || pin.length < 4}
              className="mt-2 h-11 w-full rounded-lg text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Right: Branding Panel */}
      <div
        className="relative hidden w-[45%] items-center justify-center overflow-hidden lg:flex"
        style={{ backgroundColor: 'var(--color-surface-raised)' }}
      >
        {/* Grid pattern background */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(var(--color-accent-primary) 1px, transparent 1px),
              linear-gradient(90deg, var(--color-accent-primary) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Glow effect */}
        <div
          className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
          style={{ backgroundColor: 'var(--color-accent-glow)' }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-8 px-12 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'rgba(0, 212, 255, 0.05)',
              border: '1px solid var(--color-border-accent)',
              boxShadow: '0 0 40px var(--color-accent-glow)',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          <div>
            <h2
              className="text-3xl font-extrabold tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
            >
              The Clubs
            </h2>
            <p className="mt-2 text-base" style={{ color: 'var(--color-text-muted)' }}>
              {appTitle}
            </p>
          </div>

          <div className="h-px w-20" style={{ background: 'linear-gradient(to right, transparent, var(--color-border-strong), transparent)' }} />

          <p className="max-w-[280px] text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Manage check-ins, rentals, upgrades, and customer accounts — all from one place.
          </p>
        </div>
      </div>
    </div>
  );
}
