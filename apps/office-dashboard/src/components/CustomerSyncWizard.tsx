import { useState, useEffect, useCallback } from 'react';
import { Button, useAuthStore } from '@the-clubs/ui';
import { getApiUrl } from '@the-clubs/shared';

// ── Types ────────────────────────────────────────────────────────
interface SquareCustomer {
  id: string;
  given_name?: string;
  family_name?: string;
  birthday?: string;
  reference_id?: string;
}

interface ProblemEntry {
  matches: SquareCustomer[];
}

type WizardStep = 'SCANNING' | 'RESOLVING' | 'SYNCING' | 'SUCCESS' | 'ERROR';

// ── Generic Status Step Components ───────────────────────────────
function ScanningStep() {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      {/* Fancy CSS Spinning Ring */}
      <div className="relative mb-8 h-16 w-16">
        <div className="absolute inset-0 rounded-full border-4 border-(--color-border-default)" />
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-t-(--color-accent-primary) border-r-transparent border-b-transparent border-l-transparent" />
      </div>
      <h3 className="mb-2 text-xl font-bold text-(--color-text-primary) animate-pulse">
        Scanning Square Database...
      </h3>
      <p className="text-sm text-(--color-text-muted)">
        Checking all historical records for duplicates via the Square Sandbox API.
      </p>
    </div>
  );
}

function SyncingStep() {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      {/* Ping Animation Pattern representing sync */}
      <div className="relative mb-8 flex h-16 w-16 items-center justify-center">
        <span className="absolute flex h-full w-full">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--color-accent-primary) opacity-30" />
          <span className="relative inline-flex h-16 w-16 rounded-full bg-(--color-accent-primary)" />
        </span>
        <svg className="relative z-10 h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      </div>
      <h3 className="mb-2 text-xl font-bold text-(--color-text-primary) animate-pulse">
        Executing Merge & Import...
      </h3>
      <p className="text-sm text-(--color-text-muted)">
        Pruning duplicates from Square and mass-upserting records to PostgreSQL.
      </p>
    </div>
  );
}

function SuccessStep({ onComplete }: Readonly<{ onComplete: () => void }>) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 text-green-500">
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="mb-2 text-2xl font-bold text-(--color-text-primary)">Sync Successful</h3>
      <p className="mb-8 text-sm text-(--color-text-secondary)">All customers have been successfully deduplicated and mirrored locally.</p>
      <Button variant="primary" size="lg" onClick={onComplete}>Finish</Button>
    </div>
  );
}

function ErrorStep({ msg, onClose }: Readonly<{ msg: string, onClose: () => void }>) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h3 className="mb-2 text-2xl font-bold text-(--color-text-primary)">Sync Failed</h3>
      <p className="mb-8 text-sm text-red-400">{msg}</p>
      <Button variant="outline" size="lg" onClick={onClose}>Close Wizard</Button>
    </div>
  );
}

// ── Interactive UI Components ────────────────────────────────────
interface ResolvingStepProps {
  problems: ProblemEntry[];
  resolutions: Record<number, string>;
  setResolutions: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onNext: () => void;
  onCancel: () => void;
}

