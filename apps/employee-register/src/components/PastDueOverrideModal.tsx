import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore, PinInput } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';

interface PastDueOverrideModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly balanceAmount: number;
}

/**
 * PastDueOverrideModal — PIN confirmation modal for overriding past-due balance.
 *
 * Uses native <dialog> element for accessibility. Prompts the staff member
 * to enter their own PIN to authorize removal of the customer's past-due balance.
 */
export function PastDueOverrideModal({ open, onClose, balanceAmount }: PastDueOverrideModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const token = useAuthStore((s) => s.session?.sessionToken);
  const laneId = useRegisterStore((s) => s.laneId);
  const setToast = useRegisterStore((s) => s.setSuccessToastMessage);

  // Open/close the native dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Handle native close event (e.g. Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = () => onClose();
    dialog.addEventListener('close', handler);
    return () => dialog.removeEventListener('close', handler);
  }, [onClose]);

  const handlePinSubmit = useCallback(async (pin: string) => {
    if (pin.length !== 6) {
      setError('PIN must be 6 digits');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (!laneId) return;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/past-due/bypass`),
        { method: 'POST', headers, body: JSON.stringify({ pin }) }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = res.status === 401 ? 'Incorrect PIN. Please try again.' : (data.error ?? `Failed (${res.status})`);
        setError(msg);
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setToast('Past-due balance removed successfully');
      onClose();
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }, [token, laneId, setToast, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="w-full max-w-sm rounded-2xl border p-6 backdrop:bg-black/60"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border-default)',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        color: 'inherit',
      }}
      aria-label="Override Past Due Balance"
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 12%, transparent)',
          }}
        >
          ⚠️
        </div>
        <div>
          <h3 className="text-base font-bold text-(--color-text-primary)">
            Override Past Due Balance
          </h3>
          <p className="text-xs text-(--color-text-muted)">
            ${balanceAmount.toFixed(2)} outstanding
          </p>
        </div>
      </div>

      {/* Warning notice */}
      <div
        className="mb-4 rounded-lg px-3 py-2 text-sm"
        style={{
          backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)',
          border: '1px solid color-mix(in oklch, var(--color-status-warning) 15%, transparent)',
          color: 'var(--color-status-warning)',
        }}
      >
        Management approval is required. This action will be logged for review.
      </div>

      {/* PIN label */}
      <p
        className="mb-3 text-center text-xs font-bold uppercase tracking-widest"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Enter your PIN to confirm
      </p>

      {/* PIN Input — matches the sign-in screen format */}
      <PinInput
        length={6}
        disabled={submitting}
        onSubmit={(pin) => void handlePinSubmit(pin)}
        submitLabel={submitting ? 'Verifying…' : 'Confirm Override'}
        submitDisabled={submitting}
      />

      {/* Error message */}
      {error && (
        <p className="mt-3 text-center text-sm font-semibold" style={{ color: 'var(--color-status-error)' }}>
          {error}
        </p>
      )}

      {/* Cancel button */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={onClose}
          disabled={submitting}
          className="rounded-lg border px-6 py-2.5 text-sm font-semibold transition-colors"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-secondary)',
          }}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
