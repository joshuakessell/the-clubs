interface Props {
  onDone: () => void;
}

export function CompleteScreen({ onDone }: Props) {
  return (
    <div className="flex flex-col items-center gap-6 p-12 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '2px solid var(--color-status-success)' }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <div>
        <h2 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          All Set!
        </h2>
        <p className="mt-2 text-base" style={{ color: 'var(--color-text-secondary)' }}>
          You're checked in. Enjoy your visit!
        </p>
      </div>

      <button
        onClick={onDone}
        className="mt-4 rounded-xl px-8 py-3 text-sm font-bold transition-all"
        style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}
      >
        Done
      </button>
    </div>
  );
}