function ResolvingStep({ problems, resolutions, setResolutions, onNext, onCancel }: Readonly<ResolvingStepProps>) {
  const handleSelectResolution = useCallback((groupIndex: number, masterId: string) => {
    setResolutions((prev) => ({ ...prev, [groupIndex]: masterId }));
  }, [setResolutions]);

  if (problems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-(--color-text-primary)">
        <h3 className="mb-4 text-2xl font-bold text-(--color-accent-primary)">No Duplicates Found!</h3>
        <p className="mb-8 text-(--color-text-secondary)">
          The Square database is clean. Click below to bypass deduplication and instantly import all customers into PostgreSQL.
        </p>
        <div className="flex gap-4">
          <Button onClick={onCancel} variant="ghost" size="lg">Cancel</Button>
          <Button onClick={onNext} variant="primary" size="lg">Import Clean Database</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full max-h-[75vh] flex-col overflow-hidden">
      <div className="mb-4 shrink-0 px-2 pt-2">
        <h3 className="text-2xl font-bold text-(--color-text-primary)">Resolve Duplicates ({problems.length})</h3>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Select the canonical (master) record to retain. The unselected records will be seamlessly merged down to fix the history.
        </p>
      </div>

      <div className="mb-4 flex-1 space-y-6 overflow-y-auto rounded-lg border px-4 py-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {problems.map((prob, idx) => {
          const groupKey = prob.matches.map((m) => m.id).join('-');
          return (
          <div key={groupKey} className="rounded-xl border p-4 shadow-sm" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <div className="mb-3 text-xs font-bold tracking-widest uppercase text-(--color-text-muted)">Duplicate Incident #{idx + 1}</div>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-overlay)' }}>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-(--color-text-muted) text-xs">Keep</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-(--color-text-muted) text-xs">Name</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-(--color-text-muted) text-xs">Birthday</th>
                    <th className="px-4 py-3 font-semibold uppercase tracking-wider text-(--color-text-muted) text-xs">Square Ref ID</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {prob.matches.map(m => (
                    <tr key={m.id} className="border-b transition last:border-0 hover:opacity-80 cursor-pointer" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: resolutions[idx] === m.id ? 'color-mix(in oklch, var(--color-accent-primary) 10%, transparent)' : 'transparent' }} onClick={() => handleSelectResolution(idx, m.id)}>
                      <td className="px-4 py-3">
                        <input type="radio" name={`group-${groupKey}`} checked={resolutions[idx] === m.id} readOnly className="h-5 w-5 accent-(--color-accent-primary)" />
                      </td>
                      <td className="px-4 py-3 font-semibold text-(--color-text-primary)">{m.given_name} {m.family_name}</td>
                      <td className="px-4 py-3 text-(--color-text-secondary)">{m.birthday || '--'}</td>
                      <td className="px-4 py-3 text-xs text-(--color-text-muted)">{m.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
        })}
      </div>

      <div className="shrink-0 flex justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border-default)' }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onNext}>Confirm Merge Instructions</Button>
      </div>
    </div>
  );
}

// ── Main Layout Controller ───────────────────────────────────────
export function CustomerSyncWizard({ onClose, onComplete }: Readonly<{ onClose: () => void, onComplete: () => void }>) {
  const [step, setStep] = useState<WizardStep>('SCANNING');
  const [problems, setProblems] = useState<ProblemEntry[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [errorMsg, setErrorMsg] = useState('');
  
  const token = useAuthStore((s) => s.session?.sessionToken);

  useEffect(() => {
    let mounted = true;
    async function initScan() {
      try {
        const res = await fetch(getApiUrl('/api/v1/admin/square/sync/scan'), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (mounted) {
          setProblems(data.problemEntries || []);
          
          const initialMap: Record<number, string> = {};
          (data.problemEntries || []).forEach((p: ProblemEntry, i: number) => {
             initialMap[i] = p.matches[0]?.id; // safe fallback
          });
          setResolutions(initialMap);
          setStep('RESOLVING');
        }
      } catch (err) {
        if (mounted) {
          setErrorMsg(err instanceof Error ? err.message : 'Unknown fault');
          setStep('ERROR');
        }
      }
    }
    void initScan();
    return () => { mounted = false; };
  }, [token]);

  const handleExecute = useCallback(async () => {
    setStep('SYNCING');
    try {
      const payload = problems.map((p, i) => {
        const masterId = resolutions[i];
        if (!masterId) return null; // Safe guard
        const duplicateIds = p.matches.map(m => m.id).filter(id => id !== masterId);
        return { masterSquareId: masterId, duplicateSquareIds: duplicateIds };
      }).filter(Boolean);

      const res = await fetch(getApiUrl('/api/v1/admin/square/sync/execute'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ resolutions: payload })
      });
      if (!res.ok) throw new Error(await res.text());
      setStep('SUCCESS');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Execution failed severely');
      setStep('ERROR');
    }
  }, [problems, resolutions, token]);

  // Trap focus inside modal
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <div 
        className="w-full max-w-5xl overflow-hidden rounded-2xl border bg-(--color-surface-base) p-6 shadow-2xl transition-all"
        style={{ borderColor: 'var(--color-border-default)' }}
      >
        {step === 'SCANNING' && <ScanningStep />}
        {step === 'RESOLVING' && <ResolvingStep problems={problems} resolutions={resolutions} setResolutions={setResolutions} onNext={() => void handleExecute()} onCancel={onClose} />}
        {step === 'SYNCING' && <SyncingStep />}
        {step === 'SUCCESS' && <SuccessStep onComplete={onComplete} />}
        {step === 'ERROR' && <ErrorStep msg={errorMsg} onClose={onClose} />}
      </div>
    </div>
  );
}
