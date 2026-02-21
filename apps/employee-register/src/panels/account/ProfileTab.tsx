import { useState, useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';

/**
 * Fetched customer profile from the API (used as fallback when no sessionPayload from SSE).
 */
type FetchedProfile = {
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  membershipValidUntil: string | null;
  idNumber: string | null;
  idType: string | null;
  idTypeOther: string | null;
  idExpirationDate: string | null;
  primaryLanguage: 'EN' | 'ES' | null;
  lastVisitAt: string | null;
  pastDueBalance: number;
};

/**
 * ProfileTab — Customer details derived from the session payload or fetched profile.
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
  const [fetchedProfile, setFetchedProfile] = useState<FetchedProfile | null>(null);

  // Fetch customer profile from API when no sessionPayload is available
  const cid = customerId ?? sp?.customerId;
  useEffect(() => {
    if (!cid || sp) {
      setFetchedProfile(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(getApiUrl(`/api/v1/customers/${encodeURIComponent(cid)}`), { headers });
        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (cancelled) return;
        const c = data.customer;
        if (c) {
          setFetchedProfile({
            name: c.name ?? null,
            dob: c.dob ?? null,
            membershipNumber: c.membershipNumber ?? null,
            membershipValidUntil: c.membershipValidUntil ?? null,
            idNumber: c.idNumber ?? null,
            idType: c.idType ?? null,
            idTypeOther: c.idTypeOther ?? null,
            idExpirationDate: c.idExpirationDate ?? null,
            primaryLanguage: c.primaryLanguage ?? null,
            lastVisitAt: c.lastVisitAt ?? null,
            pastDueBalance: c.pastDueBalance ?? 0,
          });
        }
      } catch {
        // Silently fail — profile fields just remain empty
      }
    })();

    return () => { cancelled = true; };
  }, [cid, sp, token]);

  // Convenience accessors: prefer sessionPayload, fall back to fetchedProfile
  const displayName = sp?.customerName ?? fetchedProfile?.name ?? customerName ?? 'Customer';
  const dob = sp?.customerDob ?? fetchedProfile?.dob ?? undefined;
  const membershipNumber = sp?.membershipNumber ?? fetchedProfile?.membershipNumber ?? undefined;
  const membershipValidUntil = sp?.customerMembershipValidUntil ?? fetchedProfile?.membershipValidUntil ?? undefined;
  const primaryLanguage = sp?.customerPrimaryLanguage ?? fetchedProfile?.primaryLanguage ?? undefined;
  const lastVisitAt = sp?.customerLastVisitAt ?? fetchedProfile?.lastVisitAt ?? undefined;
  const idType = sp?.customerIdType ?? fetchedProfile?.idType ?? undefined;
  const idNumber = sp?.customerIdNumber ?? fetchedProfile?.idNumber ?? undefined;
  const idExpirationDate = sp?.customerIdExpirationDate ?? fetchedProfile?.idExpirationDate ?? undefined;
  const pastDueBalance = sp?.pastDueBalance ?? fetchedProfile?.pastDueBalance ?? 0;

  const hasMembership =
    membershipValidUntil &&
    new Date(membershipValidUntil) >= new Date();

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
          {displayName[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <h2
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            {displayName}
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
        <Field label="Membership #" value={membershipNumber} />
        <Field label="DOB" value={dob} />
        <Field label="Language" value={primaryLanguage === 'ES' ? 'Español' : primaryLanguage ? 'English' : undefined} />
        <Field label="Last Visit" value={lastVisitAt ? new Date(lastVisitAt).toLocaleDateString() : undefined} />
        <Field label="ID Type" value={idType === 'DRIVERS_LICENSE' ? 'DL' : idType === 'STATE_ID' ? 'State ID' : idType === 'PASSPORT' ? 'Passport' : idType === 'OTHER' ? 'Other' : (idType ?? undefined)} />
        <Field label="ID #" value={idNumber} />
        <Field label="ID Exp." value={idExpirationDate} />
        <Field label="Past Due" value={pastDueBalance ? `$${(pastDueBalance / 100).toFixed(2)}` : '$0.00'} color={pastDueBalance ? 'var(--color-status-error)' : undefined} />
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
