interface NoteItem {
  id: string;
  note: string;
  createdAt: string;
  createdByStaffName: string;
  sourceApp: string;
  isImportant: boolean;
}

interface AllNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: NoteItem[];
  loading: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sourceLabel(src: string): string {
  switch (src) {
    case 'EMPLOYEE_REGISTER': return 'Register';
    case 'OFFICE_DASHBOARD': return 'Dashboard';
    case 'CUSTOMER_KIOSK': return 'Kiosk';
    case 'SYSTEM': return 'System';
    default: return src;
  }
}

export function AllNotesModal({ isOpen, onClose, notes, loading }: AllNotesModalProps) {
  if (!isOpen) return null;

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
          maxWidth: '640px',
          width: '100%',
          maxHeight: '70vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3
            className="text-base font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            All Notes
          </h3>
          <button
            onClick={onClose}
            className="text-lg leading-none px-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div
          className="flex-1 overflow-y-auto rounded-lg border"
          style={{
            borderColor: 'var(--color-border-subtle)',
            scrollbarWidth: 'thin',
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading notes…</span>
            </div>
          ) : notes.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>No notes on this account.</span>
            </div>
          ) : (
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--color-surface-overlay)',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <th
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)', width: '110px' }}
                  >
                    Date
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Note
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)', width: '120px' }}
                  >
                    Staff
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)', width: '80px' }}
                  >
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr
                    key={n.id}
                    style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                      <div className="text-xs">{formatDate(n.createdAt)}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>{formatTime(n.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                      <div className="flex items-start gap-1.5">
                        {n.isImportant && <span className="text-xs flex-shrink-0">⚠️</span>}
                        <span>{n.note}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {n.createdByStaffName}
                    </td>
                    <td className="px-3 py-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {sourceLabel(n.sourceApp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
