interface Props {
  onNext: () => void;
  onCancel: () => void;
}

export function SelectionScreen({ onNext, onCancel }: Props) {
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 p-8">
      <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
        Selection
      </h2>
      <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
        Choose your membership type and room preference.
      </p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="rounded-lg border px-6 py-2.5 text-sm font-medium"
          style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}>Cancel</button>
        <button onClick={onNext} className="rounded-lg px-6 py-2.5 text-sm font-bold"
          style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}>Continue</button>
      </div>
    </div>
  );
}
