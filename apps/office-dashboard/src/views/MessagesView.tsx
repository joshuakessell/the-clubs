import { useState, useCallback } from 'react';
import { Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface Message {
  id: string;
  from: string;
  subject: string;
  time: string;
  read: boolean;
  body: string;
}

export function MessagesView() {
  const { data, loading, error, refetch } = useDashboardFetch<{ messages: Message[] }>(
    '/api/v1/admin/messages',
  );
  const messages = data?.messages ?? [];
  const unreadCount = messages.filter((m) => !m.read).length;

  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

  const handleOpen = useCallback(async (msg: Message) => {
    if (!msg.read) {
      try {
        await dashboardMutate(`/api/v1/admin/messages/${msg.id}/read`, 'PATCH');
        refetch();
      } catch { /* ignore */ }
    }
    setSelectedMessage(msg);
  }, [refetch]);

  return (
    <div className= "flex flex-col gap-6" >
    <div className="rounded-xl border p-6" style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }
}>
  <div className="flex items-center justify-between" >
    <div>
    <h2 className="text-lg font-bold" style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}> Messages </h2>
      < p className = "text-sm" style = {{ color: 'var(--color-text-muted)' }}>
        { unreadCount } unread
          </p>
          </div>
          < Button size = "sm" variant = "outline" onClick = {() => refetch()}> Refresh </Button>
            </div>
            </div>

{
  error && (
    <div className="rounded-lg border px-4 py-3 text-sm" style = {{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--color-status-error)' }
}>
  { error }
  </div>
      )}

{
  loading && messages.length === 0 ? (
    <ViewSpinner />
      ) : messages.length === 0 ? (
  <div className= "rounded-xl border p-8 text-center" style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
    <p className="text-sm" style = {{ color: 'var(--color-text-muted)' }}> No messages </p>
      </div>
      ) : (
  <div className= "flex flex-col gap-2" >
  {
    messages.map((msg) => (
      <button
              key= { msg.id }
              type = "button"
              className = "flex items-center justify-between rounded-xl border p-4 text-left transition"
              style = {{
      backgroundColor: msg.read ? 'transparent' : 'var(--color-surface-raised)',
      borderColor: msg.read ? 'var(--color-border-subtle)' : 'var(--color-border-default)',
    }}
onMouseEnter = {(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
onMouseLeave = {(e) => { (e.currentTarget as HTMLElement).style.borderColor = msg.read ? 'var(--color-border-subtle)' : 'var(--color-border-default)'; }}
onClick = {() => handleOpen(msg)}
            >
  <div className="flex items-center gap-3" >
    {!msg.read && (
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style = {{ backgroundColor: 'var(--color-accent-primary)' }} />
                )}
<div>
  <p className="text-sm font-semibold" style = {{ color: msg.read ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}> { msg.subject } </p>
    < p className = "text-xs" style = {{ color: 'var(--color-text-muted)' }}> From: { msg.from } </p>
      </div>
      </div>
      < span className = "text-xs tabular-nums" style = {{ color: 'var(--color-text-muted)' }}>
        { new Date(msg.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
        </span>
        </button>
          ))}
</div>
      )}

{/* ── Message Detail Modal ── */ }
{
  selectedMessage && (
    <div
          className="fixed inset-0 z-50 flex items-center justify-center"
  style = {{ backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }
}
onClick = {() => setSelectedMessage(null)}
        >
  <div
            className="mx-4 flex w-full max-w-lg flex-col rounded-2xl border shadow-2xl"
style = {{
  backgroundColor: 'var(--color-surface-raised)',
    borderColor: 'var(--color-border-default)',
      boxShadow: '0 0 40px rgba(0, 212, 255, 0.08)',
            }}
onClick = {(e) => e.stopPropagation()}
          >
  {/* Header */ }
  < div className = "border-b px-6 pt-6 pb-4" style = {{ borderColor: 'var(--color-border-subtle)' }}>
    <h3
                className="text-base font-bold leading-tight"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
  { selectedMessage.subject }
  </h3>
  < div className = "mt-2 flex items-center gap-3" >
    <span className="text-xs font-semibold" style = {{ color: 'var(--color-accent-primary)' }}>
      From: { selectedMessage.from }
</span>
  < span className = "text-xs tabular-nums" style = {{ color: 'var(--color-text-muted)' }}>
    { new Date(selectedMessage.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
    </span>
    </div>
    </div>

{/* Body */ }
<div className="px-6 py-5" >
  <p className="text-sm leading-relaxed" style = {{ color: 'var(--color-text-secondary)' }}>
    { selectedMessage.body }
    </p>
    </div>

{/* Footer */ }
<div className="border-t px-6 py-4" style = {{ borderColor: 'var(--color-border-subtle)' }}>
  <Button variant="outline" size = "sm" onClick = {() => setSelectedMessage(null)}>
    Close
    </Button>
    </div>
    </div>
    </div>
      )}
</div>
  );
}
