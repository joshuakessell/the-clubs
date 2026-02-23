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

/** Convert ISO date (YYYY-MM-DD) to MMDDYYYY digits for the manual entry form */
function isoToMmDdYyyyDigits(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}${d}${y}`;
}

interface Candidate {
  id: string;
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  matchScore: number;
}

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
    setManualFirstName,
    setManualLastName,
    setManualDobDigits,
    setManualIdType,
    setManualIdNumber,
    setManualIdExpirationDigits,
  } = useRegisterStore();

  const token = useAuthStore((s) => s.session?.sessionToken);
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pendingScanData, setPendingScanData] = useState<any>(null);

  /** Prefill the manual entry form and navigate to firstTime tab */
  const prefillAndNavigate = (opts: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    idType?: string;
    idNumber?: string;
    idExpiration?: string;
  }) => {
    if (opts.firstName) setManualFirstName(opts.firstName);
    if (opts.lastName) setManualLastName(opts.lastName);
    if (opts.dob) setManualDobDigits(isoToMmDdYyyyDigits(opts.dob));
    if (opts.idType) setManualIdType(opts.idType);
    if (opts.idNumber) setManualIdNumber(opts.idNumber);
    if (opts.idExpiration) setManualIdExpirationDigits(isoToMmDdYyyyDigits(opts.idExpiration));
    if (scanInputRef.current) scanInputRef.current.value = '';
    selectNavTab('firstTime');
  };

  const handleScanSubmit = async () => {
    const rawText = scanInputRef.current?.value?.trim();
    if (!rawText) return;

    setScanCaptureSubmitting(true);
    setScanError(null);
    setCandidates(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/checkin/scan'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawScanText: rawText, laneId }),
      });

      const data = await res.json();

      if (data.result === 'MATCHED' && data.customer) {
        // Customer found — open their account and start check-in
        if (scanInputRef.current) scanInputRef.current.value = '';
        openCustomerAccount(data.customer.id, data.customer.name, {
          autoStart: true,
          authToken: token,
        });
      } else if (data.result === 'CANDIDATES' && data.candidates?.length > 0) {
        // Multiple fuzzy matches — show selection modal
        setCandidates(data.candidates);
        setPendingScanData(data);
      } else if (data.result === 'NO_MATCH') {
        if (data.scanType === 'STATE_ID' && data.extracted) {
          // DL/State ID with no match — prefill manual entry with extracted info
          const ext = data.extracted;
          setScanError('No exact match found. Prefilling Manual Entry with scanned ID info.');
          setTimeout(() => {
            prefillAndNavigate({
              firstName: ext.firstName,
              lastName: ext.lastName,
              dob: ext.dob,
              idType: ext.idType ?? 'DRIVERS_LICENSE',
              idNumber: ext.idNumber,
              idExpiration: ext.idExpirationDate,
            });
          }, 1200);
        } else if (data.scanType === 'PASSPORT' && data.passportNumber) {
          // Passport with no match — prefill manual entry with passport number
          setScanError('No passport match found. Prefilling Manual Entry.');
          setTimeout(() => {
            prefillAndNavigate({
              idType: 'PASSPORT',
              idNumber: data.passportNumber,
            });
          }, 1200);
        } else {
          setScanError('No matching customer found. Try Manual Entry.');
          setTimeout(() => selectNavTab('firstTime'), 1500);
        }
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

  /** Handle candidate selection from the fuzzy match modal */
  const handleSelectCandidate = (candidate: Candidate) => {
    if (scanInputRef.current) scanInputRef.current.value = '';
    setCandidates(null);
    setPendingScanData(null);
    openCustomerAccount(candidate.id, candidate.name, {
      autoStart: true,
      authToken: token,
    });
  };

  /** Handle "None of these" — navigate to manual entry with extracted data prefilled */
  const handleNoneOfThese = () => {
    const ext = pendingScanData?.extracted;
    setCandidates(null);
    setPendingScanData(null);
    if (ext) {
      prefillAndNavigate({
        firstName: ext.firstName,
        lastName: ext.lastName,
        dob: ext.dob,
        idType: ext.idType ?? 'DRIVERS_LICENSE',
        idNumber: ext.idNumber,
        idExpiration: ext.idExpirationDate,
      });
    } else {
      selectNavTab('firstTime');
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
          subtitle="Scan a Driver's License, Passport, or Membership ID."
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

      {/* Candidate selection modal */}
      {candidates && candidates.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={handleNoneOfThese}
        >
          <div
            className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              borderColor: 'var(--color-border-default)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Multiple Matches Found
            </h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Select the correct customer, or choose &quot;None of these&quot; to create a new profile.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all"
                  style={{
                    backgroundColor: 'var(--color-surface-input)',
                    borderColor: 'var(--color-border-default)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)';
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-glow)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)';
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-input)';
                  }}
                  onClick={() => handleSelectCandidate(c)}
                >
                  <div>
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {c.name}
                    </span>
                    {c.dob && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        DOB: {c.dob}
                      </span>
                    )}
                    {c.membershipNumber && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        #{c.membershipNumber}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold" style={{ color: 'var(--color-accent-primary)' }}>
                    Select →
                  </span>
                </button>
              ))}
            </div>

            <button
              className="mt-4 w-full rounded-lg border px-4 py-3 text-center text-sm font-semibold transition-all"
              style={{
                backgroundColor: 'var(--color-surface-overlay)',
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-status-warning)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-default)';
              }}
              onClick={handleNoneOfThese}
            >
              None of these — Create New Profile
            </button>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
