import { useState } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';

/**
 * ProfileTab — Customer details derived from the session payload.
 * Shows customer info, membership status, language toggle, and
 * Start/Cancel Check-In or Checkout controls.
 */
export function ProfileTab() {
  const {
    sessionPayload,
    customerName,
    customerId,
    currentSessionId,
    activeCheckinInfo,
    openCustomerAccount,
    cancelSession,
  } = useRegisterStore();

  const token = useAuthStore((s) => s.session?.sessionToken);
  const sp = sessionPayload;

  const [checkingOut, setCheckingOut] = useState(false);

  const hasMembership =
    sp?.customerMembershipValidUntil &&
    new Date(sp.customerMembershipValidUntil) >= new Date();

  const membershipLabel = hasMembership
    ? 'Member'
    : sp?.membershipChoice === 'SIX_MONTH'
      ? 'Membership Pending'
      : 'Non-Member';

  const membershipColor = hasMembership
    ? 'var(--color-status-success)'
    : sp?.membershipChoice === 'SIX_MONTH'
      ? 'var(--color-status-warning)'
      : 'var(--color-text-muted)';

  const handleStartCheckin = () => {
    const cid = customerId ?? sp?.customerId;
    if (cid) {
      openCustomerAccount(cid, sp?.customerName ?? customerName ?? '', {
        autoStart: true,
        authToken: token,
      });
    }
  };

  const handleCheckout = async () => {
    if (!activeCheckinInfo?.visitId) return;
    setCheckingOut(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(getApiUrl('/api/v1/checkout/manual-complete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ occupancyId: activeCheckinInfo.visitId }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      // Clear customer state after successful checkout
      useRegisterStore.setState({
        customerId: null,
        customerName: null,
        activeCheckinInfo: null,
        successToastMessage: `${customerName ?? 'Customer'} checked out successfully`,
      });
    } catch (err: any) {
      useRegisterStore.setState({
        successToastMessage: err.message ?? 'Checkout failed',
      });
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Customer header */}
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {(sp?.customerName ?? customerName ?? '?')[0]?.toUpperCase()}
        </div>
        <div>
          <h2
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            {sp?.customerName ?? customerName ?? 'Customer'}
          </h2>
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${membershipColor}20`, color: membershipColor }}
          >
            {membershipLabel}
          </span>
        </div>
      </div>

      {/* Details grid */}
      <div
        className="grid grid-cols-2 gap-3 rounded-lg border p-4"
        style={{
          backgroundColor: 'var(--color-surface-overlay)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <Field label="Membership #" value={sp?.membershipNumber} />
        <Field label="DOB" value={sp?.customerDob} />
        <Field label="Language" value={sp?.customerPrimaryLanguage === 'ES' ? 'Español' : 'English'} />
        <Field label="Last Visit" value={sp?.customerLastVisitAt ? new Date(sp.customerLastVisitAt).toLocaleDateString() : undefined} />
        <Field label="ID Type" value={sp?.customerIdType ?? undefined} />
        <Field label="ID #" value={sp?.customerIdNumber} />
        <Field label="ID Exp." value={sp?.customerIdExpirationDate} />
        <Field label="Past Due" value={sp?.pastDueBalance ? `$${(sp.pastDueBalance / 100).toFixed(2)}` : '$0.00'} color={sp?.pastDueBalance ? 'var(--color-status-error)' : undefined} />
      </div>

      {/* Active visit info (opened from Rentals) */}
      {activeCheckinInfo && !currentSessionId && (
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Active Visit
          </span>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              {activeCheckinInfo.resourceType === 'locker' ? 'Locker' : 'Room'} {activeCheckinInfo.resourceNumber}
            </span>
            {activeCheckinInfo.checkinAt && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                In {new Date(activeCheckinInfo.checkinAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {activeCheckinInfo.checkoutAt && (
              <span
                className="text-xs font-semibold"
                style={{ color: activeCheckinInfo.overdue ? 'var(--color-status-error)' : 'var(--color-text-muted)' }}
              >
                {activeCheckinInfo.overdue ? 'OVERDUE' : `Out ${new Date(activeCheckinInfo.checkoutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Session info */}
      {currentSessionId && (
        <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                Session
              </span>
              <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {sp?.sessionId ?? currentSessionId}
              </p>
            </div>
            {sp?.flowStep && (
              <span
                className="rounded-md px-2 py-1 text-xs font-bold"
                style={{ backgroundColor: 'rgba(0,212,255,0.1)', color: 'var(--color-accent-primary)' }}
              >
                {sp.flowStep}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {/* Checkout button for already-checked-in customers */}
        {activeCheckinInfo && !currentSessionId && (
          <button
            onClick={() => void handleCheckout()}
            disabled={checkingOut}
            className="flex-1 rounded-lg px-4 py-3 text-sm font-bold transition"
            style={{
              backgroundColor: checkingOut ? 'var(--color-surface-overlay)' : 'var(--color-status-warning)',
              color: 'var(--color-text-inverse)',
              boxShadow: checkingOut ? 'none' : '0 0 20px rgba(245, 158, 11, 0.3)',
              opacity: checkingOut ? 0.6 : 1,
            }}
          >
            {checkingOut ? 'Checking out…' : 'Checkout'}
          </button>
        )}
        {/* Start Check-In for customers not currently checked in */}
        {!currentSessionId && !activeCheckinInfo && (customerId || sp?.customerId) && (
          <button
            onClick={handleStartCheckin}
            className="flex-1 rounded-lg px-4 py-3 text-sm font-bold transition"
            style={{
              backgroundColor: 'var(--color-accent-primary)',
              color: 'var(--color-text-inverse)',
              boxShadow: '0 0 20px var(--color-accent-glow)',
            }}
          >
            Start Check-In
          </button>
        )}
        {currentSessionId && (
          <button
            onClick={() => void cancelSession()}
            className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition"
            style={{
              borderColor: 'var(--color-status-error)',
              color: 'var(--color-status-error)',
              backgroundColor: 'rgba(239, 68, 68, 0.05)',
            }}
          >
            Cancel Check-In
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value?: string | null; color?: string }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <p className="mt-0.5 text-sm font-medium" style={{ color: color ?? 'var(--color-text-primary)' }}>
        {value || '—'}
      </p>
    </div>
  );
}
