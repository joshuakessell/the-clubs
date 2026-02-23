import { create } from 'zustand';

export interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
  mustChangePin?: boolean;
}

interface AuthState {
  session: StaffSession | null;
  isValidating: boolean;
  deviceId: string;

  setSession: (session: StaffSession | null) => void;
  clearSession: () => void;
  setValidating: (v: boolean) => void;
  /** Validate stored session against the API. Clears session if invalid/expired. */
  validateSession: () => Promise<void>;
}

const STORAGE_KEY = 'the-clubs:staff-session';
const DEVICE_KEY = 'the-clubs:device-id';

function loadSession(): StaffSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function loadOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = `device-${crypto.randomUUID()}`;
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '/api';

export const useAuthStore = create<AuthState>((set, get) => ({
  session: loadSession(),
  isValidating: false,
  deviceId: loadOrCreateDeviceId(),

  setSession: (session) => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ session, isValidating: false });
  },

  clearSession: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ session: null, isValidating: false });
  },

  setValidating: (isValidating) => set({ isValidating }),

  validateSession: async () => {
    const { session } = get();
    if (!session?.sessionToken) return;

    set({ isValidating: true });
    try {
      const res = await fetch(`${API_BASE}/v1/auth/me`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      if (res.status === 401) {
        // Session is no longer valid — clear it to redirect to login
        localStorage.removeItem(STORAGE_KEY);
        set({ session: null, isValidating: false });
        return;
      }
      // Session is valid
      set({ isValidating: false });
    } catch {
      // Network error — don't clear session (server might be temporarily down)
      set({ isValidating: false });
    }
  },
}));

