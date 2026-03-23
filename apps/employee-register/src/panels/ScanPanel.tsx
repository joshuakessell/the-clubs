import { useRef, useState, useEffect, useCallback } from 'react';
import { Badge, Spinner, useAuthStore } from '@the-clubs/ui';
import { getApiUrl } from '@the-clubs/shared';
import { useRegisterStore } from '../stores/useRegisterStore';

import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';
import { BarcodeIcon } from '../components/BarcodeIcon';

/* Convert ISO date (YYYY-MM-DD) to MMDDYYYY digits for the manual entry form */
function isoToMmDdYyyyDigits(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[2]}${m[3]}${m[1]}`;
}

interface Candidate {
  id: string;
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  matchScore: number;
}

/** Debounce idle time (ms) — once no keystrokes arrive for this long, auto-submit */
const SCAN_IDLE_MS = 500;

/** Dev/demo-only button to run incremental seed data */
function DemoCatchUpButton() {
  const [isCatchingUp, setIsCatchingUp] = useState(false);

  const handleCatchUp = async () => {
    setIsCatchingUp(true);
    try {
      await fetch(getApiUrl('/api/v1/admin/demo-catchup'), { method: 'POST' });
    } finally {
      setIsCatchingUp(false);
    }
  };

  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        onClick={() => void handleCatchUp()}
        disabled={isCatchingUp}
        className="rounded-lg border-2 border-dashed px-5 py-2.5 text-sm font-semibold transition-colors duration-200"
        style={{
          backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 8%, transparent)',
          borderColor: 'var(--color-accent-primary)',
          color: 'var(--color-accent-primary)',
          opacity: isCatchingUp ? 0.6 : 1,
        }}
      >
        {isCatchingUp ? '⏳ Catching up…' : '🔄 Catch-up Demo Data'}
      </button>
    </div>
  );
}

export function ScanPanel() {
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    laneId,
    scanReady,
    scanBlockedReason,
    scanInputEnabled,
    scanCaptureSubmitting,
    setScanCaptureSubmitting,
    openCustomerAccount,
    setManualFirstName,
    setManualLastName,
    setManualDobDigits,
    setManualIdType,
    setManualIdNumber,
    setManualIdExpirationDigits,
    selectNavTab,
  } = useRegisterStore();

  const token = useAuthStore((s) => s.session?.sessionToken);
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pendingScanData, setPendingScanData] = useState<{ extracted?: Record<string, string> } | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);

  /* ── Auto-focus the hidden input when the panel mounts ── */
  useEffect(() => {
    hiddenInputRef.current?.focus();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if actively typing inside an open form modal or explicit input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Do not intercept if we are locked in transmission
      if (useRegisterStore.getState().scanCaptureSubmitting) return;

      hiddenInputRef.current?.focus();
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  /* ── Re-focus on click anywhere in the panel ── */
  const handlePanelClick = useCallback(() => {
    if (!scanCaptureSubmitting) {
      hiddenInputRef.current?.focus();
    }
  }, [scanCaptureSubmitting]);

  /** Prefill the manual entry form and navigate to firstTime tab */
  const prefillAndNavigate = useCallback((opts: {
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
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
    selectNavTab('firstTime');
  }, [setManualFirstName, setManualLastName, setManualDobDigits, setManualIdType, setManualIdNumber, setManualIdExpirationDigits, selectNavTab]);

  /** Dispatch scan result — flat early-return style to avoid nested if/else */
  const processScanResult = useCallback((data: Record<string, unknown>) => {
    if (data.result === 'MATCHED' && data.customer) {
      if (hiddenInputRef.current) hiddenInputRef.current.value = '';
      const cust = data.customer as { id: string; name: string };
      openCustomerAccount(cust.id, cust.name, { autoStart: true, authToken: token });
      return;
    }

    if (data.result === 'CANDIDATES' && (data.candidates as unknown[] | undefined)?.length) {
      setCandidates(data.candidates as Candidate[]);
      setPendingScanData(data as { extracted?: Record<string, string> });
      return;
    }

    if (data.result === 'NO_MATCH') {
      const scanType = data.scanType as string | undefined;
      const extracted = data.extracted as Record<string, string> | undefined;

      if (scanType === 'STATE_ID' && extracted) {
        setScanError('No exact match found. Prefilling Manual Entry with scanned ID info.');
        setTimeout(() => prefillAndNavigate({
          firstName: extracted.firstName,
          lastName: extracted.lastName,
          dob: extracted.dob,
          idType: extracted.idType ?? 'DRIVERS_LICENSE',
          idNumber: extracted.idNumber,
          idExpiration: extracted.idExpirationDate,
        }), 1200);
        return;
      }

      if (scanType === 'PASSPORT' && data.passportNumber) {
        setScanError('No passport match found. Prefilling Manual Entry.');
        setTimeout(() => prefillAndNavigate({
          idType: 'PASSPORT',
          idNumber: data.passportNumber as string,
        }), 1200);
        return;
      }

      setScanError('No matching customer found. Try Manual Entry.');
      setTimeout(() => selectNavTab('firstTime'), 1500);
      return;
    }

    if (data.result === 'ERROR') {
      const err = data.error as { message?: string } | undefined;
      setScanError(err?.message ?? 'Scan error');
      return;
    }

    setScanError('Unexpected response from scan');
  }, [token, openCustomerAccount, prefillAndNavigate, selectNavTab]);

  const handleScanSubmit = useCallback(async () => {
    const rawText = hiddenInputRef.current?.value?.trim();
    if (!rawText) return;

    setIsReceiving(false);
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
      processScanResult(data);
    } catch {
      setScanError('Network error processing scan');
    } finally {
      setScanCaptureSubmitting(false);
      if (hiddenInputRef.current) hiddenInputRef.current.value = '';
      // Re-focus after processing
      setTimeout(() => hiddenInputRef.current?.focus(), 100);
    }
  }, [token, laneId, setScanCaptureSubmitting, processScanResult]);

  /* ── Keystroke handler with debounce ── */
  const handleInput = useCallback(() => {
    // Mark as receiving scan data
    setIsReceiving(true);
    setScanError(null);

    // Clear existing timer
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    // Set new timer — auto-submit after SCAN_IDLE_MS of silence
    debounceTimer.current = setTimeout(() => {
      setIsReceiving(false);
      void handleScanSubmit();
    }, SCAN_IDLE_MS);
  }, [handleScanSubmit]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  /** Handle candidate selection from the fuzzy match modal */
  const handleSelectCandidate = (candidate: Candidate) => {
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
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
      <div role="region" aria-label="Scanner capture area" onClick={handlePanelClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePanelClick(); }} className="flex flex-col items-center gap-2 w-full">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-4xl" aria-hidden="true">📷</span>
          <PanelHeader
            align="center"
            spacing="sm"
            title="Scan Now"
            subtitle="Scan a Driver's License, ID or a Passport."
          />
        </div>

        {/* Demo badge */}
        <div className="mt-3 flex justify-center">
          <Badge color="info" variant="light" size="sm">
            LIVE MODE
          </Badge>
        </div>

        {/* Barcode icon — replaces the old textarea/button */}
        <div className="mt-6 flex justify-center opacity-60">
          <BarcodeIcon />
        </div>

        {/* Hidden input — captures scanner keystrokes */}
        <input
          ref={hiddenInputRef}
          type="text"
          className="sr-only"
          aria-label="Scanner input"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={!scanInputEnabled || scanCaptureSubmitting}
          onInput={handleInput}
          tabIndex={-1}
        />

        {/* Error message */}
        {scanError && (
          <p className="mt-2 text-center text-xs font-medium text-(--color-status-error)" role="alert">
            {scanError}
          </p>
        )}

        {/* Status text */}
        <p className="mt-3 text-center text-xs font-semibold text-(--color-text-muted)" aria-live="polite">
        {(() => {
            if (!scanReady) return `Scanner paused: ${scanBlockedReason || 'Unavailable'}`;
            return scanCaptureSubmitting ? 'Processing scan…' : 'Scanner ready';
          })()}
        </p>

        {/* Dev/Demo: Catch-up seed button */}
        {(import.meta.env.DEV || (typeof globalThis !== 'undefined' && globalThis.location?.hostname.includes('demo'))) && (
          <DemoCatchUpButton />
        )}

      </div>

      {/* ── Processing overlay (full screen, doesn't steal focus) ── */}
      {(isReceiving || scanCaptureSubmitting) && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-lg"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-surface-base) 75%, transparent)' }}
          onMouseDown={(e) => e.preventDefault()} // Prevent focus steal
          role="status"
          aria-label="Processing scan"
        >
          <div
            className="flex flex-col items-center gap-4 rounded-xl border p-8 bg-(--color-surface-raised) border-(--color-border-default)"
          >
            <Spinner size="md" />
            <span className="text-base font-semibold text-(--color-text-primary)">
              {isReceiving ? 'Receiving scan data…' : 'Processing scan…'}
            </span>
            {isReceiving && (
              <span className="text-xs text-(--color-text-muted)">
                Please wait while the scanner finishes
              </span>
            )}
          </div>
        </div>
      )}

      {/* Candidate selection modal */}
      {candidates && candidates.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-surface-base) 60%, transparent)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Customer selection"
          onClick={handleNoneOfThese}
          onKeyDown={(e) => { if (e.key === 'Escape') handleNoneOfThese(); }}
        >
          <div
            className="w-full max-w-md rounded-xl border p-6 shadow-2xl bg-(--color-surface-raised) border-(--color-border-default)"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-(--color-text-primary)">
              Multiple Matches Found
            </h3>
            <p className="mt-1 text-xs text-(--color-text-muted)">
              Select the correct customer, or choose &quot;None of these&quot; to create a new profile.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:border-[var(--color-accent-primary)] hover:bg-[var(--color-accent-glow)] bg-(--color-surface-input) border-(--color-border-default)"
                  onClick={() => handleSelectCandidate(c)}
                >
                  <div>
                    <span className="text-sm font-semibold text-(--color-text-primary)">
                      {c.name}
                    </span>
                    {c.dob && (
                      <span className="ml-2 text-xs text-(--color-text-muted)">
                        DOB: {c.dob}
                      </span>
                    )}
                    {c.membershipNumber && (
                      <span className="ml-2 text-xs text-(--color-text-muted)">
                        #{c.membershipNumber}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-(--color-accent-primary)">
                    Select →
                  </span>
                </button>
              ))}
            </div>

            <button
              className="mt-4 w-full rounded-lg border px-4 py-3 text-center text-sm font-semibold transition-colors hover:border-[var(--color-status-warning)] bg-(--color-surface-overlay) border-(--color-border-default) text-(--color-text-secondary)"
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
