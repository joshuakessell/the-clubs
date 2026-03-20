import { useState, useEffect } from 'react';

const REGISTERS = [
  { slug: 'lane-1', number: 1, label: 'Register 1', description: 'Standard Check-in' },
  { slug: 'lane-2', number: 2, label: 'Register 2', description: 'Standard Check-in' },
  { slug: 'lane-3', number: 3, label: 'Register 3', description: 'Upgrades & Renewals' },
];

/**
 * RegisterSelectScreen — Shown after staff login, before AppLayout.
 * Lets the employee pick which register this browser instance operates.
 * Navigates to /lane-1, /lane-2, or /lane-3.
 */
export function RegisterSelectScreen() {
  const [activeTheme, setActiveTheme] = useState(
    () => document.documentElement.dataset.theme ?? '',
  );

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setActiveTheme(document.documentElement.dataset.theme ?? ''),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const isLightTheme = ['theme-arctic-bloom', 'theme-solar-flare'].includes(activeTheme);

  const applyHoverStyle = (el: HTMLElement) => {
    el.style.backgroundColor =
      'color-mix(in oklch, var(--color-accent-primary) 12%, transparent)';
    el.style.boxShadow = '0 0 24px var(--color-accent-glow)';
  };

  const removeHoverStyle = (el: HTMLElement) => {
    el.style.backgroundColor =
      'color-mix(in oklch, var(--color-accent-primary) 4%, transparent)';
    el.style.boxShadow = 'none';
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: 'var(--color-surface-base)' }}
    >
      <div className="flex flex-col items-center gap-10 text-center p-12">
        {/* Logo */}
        <div className="relative">
          <div
            className="absolute inset-6 rounded-full animate-pulse"
            style={{ boxShadow: '0 0 30px 10px var(--color-accent-glow)', opacity: 0.15 }}
          />
          <div className="relative flex items-center justify-center">
            <img
              src={isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg'}
              alt="Club Dallas"
              width="160"
              height="160"
              style={{ width: 200, height: 200, filter: 'drop-shadow(0 0 6px var(--color-accent-glow))' }}
            />
          </div>
        </div>

        {/* Title */}
        <div>
          <h1
            className="text-4xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            Select Register
          </h1>
          <p className="mt-3 text-base" style={{ color: 'var(--color-text-muted)' }}>
            Choose the register this terminal will operate.
          </p>
        </div>

        {/* Register buttons */}
        <div className="flex flex-col gap-4 w-full max-w-xs">
          {REGISTERS.map((reg) => (
            <a
              key={reg.slug}
              href={`/${reg.slug}`}
              className="flex items-center justify-between gap-3 rounded-xl border-2 px-8 py-5 text-lg font-bold transition-all duration-200"
              style={{
                borderColor: 'var(--color-border-accent)',
                color: 'var(--color-accent-primary)',
                backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 4%, transparent)',
              }}
              onMouseOver={(e) => applyHoverStyle(e.currentTarget)}
              onFocus={(e) => applyHoverStyle(e.currentTarget)}
              onMouseOut={(e) => removeHoverStyle(e.currentTarget)}
              onBlur={(e) => removeHoverStyle(e.currentTarget)}
            >
              <span>{reg.label}</span>
              <span
                className="text-xs font-normal"
                style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
              >
                {reg.description}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
