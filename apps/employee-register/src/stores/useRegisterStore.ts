import { create } from 'zustand';
import { getApiUrl, type SessionUpdatedPayload } from '@the-clubs/shared';

/* ────────────────────────────────────────────────────────
   Employee Register Store
   Wired to real API endpoints for customer search, lane
   session creation, and SSE-driven state updates.
   ──────────────────────────────────────────────────────── */

/* Types */
export interface CustomerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  name?: string;
  dobMonthDay?: string;
  membershipNumber?: string;
  disambiguator?: string;
}

export interface ClubLogItem {
  id: string;
  occurredAt: string;
  eventDomain: string;
  eventType: string;
  staffName?: string;
  customerId?: string;
  customerName?: string;
  amount?: number;
  summary?: string;
}

export interface ActiveCheckinInfo {
  visitId: string;
  occupancyId: string;
  resourceType: string;
  resourceNumber: string;
  checkinAt: string | null;
  checkoutAt: string | null;
  overdue: boolean;
}

interface RegisterState {
  /* ── Lane ──────────────────────────────────── */
  laneId: string;

  /* ── Scan ─────────────────────────────────── */
  scanReady: boolean;
  scanBlockedReason: string | null;
  scanInputEnabled: boolean;
  scanCaptureSubmitting: boolean;
  setScanCaptureSubmitting: (v: boolean) => void;

  /* ── Customer ─────────────────────────────── */
  customerId: string | null;
  currentSessionId: string | null;
  customerName: string | null;
  activeCheckinInfo: ActiveCheckinInfo | null;
  customerSearch: string;
  customerSearchLoading: boolean;
  customerSuggestions: CustomerSuggestion[];
  setCustomerSearch: (v: string, authToken?: string | null) => void;
  setCustomerSuggestions: (v: CustomerSuggestion[]) => void;
  openCustomerAccount: (
    id: string,
    label: string,
    opts?: { autoStart?: boolean; summary?: Record<string, string | undefined>; authToken?: string | null; activeCheckin?: ActiveCheckinInfo; returnTab?: string }
  ) => void;

  /* ── Session (from SSE) ────────────────────── */
  sessionPayload: SessionUpdatedPayload | null;
  setSessionPayload: (p: SessionUpdatedPayload | null) => void;

  /* ── Manual Entry ─────────────────────────── */
  manualFirstName: string;
  manualLastName: string;
  manualDobDigits: string;
  manualDobIso: string | null;
  manualIdExpirationDigits: string;
  manualIdExpirationIso: string | null;
  manualIdType: string;
  manualIdTypeOther: string;
  manualIdNumber: string;
  manualEntrySubmitting: boolean;
  setManualFirstName: (v: string) => void;
  setManualLastName: (v: string) => void;
  setManualDobDigits: (v: string) => void;
  setManualIdExpirationDigits: (v: string) => void;
  setManualIdType: (v: string) => void;
  setManualIdTypeOther: (v: string) => void;
  setManualIdNumber: (v: string) => void;
  setManualEntry: (v: boolean) => void;
  handleManualSubmit: (e: { preventDefault(): void }) => Promise<void>;

  /* ── Flow Commands ─────────────────────────── */
  sendFlowCommand: (cmd: {
    type: string;
    payload?: Record<string, unknown>;
  }) => Promise<void>;
  cancelSession: () => Promise<void>;
  completeTransaction: () => Promise<void>;

  /* ── Navigation ───────────────────────────── */
  selectNavTab: (tab: string) => void;
  returnTab: string | null;

  /* ── Account Drawer ─────────────────────────── */
  accountDrawerOpen: boolean;
  setAccountDrawerOpen: (v: boolean) => void;

  /* ── Toast ─────────────────────────────────── */
  successToastMessage: string | null;
  setSuccessToastMessage: (v: string | null) => void;

  /* ── Misc ──────────────────────────────────── */
  isSubmitting: boolean;
  refreshRentalsTrigger: number;
  triggerRentalsRefresh: () => void;

