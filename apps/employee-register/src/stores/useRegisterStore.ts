import { create } from 'zustand';

/* ────────────────────────────────────────────────────────
   Employee Register Store
   Replaces useEmployeeRegisterState context from ClubOperationsPOS.
   Uses mock data for now — real API integration in Phase 6.
   ──────────────────────────────────────────────────────── */

/* Types */
export interface CustomerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  dobMonthDay?: string;
  membershipNumber?: string;
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

interface RegisterState {
  /* ── Scan ─────────────────────────────────── */
  scanReady: boolean;
  scanBlockedReason: string | null;
  scanInputEnabled: boolean;
  scanCaptureSubmitting: boolean;
  setScanCaptureSubmitting: (v: boolean) => void;

  /* ── Customer ─────────────────────────────── */
  currentSessionId: string | null;
  customerName: string | null;
  customerSearch: string;
  customerSearchLoading: boolean;
  customerSuggestions: CustomerSuggestion[];
  setCustomerSearch: (v: string) => void;
  setCustomerSuggestions: (v: CustomerSuggestion[]) => void;
  openCustomerAccount: (
    id: string,
    label: string,
    opts?: { autoStart?: boolean; summary?: Record<string, string | undefined> }
  ) => void;

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

/* ── Mock data ───────────────────────────────── */
const MOCK_LOG: ClubLogItem[] = [
  { id: '1', occurredAt: new Date().toISOString(), eventDomain: 'CHECKIN', eventType: 'CHECKIN_STARTED', staffName: 'Demo Staff', customerName: 'John Smith', customerId: 'c1', summary: 'Customer scanned in' },
  { id: '2', occurredAt: new Date(Date.now() - 60_000).toISOString(), eventDomain: 'SALES', eventType: 'SALE_COMPLETED', staffName: 'Demo Staff', amountCents: 2500, summary: 'Rental fee' },
  { id: '3', occurredAt: new Date(Date.now() - 120_000).toISOString(), eventDomain: 'INVENTORY', eventType: 'ROOM_ASSIGNED', staffName: 'Demo Staff', customerName: 'Jane Doe', customerId: 'c2', summary: 'Room 204 assigned' },
  { id: '4', occurredAt: new Date(Date.now() - 300_000).toISOString(), eventDomain: 'HR', eventType: 'REGISTER_SIGN_IN', staffName: 'Demo Staff', summary: 'Register session started' },
  { id: '5', occurredAt: new Date(Date.now() - 600_000).toISOString(), eventDomain: 'CHECKOUT', eventType: 'CHECKOUT_COMPLETED', staffName: 'Demo Staff', customerName: 'Mike Wilson', customerId: 'c3', amountCents: 0, summary: 'Room 112 checked out' },
];

/* ── Store ────────────────────────────────────── */
export const useRegisterStore = create<RegisterState>((set, get) => ({
  /* Scan */
  scanReady: true,
  scanBlockedReason: null,
  scanInputEnabled: true,
  scanCaptureSubmitting: false,
  setScanCaptureSubmitting: (v) => set({ scanCaptureSubmitting: v }),

  /* Customer */
  currentSessionId: null,
  customerName: null,
  customerSearch: '',
  customerSearchLoading: false,
  customerSuggestions: [],
  setCustomerSearch: (v) => {
    set({ customerSearch: v });
    // Mock search — in prod this hits the API
    if (v.length >= 3) {
      set({ customerSearchLoading: true });
      setTimeout(() => {
        set({
          customerSearchLoading: false,
          customerSuggestions: [
            { id: 'c1', firstName: 'John', lastName: 'Smith', dobMonthDay: '03/15', membershipNumber: 'M-10042' },
            { id: 'c2', firstName: 'Jane', lastName: 'Doe', dobMonthDay: '07/22', membershipNumber: 'M-10099' },
          ].filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(v.toLowerCase())),
        });
      }, 400);
    } else {
      set({ customerSuggestions: [] });
    }
  },
  setCustomerSuggestions: (v) => set({ customerSuggestions: v }),
  openCustomerAccount: (id, label) => {
    set({ currentSessionId: id, customerName: label });
    get().selectNavTab('account');
  },

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
    // Mock submit
    await new Promise((r) => setTimeout(r, 800));
    const { manualFirstName, manualLastName } = get();
    set({
      manualEntrySubmitting: false,
      currentSessionId: `mock-${Date.now()}`,
      customerName: `${manualLastName}, ${manualFirstName}`,
      successToastMessage: `Customer ${manualFirstName} ${manualLastName} added.`,
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
    items: MOCK_LOG,
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
      set((s) => ({ clubLog: { ...s.clubLog, loading: true } }));
      await new Promise((r) => setTimeout(r, 500));
      set((s) => ({ clubLog: { ...s.clubLog, loading: false, items: MOCK_LOG } }));
    },
    loadMore: async () => {
      set((s) => ({ clubLog: { ...s.clubLog, loading: true } }));
      await new Promise((r) => setTimeout(r, 500));
      set((s) => ({ clubLog: { ...s.clubLog, loading: false } }));
    },
  },
}));
