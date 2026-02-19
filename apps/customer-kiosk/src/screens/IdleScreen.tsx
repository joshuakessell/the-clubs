interface Props {
  onStart: () => void;
}

export function IdleScreen({ onStart }: Props) {
  return (
    <div className="flex flex-col items-center gap-8 text-center p-12">
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
        <h1
          className="text-4xl font-extrabold tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
        >
          Welcome
        </h1>
        <p className="mt-3 text-lg" style={{ color: 'var(--color-text-secondary)' }}>
          Tap to check in or sign up
        </p>
      </div>

      <button
        onClick={onStart}
        className="mt-4 rounded-xl px-12 py-4 text-lg font-bold transition-all duration-200"
        style={{
          backgroundColor: 'var(--color-accent-primary)',
          color: 'var(--color-text-inverse)',
          boxShadow: '0 0 20px var(--color-accent-glow)',
        }}
      >
        Get Started
      </button>
    </div>
  );
}
