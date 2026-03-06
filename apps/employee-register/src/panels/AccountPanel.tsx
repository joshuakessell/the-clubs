import { useState, useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelShell } from '../views/PanelShell';
import { ProfileTab } from './account/ProfileTab';
import { EmployeeAssistTab } from './account/EmployeeAssistTab';
import { ChargesTab } from './account/ChargesTab';
import { CustomerNotesBar } from './account/CustomerNotesBar';

/**
 * AccountPanel — Responsive customer account view.
 *
 * Layout adapts based on customer state:
 *  - Not checked in → Profile only (full width)
 *  - Checked in (from Rentals) → Profile + Charges (2 columns)
 *  - Checking in (active session) → Profile + Assist + Charges (3 columns)
 */
export function AccountPanel() {
  const { currentSessionId, customerId, customerName, activeCheckinInfo, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);
  const [resuming, setResuming] = useState(false);
  const [hasLiveSession, setHasLiveSession] = useState(false);

  // Auto-check for an active session on this lane when no customer is selected
  const noCustomer = !currentSessionId && !customerId && !customerName;
  useEffect(() => {
    if (!noCustomer || !laneId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`),
          { headers },
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          const s = data.session;
          setHasLiveSession(!!s && s.status !== 'COMPLETED' && s.status !== 'CANCELLED');
        }
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [noCustomer, laneId, token]);

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
        const data = await res.json();
        const s = data.session;
        const isLive = s && s.status !== 'COMPLETED' && s.status !== 'CANCELLED';
        if (isLive) {
          useRegisterStore.setState({
            currentSessionId: s.sessionId,
            customerId: s.customerId ?? null,
            customerName: s.customerName ?? null,
            sessionPayload: s,
          });
        } else {
          setHasLiveSession(false);
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
            className="text-lg font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            No Customer Selected
          </h3>
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            Scan an ID or search for a customer to view their account.
          </p>

          {/* Resume active session button — only shown when a live session exists on this lane */}
          {hasLiveSession && (
            <button
              type="button"
              disabled={resuming}
              onClick={() => void handleResumeSession()}
              className="mt-4 rounded-lg border px-5 py-2.5 text-sm font-semibold transition"
              style={{
                borderColor: 'var(--color-accent-primary)',
                color: 'var(--color-accent-primary)',
                backgroundColor: 'rgba(99, 102, 241, 0.06)',
                opacity: resuming ? 0.6 : 1,
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
          className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
        >
          👤 Profile
        </h3>
        <div
          className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5"
          style={{
            backgroundColor: 'transparent',
            borderColor: 'var(--color-border-subtle)',
            scrollbarWidth: 'thin',
          }}
        >
          <ProfileTab />
        </div>
      </div>

      {/* Column 2: Assist — only during active check-in session */}
      {showAssist && (
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <h3
            className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
          >
            📋 Assist
          </h3>
          <div
            className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--color-border-subtle)',
              scrollbarWidth: 'thin',
            }}
          >
            <EmployeeAssistTab />
          </div>
        </div>
      )}

      {/* Column 3: Charges — during active session or when checked in */}
      {showCharges && (
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          <h3
            className="mb-2 text-[10px] font-bold uppercase tracking-widest flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
          >
            📋 Check-In Ledger
          </h3>
          <div
            className="flex-1 min-h-0 overflow-y-auto rounded-lg border p-2.5"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--color-border-subtle)',
              scrollbarWidth: 'thin',
            }}
          >
            <ChargesTab />
          </div>
        </div>
      )}
    </div>

    {/* Notes bar — pinned at bottom, never scrolls */}
    {customerId && (
      <div className="flex-shrink-0 mt-2">
        <CustomerNotesBar customerId={customerId} />
      </div>
    )}
  </PanelShell>
  );
}
