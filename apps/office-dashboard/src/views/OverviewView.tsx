export function OverviewView() {
  return (
    <div
      className="rounded-xl border p-6"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border-default)',
      }}
    >
      <h2
        className="text-lg font-semibold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
      >
        Overview
      </h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        View content will be built here.
      </p>
    </div>
  );
}
