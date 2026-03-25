import { useState, Suspense } from 'react';
import useSWR from 'swr';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelShell } from '../views/PanelShell';
import { ProfileTab } from './account/ProfileTab';
import { EmployeeAssistTab } from './account/EmployeeAssistTab';
import { ChargesTab } from './account/ChargesTab';

/**
 * AccountPanel — Responsive customer account view.
 *
 * Layout adapts based on customer state:
 *  - Not checked in → Profile only (full width)
 *  - Checked in (from Rentals) → Profile + Charges (2 columns)
 *  - Checking in (active session) → Profile + Assist + Charges (3 columns)
 */
const getFetcher = async ([url, token]: [string, string?]) => {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export function AccountPanelContent() {
  const { currentSessionId, customerId, customerName, activeCheckinInfo, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [resuming, setResuming] = useState(false);

  // Auto-check for an active session on this lane when no customer is selected
  const noCustomer = !currentSessionId && !customerId && !customerName;
  const sessionUrl = (noCustomer && laneId) ? getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`) : null;
  
  const { data, mutate } = useSWR(sessionUrl ? [sessionUrl, token] : null, getFetcher, { suspense: true, revalidateOnFocus: false });
  const fetchedSession = data?.session;
  const hasLiveSession = !!fetchedSession && fetchedSession.status !== 'COMPLETED' && fetchedSession.status !== 'CANCELLED';

  const handleResumeSession = async () => {
    if (!laneId) return;
    setResuming(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`),
        { headers },
      );
      if (res.ok) {
        const d = await res.json();
        const s = d.session;
        const isLive = s && s.status !== 'COMPLETED' && s.status !== 'CANCELLED';
        if (isLive) {
          useRegisterStore.setState({
            currentSessionId: s.sessionId,
            customerId: s.customerId ?? null,
            customerName: s.customerName ?? null,
            sessionPayload: s,
          });
        } else {
          void mutate(); // Refetch standard route to align states
          useRegisterStore.setState({
            successToastMessage: 'No active session found on this lane.',
          });
        }
      }
    } catch {
      useRegisterStore.setState({ successToastMessage: 'Failed to check for active session.' });
    } finally {
      setResuming(false);
    }
  };

  if (noCustomer) {
    return (
      <PanelShell align="center">
        <div className="flex flex-col items-center gap-3 text-center py-12">
          <span className="text-5xl">👤</span>
          <h3
            className="text-lg font-semibold font-(--font-display) text-(--color-text-primary)"
          >
            No Customer Selected
          </h3>
          <p className="text-sm max-w-xs text-(--color-text-muted)">
            Scan an ID or search for a customer to view their account.
          </p>

          {/* Resume active session button — only shown when a live session exists on this lane */}
          {hasLiveSession && (
            <button
              type="button"
              disabled={resuming}
              onClick={() => void handleResumeSession()}
              className="mt-4 rounded-lg border px-5 py-2.5 text-sm font-semibold"
              style={{
                borderColor: 'var(--color-accent-primary)',
                color: 'var(--color-accent-primary)',
                backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 6%, transparent)',
                opacity: resuming ? 0.6 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              {resuming ? 'Checking…' : '🔄 Resume Active Session'}
            </button>
          )}
        </div>
      </PanelShell>
    );
  }

const hasSession = !!currentSessionId;
const isCheckedIn = !!activeCheckinInfo;
const showAssist = hasSession;
const showCharges = hasSession || isCheckedIn;

return (
  <PanelShell align="top" scroll="hidden">
    {/* Columns row — takes all remaining space, each column scrolls independently */}
    <div className="flex flex-1 min-h-0 gap-4 w-full">
      {/* Column 1: Profile — always shown */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <h3
          className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 text-(--color-text-muted)"
        >
          👤 Profile
        </h3>
        <div
          className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5 bg-transparent border-(--color-border-subtle)"
          style={{ scrollbarWidth: 'thin' }}
        >
          <ProfileTab />
        </div>
      </div>

      {/* Column 2: Assist — only during active check-in session */}
      {showAssist && (
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <h3
            className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 text-(--color-text-muted)"
          >
            📋 Assist
          </h3>
          <div
            className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5 bg-transparent border-(--color-border-subtle)"
            style={{ scrollbarWidth: 'thin' }}
          >
            <EmployeeAssistTab />
          </div>
        </div>
      )}

      {/* Column 3: Charges — during active session or when checked in */}
      {showCharges && (
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <h3
            className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 text-(--color-text-muted)"
          >
            📋 Check-In Ledger
          </h3>
          <div
            className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5 bg-transparent border-(--color-border-subtle)"
            style={{ scrollbarWidth: 'thin' }}
          >
            <ChargesTab />
          </div>
        </div>
      )}
    </div>

  </PanelShell>
  );
}

export function AccountPanel() {
  return (
    <Suspense fallback={
      <PanelShell align="top" scroll="hidden">
        <div className="flex flex-col items-center justify-center h-full opacity-50">
          <p className="text-sm font-medium text-(--color-text-muted)">Loading account profile...</p>
        </div>
      </PanelShell>
    }>
      <AccountPanelContent />
    </Suspense>
  );
}
