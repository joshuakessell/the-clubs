import { useState, useRef, useEffect } from 'react';

interface AddNoteModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (note: string, isImportant: boolean) => Promise<void>;
}

export function AddNoteModal({ isOpen, onClose, onSubmit }: AddNoteModalProps) {
  const [text, setText] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText('');
      setIsImportant(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, isImportant);
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
    >
      <button 
        className="absolute inset-0 w-full h-full cursor-default" 
        onClick={onClose} 
        aria-label="Close dialog" 
        style={{ background: 'transparent', border: 'none' }}
      />
      <div
        className="relative z-10 flex flex-col gap-4 rounded-xl border p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-note-title"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-default)',
          maxWidth: '440px',
          width: '100%',
        }}
      >
        {/* Header */}
        <h3
          id="add-note-title"
          className="text-base font-bold font-(--font-display) text-(--color-text-primary)"
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
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
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
        <div className="flex justify-between items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--color-text-primary)' }}>
            <input 
              type="checkbox" 
              checked={isImportant} 
              onChange={(e) => setIsImportant(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-bold text-red-500">⚠️ Mark Important</span>
          </label>
          <div className="flex justify-end gap-2">
            <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold transition-colors"
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
    </div>
  );
}
