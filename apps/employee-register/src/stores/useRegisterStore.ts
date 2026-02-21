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
  amountCents?: number;
  summary?: string;
}

export interface ActiveCheckinInfo {
  visitId: string;
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
    opts?: { autoStart?: boolean; summary?: Record<string, string | undefined>; authToken?: string | null; activeCheckin?: ActiveCheckinInfo }
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
  handleManualSubmit: (e: React.FormEvent) => Promise<void>;

  /* ── Flow Commands ─────────────────────────── */
  sendFlowCommand: (cmd: {
    type: string;
    payload?: Record<string, unknown>;
  }) => Promise<void>;
  cancelSession: () => Promise<void>;

  /* ── Navigation ───────────────────────────── */
  selectNavTab: (tab: string) => void;

  /* ── Toast ─────────────────────────────────── */
  successToastMessage: string | null;
  setSuccessToastMessage: (v: string | null) => void;

  /* ── Misc ──────────────────────────────────── */
  isSubmitting: boolean;

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
  const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  // If path looks like "register-N", use it directly
  if (/^register-\d+$/.test(path)) return path;
  // Fallback: use VITE_LANE_ID or default
  return (import.meta as any).env?.VITE_LANE_ID || 'register-1';
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
          if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

          const res = await fetch(
            getApiUrl(`/api/v1/customers/search?q=${encodeURIComponent(v)}&limit=10`),
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            set({
              customerSearchLoading: false,
              customerSuggestions: (data.suggestions ?? []).map((s: any) => ({
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

    // Always set customer info for UI
    set({ customerId: id, customerName: label, activeCheckinInfo: opts?.activeCheckin ?? null, isSubmitting: true });
    get().selectNavTab('account');

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
              set({
                isSubmitting: false,
                successToastMessage: `${label} is already checked in`,
              });
            } else {
              set({
                currentSessionId: data.sessionId,
                customerName: data.customerName ?? label,
                isSubmitting: false,
                successToastMessage: `Check-in started for ${data.customerName ?? label}`,
              });
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            set({
              isSubmitting: false,
              successToastMessage: errData.error ?? `Failed to start check-in (${res.status})`,
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
  setManualEntry: () => {},
  handleManualSubmit: async (e) => {
    e.preventDefault();
    set({ manualEntrySubmitting: true });
    const {
      manualFirstName, manualLastName, manualDobIso,
      manualIdType, manualIdTypeOther, manualIdNumber,
      manualIdExpirationIso, laneId, selectNavTab,
    } = get();

    try {
      const token = (window as any).__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl('/api/v1/checkin/scan'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            rawScanText: `MANUAL|${manualFirstName}|${manualLastName}|${manualDobIso}`,
            laneId,
            manualEntry: {
              firstName: manualFirstName,
              lastName: manualLastName,
              dob: manualDobIso,
              idType: manualIdType === 'OTHER' ? manualIdTypeOther : manualIdType,
              idNumber: manualIdNumber || undefined,
              idExpirationDate: manualIdExpirationIso || undefined,
            },
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        set({
          manualEntrySubmitting: false,
          currentSessionId: data.sessionId ?? data.customerId ?? `new-${Date.now()}`,
          customerName: data.customerName ?? `${manualLastName}, ${manualFirstName}`,
          successToastMessage: `Customer ${manualFirstName} ${manualLastName} added.`,
        });
        selectNavTab('account');
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
    const { laneId, sessionPayload } = get();
    if (!sessionPayload?.sessionId) return;
    try {
      const token = (window as any).__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/flow-command`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId: sessionPayload.sessionId,
            commandId: crypto.randomUUID(),
            actor: 'EMPLOYEE',
            expectedFlowVersion: sessionPayload.flowVersion ?? 0,
            ...cmd,
          }),
        }
      );

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        set({ successToastMessage: d.error ?? `Flow command failed (${res.status})` });
      }
    } catch {
      set({ successToastMessage: 'Network error sending flow command' });
    }
  },
  cancelSession: async () => {
    const { sendFlowCommand } = get();
    await sendFlowCommand({ type: 'CANCEL_STEP' });
    set({
      currentSessionId: null,
      customerId: null,
      customerName: null,
      activeCheckinInfo: null,
      sessionPayload: null,
      successToastMessage: 'Check-in cancelled',
    });
  },

  /* Navigation — will be wired to AppLayout's setActiveTab */
  selectNavTab: () => {},

  /* Toast */
  successToastMessage: null,
  setSuccessToastMessage: (v) => set({ successToastMessage: v }),

  /* Misc */
  isSubmitting: false,

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
        const token = (window as any).__authToken;
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
      } catch (err: any) {
        set((s) => ({ clubLog: { ...s.clubLog, loading: false, error: err.message ?? 'Failed to load' } }));
      }
    },
    loadMore: async () => {
      const { clubLog } = get();
      if (!clubLog.nextCursor) return;
      set((s) => ({ clubLog: { ...s.clubLog, loading: true } }));
      try {
        const token = (window as any).__authToken;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const params = new URLSearchParams({ limit: '50', cursor: clubLog.nextCursor! });
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
      } catch (err: any) {
        set((s) => ({ clubLog: { ...s.clubLog, loading: false, error: err.message ?? 'Failed to load' } }));
      }
    },
  },
}));
