import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { AddNoteModal } from './AddNoteModal';
import { AllNotesModal } from './AllNotesModal';

interface NoteItem {
  id: string;
  note: string;
  createdAt: string;
  createdByStaffName: string;
  sourceApp: string;
  isImportant: boolean;
}

interface CustomerNotesBarProps {
  customerId: string;
}

export function CustomerNotesBar({ customerId }: CustomerNotesBarProps) {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [latestNote, setLatestNote] = useState<NoteItem | null>(null);
  const [allNotes, setAllNotes] = useState<NoteItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAllModal, setShowAllModal] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [version, setVersion] = useState(0); // bump to re-fetch

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  // Fetch most recent note
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          getApiUrl(`/api/v1/customers/${encodeURIComponent(customerId)}/notes?limit=1`),
          { headers: headers() },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setLatestNote(data.notes?.[0] ?? null);
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, token, version, headers]);

  // Fetch all notes when the all-notes modal opens
  const openAllNotes = useCallback(async () => {
    setShowAllModal(true);
    setLoadingAll(true);
    try {
      const res = await fetch(
        getApiUrl(`/api/v1/customers/${encodeURIComponent(customerId)}/notes?limit=100`),
        { headers: headers() },
      );
      if (res.ok) {
        const data = await res.json();
        setAllNotes(data.notes ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingAll(false);
    }
  }, [customerId, headers]);

  // Submit a new note
  const handleAddNote = useCallback(async (note: string) => {
    const res = await fetch(
      getApiUrl(`/api/v1/customers/${encodeURIComponent(customerId)}/notes`),
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    setVersion((v) => v + 1); // refresh latest note
  }, [customerId, headers]);

  const previewText = latestNote
    ? latestNote.note.length > 60
      ? `${latestNote.note.slice(0, 57)}…`
      : latestNote.note
    : 'No notes yet';

  return (
    <>
      <div
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
        style={{
          backgroundColor: 'var(--color-surface-overlay)',
          borderColor: 'var(--color-border-subtle)',
          minHeight: '32px',
        }}
      >
        {/* Left: clickable "Notes:" label + preview */}
        <button
          onClick={() => void openAllNotes()}
          className="flex items-center gap-1.5 text-left min-w-0 flex-1 group"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <span
            className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
            style={{
              color: 'var(--color-accent-primary)',
              textDecoration: 'underline',
              textDecorationColor: 'transparent',
              transition: 'text-decoration-color 0.15s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecorationColor = 'var(--color-accent-primary)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecorationColor = 'transparent'; }}
          >
            Notes:
          </span>
          <span
            className="text-xs truncate"
            style={{
              color: latestNote ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
              fontStyle: latestNote ? 'normal' : 'italic',
            }}
          >
            {previewText}
          </span>
          {latestNote && (
            <span
              className="text-[10px] flex-shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              — {latestNote.createdByStaffName}
            </span>
          )}
        </button>

        {/* Right: + button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold flex-shrink-0 transition"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
            lineHeight: 1,
            cursor: 'pointer',
            border: 'none',
          }}
          title="Add note"
        >
          +
        </button>
      </div>

      {/* Modals */}
      <AddNoteModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddNote}
      />
      <AllNotesModal
        isOpen={showAllModal}
        onClose={() => setShowAllModal(false)}
        notes={allNotes}
        loading={loadingAll}
      />
    </>
  );
}
