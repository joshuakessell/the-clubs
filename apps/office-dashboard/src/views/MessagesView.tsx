const MESSAGES = [
  { id: '1', from: 'System', subject: 'Low inventory alert', time: '1:30 PM', read: false },
  { id: '2', from: 'Admin', subject: 'Staff meeting tomorrow at 9 AM', time: '12:00 PM', read: false },
  { id: '3', from: 'System', subject: 'Shift change approved for Mike T.', time: '11:15 AM', read: true },
  { id: '4', from: 'System', subject: 'Daily report generated', time: '8:00 AM', read: true },
];

export function MessagesView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Messages</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {MESSAGES.filter((m) => !m.read).length} unread
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {MESSAGES.map((msg) => (
          <button
            key={msg.id}
            type="button"
            className="flex items-center justify-between rounded-xl border p-4 text-left transition"
            style={{
              backgroundColor: msg.read ? 'transparent' : 'var(--color-surface-raised)',
              borderColor: msg.read ? 'var(--color-border-subtle)' : 'var(--color-border-default)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = msg.read ? 'var(--color-border-subtle)' : 'var(--color-border-default)'; }}
          >
            <div className="flex items-center gap-3">
              {!msg.read && (
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }} />
              )}
              <div>
                <p className="text-sm font-semibold" style={{ color: msg.read ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}>{msg.subject}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>From: {msg.from}</p>
              </div>
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{msg.time}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
