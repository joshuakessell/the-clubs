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

export const useAuthStore = create<AuthState>((set) => ({
  session: loadSession(),
  isValidating: false,  // No backend validation yet — will add in Phase 6
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
}));
