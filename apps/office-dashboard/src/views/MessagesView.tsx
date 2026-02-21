import { useState } from 'react';
import { Button } from '@the-clubs/ui';

interface Message {
  id: string;
  from: string;
  subject: string;
  time: string;
  read: boolean;
  body: string;
}

const MESSAGES: Message[] = [
  {
    id: '1',
    from: 'System',
    subject: 'Low inventory alert',
    time: '1:30 PM',
    read: false,
    body: 'Towel inventory has fallen below the minimum threshold of 20 units. Current count is 12. Please restock at your earliest convenience to avoid shortages during peak hours.',
  },
  {
    id: '2',
    from: 'Admin',
    subject: 'Staff meeting tomorrow at 9 AM',
    time: '12:00 PM',
    read: false,
    body: 'Reminder: All staff are required to attend the weekly team meeting tomorrow at 9:00 AM in the break room. We will be discussing the new check-in flow updates, shift scheduling for next week, and a review of weekend performance metrics.',
  },
  {
    id: '3',
    from: 'System',
    subject: 'Shift change approved for Mike T.',
    time: '11:15 AM',
    read: true,
    body: 'The shift change request submitted by Mike T. has been approved. Original shift: 2:00 PM – 10:00 PM. New shift: 10:00 AM – 6:00 PM. Effective date: Tomorrow.',
  },
  {
    id: '4',
    from: 'System',
    subject: 'Daily report generated',
    time: '8:00 AM',
    read: true,
    body: 'The daily operations report for today has been generated and is ready for review. Summary: 47 check-ins, 38 check-outs, 3 active waitlist entries, $2,140 in total revenue collected. No incidents reported.',
  },
];

export function MessagesView() {
  const [messages, setMessages] = useState(MESSAGES);
  const [selected, setSelected] = useState<Message | null>(null);

  const unreadCount = messages.filter((m) => !m.read).length;

  const handleOpen = (msg: Message) => {
    // Mark as read when opened
    if (!msg.read) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m)),
      );
    }
    setSelected({ ...msg, read: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Messages</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {unreadCount} unread
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {messages.map((msg) => (
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
            onClick={() => handleOpen(msg)}
          >
            <div className="flex items-center gap-3">
              {!msg.read && (
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }} />
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

      {/* ── Message Detail Modal ── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelected(null)}
        >
          <div
            className="mx-4 flex w-full max-w-lg flex-col rounded-2xl border shadow-2xl"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              borderColor: 'var(--color-border-default)',
              boxShadow: '0 0 40px rgba(0, 212, 255, 0.08)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b px-6 pt-6 pb-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <h3
                className="text-base font-bold leading-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
                {selected.subject}
              </h3>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: 'var(--color-accent-primary)' }}>
                  From: {selected.from}
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {selected.time}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {selected.body}
              </p>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
