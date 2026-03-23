import { useState, useEffect } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore, type ActiveCheckinInfo } from '../../stores/useRegisterStore';
import { LateFeeModal, type LateFeeDetails } from '../../components/LateFeeModal';
import { RenewalModal, type RenewalEligibility } from '../../components/RenewalModal';
import { executeManualCheckout, resolveLateFee } from '../../utils/checkoutApi';

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

/** Complete checkout and reset register state. */
async function completeCheckoutAndReset(
  occupancyId: string,
  token: string | undefined,
  customerName: string | null | undefined,
  returnTab: string | null,
  selectNavTab: (tab: string) => void,
  payAtCheckout = false,
  paymentMethod?: 'CREDIT' | 'CASH',
) {
  await executeManualCheckout(occupancyId, token, payAtCheckout, paymentMethod);
  const dest = returnTab;
  useRegisterStore.getState().triggerRentalsRefresh();
  useRegisterStore.setState({
    customerId: null,
    customerName: null,
    activeCheckinInfo: null,
    returnTab: null,
    successToastMessage: `${customerName ?? 'Customer'} checked out successfully`,
  });
  if (dest) selectNavTab(dest);
}

export function ProfileTab() {
  const {
    sessionPayload,
    customerName,
    customerId,
    currentSessionId,
    activeCheckinInfo,
    openCustomerAccount,
    cancelSession,
    returnTab,
    selectNavTab,
  } = useRegisterStore();

  const token = useAuthStore((s) => s.session?.sessionToken);
  const sp = sessionPayload;

  const [checkingOut, setCheckingOut] = useState(false);
  const [fetchedProfile, setFetchedProfile] = useState<FetchedProfile | null>(null);
  const [lateFeeModal, setLateFeeModal] = useState<LateFeeDetails | null>(null);

  // Fetch customer profile from API whenever a customer is selected
  const cid = customerId ?? sp?.customerId;
  useEffect(() => {
    if (!cid) {
      setFetchedProfile(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(getApiUrl(`/api/v1/customers/${encodeURIComponent(cid)}`), { headers });
        if (cancelled) return;
        if (!res.ok) {
          const errorBody = await res.text().catch(() => '');
          console.error(`[ProfileTab] Customer fetch failed: HTTP ${res.status}`, errorBody);
          return;
        }

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
      } catch (err) {
        console.error('[ProfileTab] Customer fetch error:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [cid, token]);

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

  const isMembershipExpired = !hasMembership && !!membershipNumber;

  const getMembershipLabel = () => {
    if (hasMembership) return 'Member';
    if (sp?.membershipChoice === 'SIX_MONTH') return 'Membership Pending';
    if (isMembershipExpired) return 'Non-Member (Expired)';
    return 'Non-Member';
  };
  const membershipLabel = getMembershipLabel();

  const getMembershipColor = () => {
    if (hasMembership) return 'var(--color-status-success)';
    if (sp?.membershipChoice === 'SIX_MONTH') return 'var(--color-status-warning)';
    return 'var(--color-text-muted)';
  };
  const membershipColor = getMembershipColor();


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
    if (!activeCheckinInfo?.occupancyId) return;
    setCheckingOut(true);
    try {
      // Resolve late fees first via shared utility
      const resolved = await resolveLateFee(activeCheckinInfo.occupancyId, token);
      if (resolved) {
        // Show late fee modal — let employee choose payment
        setLateFeeModal(resolved);
        setCheckingOut(false);
        return;
      }
      // No fee — proceed directly
      await completeCheckoutAndReset(activeCheckinInfo.occupancyId, token, customerName, returnTab, selectNavTab);
    } catch (err: unknown) {
      useRegisterStore.setState({
        successToastMessage: err instanceof Error ? err.message : 'Checkout failed',
      });
    } finally {
      setCheckingOut(false);
    }
  };

  const handleLateFeeSettle = async (payAtCheckout: boolean, paymentMethod?: 'CREDIT' | 'CASH') => {
    if (!activeCheckinInfo?.occupancyId) return;
    setCheckingOut(true);
    try {
      await completeCheckoutAndReset(activeCheckinInfo.occupancyId, token, customerName, returnTab, selectNavTab, payAtCheckout, paymentMethod);
    } catch (err: unknown) {
      useRegisterStore.setState({
        successToastMessage: err instanceof Error ? err.message : 'Checkout failed',
      });
    } finally {
      setCheckingOut(false);
      setLateFeeModal(null);
    }
  };

  return (
    <>
    <div className= "flex flex-col gap-2" >
    {/* Customer header */ }
    < div className = "flex items-center gap-3" >
      <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold uppercase"
  style = {{
    backgroundColor: 'var(--color-accent-primary)',
      color: 'var(--color-text-inverse)',
        fontFamily: 'var(--font-display)',
          }
}
        >
  { displayName[0]?.toUpperCase() ?? '?' }
  </div>
  < div >
  <h2
            className="text-sm font-bold uppercase"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
  { displayName }
  </h2>
  < span
className = "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
style = {{ backgroundColor: `${membershipColor}20`, color: membershipColor }}
          >
  { membershipLabel }
  </span>
  </div>
  </div>

{/* Details grid */ }
<div
        className="grid grid-cols-3 gap-x-3 gap-y-1 rounded-lg border p-2"
style = {{
  backgroundColor: 'var(--color-surface-overlay)',
    borderColor: 'var(--color-border-subtle)',
        }}
      >
  <Field label="Membership #" value = { membershipNumber } />
    <Field label="Membership Exp." value = { formatDateStr(membershipValidUntil) } color = { isMembershipExpired ? 'var(--color-status-error)' : undefined } />
    <Field label="DOB" value = { formatDateStr(dob) } />
      <Field label="Language" value={primaryLanguage === 'ES' ? 'Español' : primaryLanguage || undefined} />
      <Field label="Last Visit" value={formatDateStr(lastVisitAt)} />
      <Field label="ID Type" value={formatIdType(idType)} />
            < Field label = "ID #" value = { idNumber } />
              <Field label="ID Exp." value = { formatDateStr(idExpirationDate) } />
                <Field label="Past Due" value = { pastDueBalance? `$${pastDueBalance.toFixed(2)}` : '$0.00'} color = { pastDueBalance? 'var(--color-status-error)': undefined } />
                  </div>

{/* Active visit info (opened from Rentals) */ }
{
  activeCheckinInfo && !currentSessionId && (
    <div className="rounded-lg border p-2" style = {{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }
}>
  <span className="text-[10px] font-bold uppercase tracking-wider" style = {{ color: 'var(--color-text-muted)' }}>
    Active Visit
      </span>
      < div className = "mt-1.5 flex items-center gap-3" >
        <span className="text-sm font-bold" style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          { activeCheckinInfo.resourceType === 'locker' ? 'Locker' : 'Room' } { activeCheckinInfo.resourceNumber }
</span>
{
  activeCheckinInfo.checkinAt && (
    <span className="text-xs" style = {{ color: 'var(--color-text-muted)' }
}>
  In { new Date(activeCheckinInfo.checkinAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
</span>
            )}
{
  activeCheckinInfo.checkoutAt && (
    <span
                className="text-xs font-semibold"
  style = {{ color: activeCheckinInfo.overdue ? 'var(--color-status-error)' : 'var(--color-text-muted)' }
}
              >
  { activeCheckinInfo.overdue ? 'OVERDUE' : `Out ${new Date(activeCheckinInfo.checkoutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }
  </span>
            )}
</div>
  </div>
      )}



{/* Actions */}
<ActionButtons
  activeCheckinInfo={activeCheckinInfo}
  currentSessionId={currentSessionId}
  customerId={customerId ?? sp?.customerId}
  orderStatus={sessionPayload?.orderStatus}
  checkingOut={checkingOut}
  onCheckout={() => void handleCheckout()}
  onStartCheckin={handleStartCheckin}
  onCancel={() => void cancelSession()}
/>
</div>

      {/* Late fee modal — shown when checkout detects a late fee */}
      {lateFeeModal && (
        <LateFeeModal
          customerLabel={displayName}
          resolved={lateFeeModal}
          onSettle={(pay, method) => void handleLateFeeSettle(pay, method)}
          onDismiss={() => setLateFeeModal(null)}
          isProcessing={checkingOut}
        />
      )}
    </>
  );
}

// ── Helpers ──

function formatDateStr(isoStr?: string | null): string | undefined {
  if (!isoStr) return undefined;
  // Splits ISO timestamp explicitly avoiding Javascript timezone drifting on raw casts
  const dateOnly = isoStr.split('T')[0];
  const parts = dateOnly?.split('-');
  if (parts?.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`; // MM/DD/YYYY
  }
  return isoStr;
}

const ID_TYPE_LABELS: Record<string, string> = {
  DRIVERS_LICENSE: 'DL',
  STATE_ID: 'State ID',
  PASSPORT: 'Passport',
  OTHER: 'Other',
};
function formatIdType(idType?: string | null): string | undefined {
  if (!idType) return undefined;
  return ID_TYPE_LABELS[idType] ?? idType;
}

function ActionButtons({ activeCheckinInfo, currentSessionId, customerId, orderStatus, checkingOut, onCheckout, onStartCheckin, onCancel }: Readonly<{
  activeCheckinInfo: ActiveCheckinInfo | null | undefined;
  currentSessionId: string | null;
  customerId: string | null | undefined;
  orderStatus: string | undefined;
  checkingOut: boolean;
  onCheckout: () => void;
  onStartCheckin: () => void;
  onCancel: () => void;
}>) {
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [renewalEligibility, setRenewalEligibility] = useState<RenewalEligibility | null>(null);

  // Reset confirmation and fetch renewal eligibility when customer changes
  useEffect(() => {
    setConfirmingCheckout(false);
    setShowRenewalModal(false);
    setRenewalEligibility(null);

    if (!activeCheckinInfo?.occupancyId || currentSessionId) return;

    let cancelled = false;
    (async () => {
      try {
        const token = globalThis.__authToken;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          getApiUrl(`/api/v1/checkout/renewal-eligibility?occupancyId=${encodeURIComponent(activeCheckinInfo.occupancyId)}`),
          { headers }
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          setRenewalEligibility(data);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeCheckinInfo?.occupancyId, currentSessionId]);

  const customerName = useRegisterStore((s) => s.customerName);

  let checkoutBtnBg = 'var(--color-status-warning)';
  let checkoutBtnShadow = '0 0 20px color-mix(in oklch, var(--color-status-warning) 30%, transparent)';
  let checkoutBtnText = 'Checkout';

  if (checkingOut) {
    checkoutBtnBg = 'var(--color-surface-overlay)';
    checkoutBtnShadow = 'none';
    checkoutBtnText = 'Checking out…';
  } else if (confirmingCheckout) {
    checkoutBtnBg = 'var(--color-status-error)';
    checkoutBtnShadow = '0 0 20px color-mix(in oklch, var(--color-status-error) 30%, transparent)';
    checkoutBtnText = 'Confirm Checkout?';
  }

  return (
    <>
    <div className="flex gap-3">
      {activeCheckinInfo && !currentSessionId && (
        <button
          onClick={() => {
            if (confirmingCheckout) {
              setConfirmingCheckout(false);
              onCheckout();
            } else {
              setConfirmingCheckout(true);
            }
          }}
          disabled={checkingOut}
           className="flex-1 rounded-lg px-4 py-1.5 text-sm font-bold transition-colors"
          style={{
            backgroundColor: checkoutBtnBg,
            color: 'var(--color-text-inverse)',
            boxShadow: checkoutBtnShadow,
            opacity: checkingOut ? 0.6 : 1,
          }}
        >
          {checkoutBtnText}
        </button>
      )}
      {!currentSessionId && !activeCheckinInfo && customerId && (
        <button
          onClick={onStartCheckin}
          className="flex-1 rounded-lg px-4 py-1.5 text-sm font-bold transition-colors"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
            boxShadow: '0 0 20px var(--color-accent-glow)',
          }}
        >
          Start Check-In
        </button>
      )}
      {currentSessionId && orderStatus !== 'PAID' && (
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border px-4 py-1.5 text-sm font-semibold transition-colors"
          style={{
            borderColor: 'var(--color-status-error)',
            color: 'var(--color-status-error)',
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)',
          }}
        >
          Cancel Check-In
        </button>
      )}
    </div>

    {/* Renew Stay button — shown below checkout when eligible */}
    {activeCheckinInfo && !currentSessionId && renewalEligibility?.eligible && (
      <button
        disabled={checkingOut}
        onClick={() => {
          const hasActiveSession = useRegisterStore.getState().currentSessionId;
          if (hasActiveSession) {
            useRegisterStore.getState().setSuccessToastMessage(
              'A check-in is already in progress. Complete or cancel it first.'
            );
            return;
          }
          setShowRenewalModal(true);
        }}
        className="w-full rounded-lg py-1.5 text-sm font-bold flex items-center justify-center gap-2"
        style={{
          backgroundColor: 'color-mix(in oklch, var(--color-brand-primary) 10%, transparent)',
          color: 'var(--color-brand-primary)',
          border: '1px solid color-mix(in oklch, var(--color-brand-primary) 25%, transparent)',
          cursor: checkingOut ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        Renew Stay
      </button>
    )}

    {/* Renewal Modal */}
    {showRenewalModal && renewalEligibility && customerId && (
      <RenewalModal
        customerLabel={`${customerName ?? 'Customer'} · ${activeCheckinInfo?.resourceType === 'locker' ? 'LOCKER' : 'ROOM'} ${activeCheckinInfo?.resourceNumber ?? ''}`}
        customerId={customerId}
        eligibility={renewalEligibility}
        onDismiss={() => setShowRenewalModal(false)}
      />
    )}
    </>
  );
}

function Field({ label, value, color }: Readonly<{ label: string; value?: string | null; color?: string }>) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider leading-tight text-(--color-text-muted)">
        {label}
      </span>
      <p className="text-xs font-medium leading-tight" style={{ color: color ?? 'var(--color-text-primary)' }}>
        {value || '—'}
      </p>
    </div>
  );
}
