import { useState, useRef, useEffect } from 'react';

interface AddNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}

export function AddNoteModal({ isOpen, onClose, onSubmit }: AddNoteModalProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText('');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col gap-4 rounded-xl border p-5 shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-default)',
          maxWidth: '440px',
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h3
          className="text-base font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
        >
          Add Note
        </h3>

        {/* Text area */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a note about this customer…"
          rows={4}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition"
          style={{
            backgroundColor: 'var(--color-surface-input)',
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-body)',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              void handleSubmit();
            }
          }}
        />

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
            style={{
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
              backgroundColor: 'transparent',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold transition"
            style={{
              backgroundColor: text.trim() && !submitting ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: text.trim() && !submitting ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              cursor: text.trim() && !submitting ? 'pointer' : 'not-allowed',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}
