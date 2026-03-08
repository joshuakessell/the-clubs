import { create } from 'zustand';
import { getApiUrl } from '@the-clubs/shared';

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
  /** Validate stored session against the API. Clears session if invalid/expired.
   *  When `silent` is true, skip setting isValidating (avoids unmounting the UI). */
  validateSession: (opts?: { silent?: boolean }) => Promise<void>;
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



export const useAuthStore = create<AuthState>((set: (partial: Partial<AuthState>) => void, get: () => AuthState) => ({
  session: loadSession(),
  // Start in validating state if we have a stored session.
  // This prevents AppLayout from rendering with a stale token
  // before useSessionGuard's useEffect fires validateSession().
  isValidating: !!loadSession(),
  deviceId: loadOrCreateDeviceId(),

  setSession: (session: StaffSession | null) => {
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

  setValidating: (isValidating: boolean) => set({ isValidating }),

  validateSession: async (opts?: { silent?: boolean }) => {
    const { session } = get();
    if (!session?.sessionToken) return;

    // Capture the token we're validating so we can detect if the user logged in
    // with a different token while this request was in-flight (e.g. stale
    // localStorage token from a previous demo:dev run).
    const tokenAtStart = session.sessionToken;

    // When silent=true (periodic heartbeat), don't set isValidating to avoid
    // unmounting the AppLayout and resetting drawer/panel states.
    if (!opts?.silent) set({ isValidating: true });
    try {
      const res = await fetch(getApiUrl('/api/v1/auth/me'), {
        headers: { Authorization: `Bearer ${tokenAtStart}` },
      });
      if (res.status === 401) {
        // Only clear if the session hasn't changed (a new login may have occurred)
        if (get().session?.sessionToken === tokenAtStart) {
          localStorage.removeItem(STORAGE_KEY);
          set({ session: null, isValidating: false });
        }
        return;
      }
      // Session is valid — only update if token hasn't changed
      if (get().session?.sessionToken === tokenAtStart) {
        set({ isValidating: false });
      }
    } catch {
      // Network error — don't clear session (server might be temporarily down)
      if (get().session?.sessionToken === tokenAtStart) {
        set({ isValidating: false });
      }
    }
  },
}));