  /* ── Club Log ──────────────────────────────── */
  clubLog: {
    items: ClubLogItem[];
    loading: boolean;
    error: string | null;
    q: string;
    domain: string;
    category: string;
    nextCursor: string | null;
    setQ: (v: string) => void;
    setDomain: (v: string) => void;
    setCategory: (v: string) => void;
    reload: () => Promise<void>;
    loadMore: () => Promise<void>;
  };
}

/* ── Helpers ─────────────────────────────────── */
function dobDigitsToIso(digits: string): string | null {
  if (digits.length !== 8) return null;
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

/** Derive lane ID from the URL pathname. e.g. /register-1 → register-1 */
function deriveLaneIdFromUrl(): string {
  const path = globalThis.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  // If path looks like "register-N", use it directly
  if (/^register-\d+$/.test(path)) return path;
  // Fallback: use VITE_LANE_ID or default
  return import.meta.env?.VITE_LANE_ID || 'register-1';
}

/* ── Search debounce ────────────────────────── */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Store ────────────────────────────────────── */
export const useRegisterStore = create<RegisterState>((set, get) => ({
  /* Lane */
  laneId: deriveLaneIdFromUrl(),

  /* Scan */
  scanReady: true,
  scanBlockedReason: null,
  scanInputEnabled: true,
  scanCaptureSubmitting: false,
  setScanCaptureSubmitting: (v) => set({ scanCaptureSubmitting: v }),

  /* Customer */
  customerId: null,
  currentSessionId: null,
  customerName: null,
  activeCheckinInfo: null,
  returnTab: null,
  customerSearch: '',
  customerSearchLoading: false,
  customerSuggestions: [],
  setCustomerSearch: (v, authToken) => {
    set({ customerSearch: v });

    // Debounce real API search
    if (searchTimer) clearTimeout(searchTimer);

    if (v.length >= 3) {
      set({ customerSearchLoading: true });
      searchTimer = setTimeout(async () => {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          const token = authToken || globalThis.__authToken;
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(
            getApiUrl(`/api/v1/customers/search?q=${encodeURIComponent(v)}&limit=10`),
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            set({
              customerSearchLoading: false,
              customerSuggestions: (data.suggestions ?? []).map((s: Record<string, string | undefined>) => ({
                id: s.id,
                firstName: s.firstName ?? s.name?.split(' ')[0] ?? '',
                lastName: s.lastName ?? s.name?.split(' ').slice(1).join(' ') ?? '',
                name: s.name,
                dobMonthDay: s.dobMonthDay,
                membershipNumber: s.membershipNumber,
                disambiguator: s.disambiguator,
              })),
            });
          } else {
            set({ customerSearchLoading: false, customerSuggestions: [] });
          }
        } catch {
          set({ customerSearchLoading: false, customerSuggestions: [] });
        }
      }, 300);
    } else {
      set({ customerSuggestions: [], customerSearchLoading: false });
    }
  },
  setCustomerSuggestions: (v) => set({ customerSuggestions: v }),

  openCustomerAccount: (id, label, opts) => {
    const { laneId } = get();

    // Always set customer info for UI immediately
    set({ customerId: id, customerName: label, activeCheckinInfo: opts?.activeCheckin ?? null, returnTab: opts?.returnTab ?? null, isSubmitting: true, accountDrawerOpen: true });

    // If no activeCheckin was provided (e.g. opened from top search bar),
    // auto-detect whether this customer is currently checked in to a room/locker.
    if (!opts?.activeCheckin && !opts?.autoStart) {
      (async () => {
        try {
          const headers: Record<string, string> = {};
          if (opts?.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;

          const res = await fetch(getApiUrl('/api/v1/inventory/detailed'), { headers });
          if (res.ok) {
            const data = await res.json();
            const allItems = [
              ...(data.rooms ?? []).map((r: Record<string, unknown>) => ({ ...r, resourceType: 'room' as const })),
              ...(data.lockers ?? []).map((l: Record<string, unknown>) => ({ ...l, resourceType: 'locker' as const })),
            ];
            const match = allItems.find(
              (item) => (item as Record<string, unknown>).assignedTo === id && (item as Record<string, unknown>).status === 'OCCUPIED' && (item as Record<string, unknown>).occupancyId
            );
            if (match) {
              const checkinInfo = {
                visitId: (match.visitId ?? match.occupancyId) as string,
                occupancyId: (match.occupancyId ?? match.visitId) as string,
                resourceType: match.resourceType as 'room' | 'locker',
                resourceNumber: match.number as string,
                checkinAt: match.checkinAt ?? null,
                checkoutAt: match.checkoutAt ?? null,
                overdue: match.checkoutAt ? new Date(match.checkoutAt) < new Date() : false,
              };
              set({ activeCheckinInfo: checkinInfo, isSubmitting: false });
            } else {
              set({ isSubmitting: false });
            }
          } else {
            set({ isSubmitting: false });
          }
        } catch {
          set({ isSubmitting: false });
        }
      })();
      return;
    }

    // If autoStart, call the real lane session API
    if (opts?.autoStart) {
      (async () => {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;

          const res = await fetch(
            getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/start`),
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ customerId: id }),
            }
          );

          if (res.ok) {
            const data = await res.json();
            if (data.alreadyCheckedIn) {
              const ac = data.activeCheckin as {
                visitId?: string; assignedResourceType?: string;
                assignedResourceNumber?: string; checkinAt?: string;
                checkoutAt?: string; overdue?: boolean;
              } | undefined;
              const checkinInfo: ActiveCheckinInfo | null = ac ? {
                visitId: ac.visitId ?? '',
                occupancyId: ac.visitId ?? '',
                resourceType: ac.assignedResourceType ?? 'room',
                resourceNumber: ac.assignedResourceNumber ?? '?',
                checkinAt: ac.checkinAt ?? null,
                checkoutAt: ac.checkoutAt ?? null,
                overdue: ac.overdue ?? false,
              } : null;
              set({
                isSubmitting: false,
                activeCheckinInfo: checkinInfo,
                successToastMessage: `${label} is already checked in`,
              });
              get().selectNavTab('account');
            } else {
              set({
                currentSessionId: data.sessionId,
                customerName: data.customerName ?? label,
                isSubmitting: false,
                successToastMessage: `Check-in started for ${data.customerName ?? label}`,
                // Seed sessionPayload so EmployeeAssistTab renders immediately
                // (SSE will overwrite with the full payload shortly after)
                sessionPayload: {
                  sessionId: data.sessionId,
                  customerId: data.customerId ?? id,
                  customerName: data.customerName ?? label,
                  membershipNumber: data.membershipNumber,
                  customerMembershipValidUntil: data.customerMembershipValidUntil,
                  allowedRentals: data.allowedRentals ?? [],
                  mode: data.mode ?? 'CHECKIN',
                  flowStep: 'RENTAL',
                  flowVersion: 0,
                  status: 'ACTIVE',
                  pastDueBalance: data.pastDueBalance,
                  pastDueBlocked: data.pastDueBlocked,
                  ledgerLineItems: data.ledgerLineItems,
                  ledgerTotal: data.ledgerTotal,
                },
              });
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            let errorMsg = errData.error ?? `Failed to start check-in (${res.status})`;
            // Format ban date for employee readability
            const banMatch = errorMsg.match(/banned until (\d{4}-\d{2}-\d{2}T[^\s]+)/i);
            if (banMatch) {
              const banDate = new Date(banMatch[1]);
              const formatted = banDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              errorMsg = `⛔ Customer is banned until ${formatted}`;
            }
            set({
              isSubmitting: false,
              successToastMessage: errorMsg,
            });
          }
        } catch {
          set({ isSubmitting: false, successToastMessage: 'Network error starting check-in' });
        }
      })();
    } else {
      set({ isSubmitting: false });
    }
  },


  /* Session (from SSE) */
  sessionPayload: null,
  setSessionPayload: (p) => set({ sessionPayload: p }),

  /* Manual Entry */
  manualFirstName: '',
  manualLastName: '',
  manualDobDigits: '',
  manualDobIso: null,
  manualIdExpirationDigits: '',
  manualIdExpirationIso: null,
  manualIdType: '',
  manualIdTypeOther: '',
  manualIdNumber: '',
  manualEntrySubmitting: false,
  setManualFirstName: (v) => set({ manualFirstName: v }),
  setManualLastName: (v) => set({ manualLastName: v }),
  setManualDobDigits: (v) => set({ manualDobDigits: v, manualDobIso: dobDigitsToIso(v) }),
  setManualIdExpirationDigits: (v) => set({ manualIdExpirationDigits: v, manualIdExpirationIso: dobDigitsToIso(v) }),
  setManualIdType: (v) => set({ manualIdType: v }),
  setManualIdTypeOther: (v) => set({ manualIdTypeOther: v }),
  setManualIdNumber: (v) => set({ manualIdNumber: v }),
  setManualEntry: () => { },
  handleManualSubmit: async (e) => {
    e.preventDefault();
    set({ manualEntrySubmitting: true });
    const {
      manualFirstName, manualLastName, manualDobIso,
      manualIdType, manualIdTypeOther, manualIdNumber,
      manualIdExpirationIso, openCustomerAccount,
    } = get();

    try {
      const token = globalThis.__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Step 1: Check for existing customer (by ID number and name+DOB)
      const matchRes = await fetch(
        getApiUrl('/api/v1/customers/match-identity'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            firstName: manualFirstName,
            lastName: manualLastName,
            dob: manualDobIso,
            idNumber: manualIdNumber || undefined,
          }),
        }
      );

      if (matchRes.ok) {
        const matchData = await matchRes.json();
        if (matchData.bestMatch) {
          // Existing customer found — open their account instead of creating
          const existing = matchData.bestMatch;
          set({
            manualEntrySubmitting: false,
            manualFirstName: '',
            manualLastName: '',
            manualDobDigits: '',
            manualDobIso: null,
            manualIdExpirationDigits: '',
            manualIdExpirationIso: null,
            manualIdType: '',
            manualIdTypeOther: '',
            manualIdNumber: '',
            successToastMessage: `Existing customer found: ${existing.name} — opening their account.`,
          });
          openCustomerAccount(existing.id, existing.name, {
            autoStart: true,
            authToken: token,
          });
          return;
        }
      }

      // Step 2: No match found — create new customer
      const res = await fetch(
        getApiUrl('/api/v1/customers/create-manual'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            firstName: manualFirstName,
            lastName: manualLastName,
            dob: manualDobIso,
            idType: manualIdType || 'STATE_ID',
            idTypeOther: manualIdType === 'OTHER' ? manualIdTypeOther : undefined,
            idNumber: manualIdNumber || undefined,
            idExpirationDate: manualIdExpirationIso || undefined,
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const customer = data.customer;
        const isExisting = data.existing === true;
        // Clear form fields
        set({
          manualEntrySubmitting: false,
          manualFirstName: '',
          manualLastName: '',
          manualDobDigits: '',
          manualDobIso: null,
          manualIdExpirationDigits: '',
          manualIdExpirationIso: null,
          manualIdType: '',
          manualIdTypeOther: '',
          manualIdNumber: '',
          successToastMessage: isExisting
            ? `Existing customer found: ${customer.name} — opening their account.`
            : `Customer ${manualFirstName} ${manualLastName} added successfully.`,
        });
        // Open customer account and start check-in on kiosk
        openCustomerAccount(customer.id, customer.name, {
          autoStart: true,
          authToken: token,
        });
      } else {
        const errData = await res.json().catch(() => ({}));
        set({
          manualEntrySubmitting: false,
          successToastMessage: errData.error ?? `Failed to add customer (${res.status})`,
        });
      }
    } catch {
      set({ manualEntrySubmitting: false, successToastMessage: 'Network error adding customer' });
    }
  },

  /* Flow Commands */

  sendFlowCommand: async (cmd) => {
    const state = get();
    const sp = state.sessionPayload;
    if (!sp?.sessionId) return;
    const { laneId } = state;

    const token = globalThis.__authToken;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const commandUrl = getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/flow-command`);
    const snapshotUrl = getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/session-snapshot`);

    const buildBody = (version: number) => JSON.stringify({
      sessionId: sp.sessionId,
      commandId: crypto.randomUUID(),
      actor: 'EMPLOYEE',
      expectedFlowVersion: version,
      ...cmd,
    });

    const applyFlowVersion = (data: Record<string, unknown> | null) => {
      if (data?.flowVersion != null) {
        const current = get().sessionPayload;
        if (current) set({ sessionPayload: { ...current, flowVersion: data.flowVersion as number } });
      }
    };

    const fetchSnapshot = async () => {
      try {
        const snapHeaders: Record<string, string> = {};
        if (token) snapHeaders['Authorization'] = `Bearer ${token}`;
        const snapRes = await fetch(snapshotUrl, { headers: snapHeaders });
        if (snapRes.ok) {
          const snap = await snapRes.json();
          if (snap.session) set({ sessionPayload: snap.session });
        }
      } catch { /* snapshot fetch failed — SSE will still deliver the update */ }
    };

    const resyncAndRetry = async (): Promise<boolean> => {
      try {
        const snapRes = await fetch(snapshotUrl, { headers });
        if (!snapRes.ok) return false;
        const snap = await snapRes.json();
        if (!snap.session) return false;
        set({ sessionPayload: snap.session });
        const retryRes = await fetch(commandUrl, {
          method: 'POST', headers,
          body: buildBody(snap.session.flowVersion ?? 0),
        });
        if (!retryRes.ok) return false;
        applyFlowVersion(await retryRes.json().catch(() => null));
        return true;
      } catch { return false; }
    };

    try {
      const res = await fetch(commandUrl, { method: 'POST', headers, body: buildBody(sp.flowVersion ?? 0) });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const isVersionMismatch = d.code === 'VersionMismatch' || d.error === 'VersionMismatch' || res.status === 409;
        if (isVersionMismatch && await resyncAndRetry()) return;
        set({ successToastMessage: d.error ?? `Flow command failed (${res.status})` });
        return;
      }

      applyFlowVersion(await res.json().catch(() => null));
      await fetchSnapshot();
    } catch {
      set({ successToastMessage: 'Network error sending flow command' });
    }
  },
  cancelSession: async () => {
    const { laneId } = get();
    // Clear local state IMMEDIATELY to prevent the SSE broadcast race.
    // The reset endpoint broadcasts a SESSION_UPDATED event with nulled fields;
    // if we clear state *after* the fetch, the SSE event arrives first and
    // re-renders the flow in a partially-nulled state (showing "Room null").
    set({
      currentSessionId: null,
      customerId: null,
      customerName: null,
      activeCheckinInfo: null,
      sessionPayload: null,
      successToastMessage: 'Check-in cancelled',
    });
    try {
      const token = globalThis.__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/reset`),
        { method: 'POST', headers, body: JSON.stringify({ cancelled: true }) }
      );
    } catch {
      // Best-effort — local state already cleared
    }
  },

  completeTransaction: async () => {
    const { laneId, customerId, customerName, sessionPayload } = get();

    let optimisticCheckin;
    // Build optimistic checkin info from the session payload.
    // With flow commands, the session stays in AWAITING_SIGNATURE during ASSIGNMENT
    // (status transitions to COMPLETED only after /reset is called below).
    if (sessionPayload?.assignedResourceNumber) {
      optimisticCheckin = {
        visitId: sessionPayload.sessionId,
        occupancyId: sessionPayload.sessionId,
        resourceType: sessionPayload.assignedResourceType ?? 'room',
        resourceNumber: sessionPayload.assignedResourceNumber,
        checkinAt: new Date().toISOString(),
        checkoutAt: null,
        overdue: false,
      };
    }

    // Clear session state but keep customerId/customerName so the profile
    // tab re-renders and shows the now-checked-in customer.
    set({
      currentSessionId: null,
      activeCheckinInfo: optimisticCheckin ?? null,
      sessionPayload: null,
      successToastMessage: `${customerName ?? 'Customer'} checked in successfully`,
    });
    try {
      const token = globalThis.__authToken;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/reset`),
        { method: 'POST', headers }
      );

      // Re-open the customer's profile to refresh and show the active visit
      if (customerId) {
        const { openCustomerAccount } = get();
        // Passing activeCheckin skips the slow /inventory/detailed fetch for immediate feedback
        const opts: { authToken: string | null | undefined; activeCheckin?: typeof optimisticCheckin } = { authToken: token };
        if (optimisticCheckin) opts.activeCheckin = optimisticCheckin;
        openCustomerAccount(customerId, customerName ?? '', opts);
      }
    } catch {
      // Best-effort — local state already cleared
    }
  },

  /* Navigation — will be wired to AppLayout's setActiveTab */
  selectNavTab: () => { },

  /* Account Drawer */
  accountDrawerOpen: false,
  setAccountDrawerOpen: (v) => set({ accountDrawerOpen: v }),

  /* Toast */
  successToastMessage: null,
  setSuccessToastMessage: (v) => set({ successToastMessage: v }),

  /* Misc */
  isSubmitting: false,
  refreshRentalsTrigger: 0,
  triggerRentalsRefresh: () => set((s) => ({ refreshRentalsTrigger: s.refreshRentalsTrigger + 1 })),

  /* Club Log */
  clubLog: {
    items: [],
    loading: false,
    error: null,
    q: '',
    domain: '',
    category: '',
    nextCursor: null,
    setQ: (v: string) => set((s) => ({ clubLog: { ...s.clubLog, q: v } })),
    setDomain: (v: string) => set((s) => ({ clubLog: { ...s.clubLog, domain: v } })),
    setCategory: (v: string) => set((s) => ({ clubLog: { ...s.clubLog, category: v } })),
    reload: async () => {
      const { clubLog } = get();
      set((s) => ({ clubLog: { ...s.clubLog, loading: true, error: null, items: [], nextCursor: null } }));
      try {
        const token = globalThis.__authToken;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const params = new URLSearchParams({ limit: '50' });
        if (clubLog.q) params.set('search', clubLog.q);
        if (clubLog.domain) params.set('domain', clubLog.domain);
        if (clubLog.category) params.set('eventType', clubLog.category);

        const res = await fetch(getApiUrl(`/api/v1/admin/club-log?${params}`), { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        set((s) => ({
          clubLog: {
            ...s.clubLog,
            loading: false,
            items: data.events ?? [],
            nextCursor: data.nextCursor ?? null,
          },
        }));
      } catch (err: unknown) {
        set((s) => ({ clubLog: { ...s.clubLog, loading: false, error: err instanceof Error ? err.message : 'Failed to load' } }));
      }
    },
    loadMore: async () => {
      const { clubLog } = get();
      if (!clubLog.nextCursor) return;
      set((s) => ({ clubLog: { ...s.clubLog, loading: true } }));
      try {
        const token = globalThis.__authToken;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const params = new URLSearchParams({ limit: '50', cursor: clubLog.nextCursor ?? '' });
        if (clubLog.q) params.set('search', clubLog.q);
        if (clubLog.domain) params.set('domain', clubLog.domain);
        if (clubLog.category) params.set('eventType', clubLog.category);

        const res = await fetch(getApiUrl(`/api/v1/admin/club-log?${params}`), { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        set((s) => ({
          clubLog: {
            ...s.clubLog,
            loading: false,
            items: [...s.clubLog.items, ...(data.events ?? [])],
            nextCursor: data.nextCursor ?? null,
          },
        }));
      } catch (err: unknown) {
        set((s) => ({ clubLog: { ...s.clubLog, loading: false, error: err instanceof Error ? err.message : 'Failed to load' } }));
      }
    },
  },
}));
