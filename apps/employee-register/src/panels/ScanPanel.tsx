import { useRef, useState } from 'react';
import { Badge, Button, Spinner } from '@the-clubs/ui';
import { useAuthStore } from '@the-clubs/ui';
import { getApiUrl } from '@the-clubs/shared';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

export function ScanPanel() {
  const scanInputRef = useRef<HTMLTextAreaElement>(null);
  const {
    currentSessionId,
    customerName,
    selectNavTab,
    scanReady,
    scanBlockedReason,
    scanInputEnabled,
    scanCaptureSubmitting,
    setScanCaptureSubmitting,
    openCustomerAccount,
    laneId,
  } = useRegisterStore();

  const token = useAuthStore((s) => s.session?.sessionToken);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScanSubmit = async () => {
    const rawText = scanInputRef.current?.value?.trim();
    if (!rawText) return;

    setScanCaptureSubmitting(true);
    setScanError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/checkin/scan'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawScanText: rawText, registerId: laneId }),
      });

      const data = await res.json();

      if (data.result === 'MATCHED' && data.customer) {
        // Customer found — open their account and start check-in
        if (scanInputRef.current) scanInputRef.current.value = '';
        openCustomerAccount(data.customer.id, data.customer.name, {
          autoStart: true,
          authToken: token,
        });
      } else if (data.result === 'NO_MATCH') {
        setScanError('No matching customer found. Try Manual Entry.');
        // Navigate to manual entry tab after a brief delay so staff can see the message
        setTimeout(() => selectNavTab('manual'), 1500);
      } else if (data.result === 'ERROR') {
        setScanError(data.error?.message ?? 'Scan error');
      } else {
        setScanError('Unexpected response from scan');
      }
    } catch {
      setScanError('Network error processing scan');
    } finally {
      setScanCaptureSubmitting(false);
    }
  };

  return (
    <PanelShell align="top">
      {/* Header */}
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-4xl" aria-hidden="true">📷</span>
        <PanelHeader
          align="center"
          spacing="sm"
          title="Scan Now"
          subtitle="Scan a membership ID or Driver Licence."
        />
      </div>

      {/* Demo badge */}
      <div className="mt-3 flex justify-center">
        <Badge color="info" variant="light" size="sm">
          LIVE MODE
        </Badge>
      </div>

      {/* Scanner input */}
      <label
        className="mt-4 block text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-text-muted)' }}
        htmlFor="scan-input-area"
      >
        Scanner Input
      </label>
      <textarea
        id="scan-input-area"
        ref={scanInputRef}
        data-scan-capture
        className="mt-1 w-full resize-none rounded-lg border p-3 font-mono text-sm"
        style={inputStyle}
        aria-label="Scanner input"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        disabled={!scanInputEnabled}
        placeholder="Scan or type code here…"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleScanSubmit();
          }
        }}
      />

      {/* Submit button */}
      <Button
        fullWidth
        className="mt-2"
        disabled={scanCaptureSubmitting}
        onClick={() => void handleScanSubmit()}
      >
        {scanCaptureSubmitting ? 'Processing…' : 'Submit Scan'}
      </Button>

      {/* Processing overlay */}
      {scanCaptureSubmitting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-lg"
          style={{ backgroundColor: 'rgba(10, 10, 15, 0.7)' }}
        >
          <div className="flex items-center gap-3 rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
          >
            <Spinner size="md" />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Processing scan…
            </span>
          </div>
        </div>
      ) : null}

      {/* Error message */}
      {scanError && (
        <p className="mt-2 text-center text-xs font-medium" style={{ color: 'var(--color-status-error)' }}>
          {scanError}
        </p>
      )}

      {/* Status text */}
      <p className="mt-3 text-center text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
        {scanReady
          ? scanCaptureSubmitting
            ? 'Processing scan…'
            : 'Scanner ready'
          : `Scanner paused: ${scanBlockedReason || 'Unavailable'}`}
      </p>

      {/* Active session CTA */}
      {currentSessionId && customerName ? (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            Active lane session:{' '}
            <span style={{ color: 'var(--color-text-primary)' }}>{customerName}</span>
          </p>
          <Button fullWidth onClick={() => selectNavTab('account')}>
            Open Customer Account
          </Button>
        </div>
      ) : null}
    </PanelShell>
  );
}
