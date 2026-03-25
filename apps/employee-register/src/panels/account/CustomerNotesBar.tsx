import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { AddNoteModal } from './AddNoteModal';

interface NoteItem {
  id: string;
  note: string;
  createdAt: string;
  createdByStaffName: string;
  sourceApp: string;
  isImportant: boolean;
}

interface CustomerNotesBarProps {
  readonly customerId: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function CustomerNotesBar({ customerId }: CustomerNotesBarProps) {
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [allNotes, setAllNotes] = useState<NoteItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [version, setVersion] = useState(0); 

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          getApiUrl(`/api/v1/customers/${encodeURIComponent(customerId)}/notes?limit=100`),
          { headers: headers() },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setAllNotes(data.notes ?? []);
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, token, version, headers]);

  const handleAddNote = useCallback(async (note: string, isImportant: boolean) => {
    const res = await fetch(
      getApiUrl(`/api/v1/customers/${encodeURIComponent(customerId)}/notes`),
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, isImportant }),
      },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    setVersion((v) => v + 1); 
  }, [customerId, headers]);

  if (allNotes.length === 0) {
    return (
      <>
        <div className="flex items-center justify-between mt-4 mb-2">
          <h3 className="text-sm font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>Customer Notes (0)</h3>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold flex-shrink-0 transition-colors"
            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)', lineHeight: 1, cursor: 'pointer', border: 'none' }}
          >
            +
          </button>
        </div>
        <div className="text-xs italic text-(--color-text-muted) px-2">No notes available.</div>
        <AddNoteModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleAddNote} />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mt-4 mb-2">
         <h3 className="text-sm font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>Customer Notes ({allNotes.length})</h3>
         <button
            onClick={() => setShowAddModal(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold flex-shrink-0 transition-colors pt-0.5"
            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)', lineHeight: 1, cursor: 'pointer', border: 'none' }}
          >
            +
          </button>
      </div>

      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {allNotes.map(n => {
          const isImp = n.isImportant;
          return (
            <div 
              key={n.id} 
              className={`flex flex-col gap-1 rounded-lg border p-3 transition-colors`}
              style={{
                backgroundColor: isImp
                  ? 'color-mix(in oklch, var(--color-status-error) 10%, var(--color-surface-overlay))'
                  : 'var(--color-surface-overlay)',
                borderColor: isImp
                  ? 'color-mix(in oklch, var(--color-status-error) 40%, var(--color-border-subtle))'
                  : 'var(--color-border-subtle)',
              }}
            >
              <div className="flex items-start justify-between">
                <span className="text-xs font-bold" style={{ color: isImp ? 'var(--color-status-error)' : 'var(--color-text-primary)' }}>
                  {isImp && <span className="mr-1">⚠️</span>}
                  {n.createdByStaffName}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {formatDate(n.createdAt)} {formatTime(n.createdAt)}
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap' }}>
                {n.note}
              </p>
            </div>
          );
        })}
      </div>

      <AddNoteModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleAddNote} />
    </>
  );
}
