/**
 * CheckinFlowContext — Shared context for the employee-assist check-in flow.
 *
 * Provides state, actions, and meta to all step components so they
 * consume context instead of receiving props.  Follows the Vercel
 * composition pattern: lift state into a provider, decouple UI from
 * state management.
 */
import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../../stores/useRegisterStore';

/* ── Shared types ─────────────────────────────────────────────── */

export type FlowCommandFn = (cmd: {
  type: string;
  payload?: Record<string, unknown>;
}) => Promise<void>;

export interface RoomOption {
  id: string;
  number: string;
}

export interface AvailableInventory {
  rooms: Record<string, number>;
  lockers: number;
}

export interface RoomsByTier {
  available: RoomOption[];
}

export const RENTAL_OPTIONS = [
  { type: 'LOCKER', label: 'Locker' },
  { type: 'STANDARD', label: 'Standard Room' },
  { type: 'DOUBLE', label: 'Double Room' },
  { type: 'SPECIAL', label: 'Special Room' },
] as const;

/* ── Context interface ────────────────────────────────────────── */

export interface CheckinFlowState {
  sp: SessionUpdatedPayload;
  flowStep: string | undefined;
  inventory: AvailableInventory | null;
  roomsByTier: Record<string, RoomsByTier>;
}

export interface CheckinFlowActions {
  sendFlowCommand: FlowCommandFn;
  fetchInventory: () => Promise<void>;
  fetchRoomsByTier: () => Promise<void>;
}

export interface CheckinFlowMeta {
  token: string | null | undefined;
  laneId: string;
  currentSessionId: string | null;
}

interface CheckinFlowContextValue {
  state: CheckinFlowState;
  actions: CheckinFlowActions;
  meta: CheckinFlowMeta;
}

const CheckinFlowCtx = createContext<CheckinFlowContextValue | null>(null);

/* ── Hook ─────────────────────────────────────────────────────── */

export function useCheckinFlow(): CheckinFlowContextValue {
  const ctx = useContext(CheckinFlowCtx);
  if (!ctx) throw new Error('useCheckinFlow must be used within <CheckinFlowProvider>');
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────── */

export function CheckinFlowProvider({ children }: { children: React.ReactNode }) {
  const { sessionPayload, sendFlowCommand, currentSessionId, laneId } = useRegisterStore();
  const token = useAuthStore((s) => s.session?.sessionToken);

  const sp = sessionPayload;

  const [inventory, setInventory] = useState<AvailableInventory | null>(null);
  const [roomsByTier, setRoomsByTier] = useState<Record<string, RoomsByTier>>({});

  const fetchInventory = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/inventory/available'), { headers });
      if (res.ok) setInventory(await res.json());
    } catch { /* ignore */ }
  }, [token]);

  const fetchRoomsByTier = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(getApiUrl('/api/v1/inventory/rooms-by-tier'), { headers });
      if (res.ok) {
        const data = await res.json();
        setRoomsByTier(data.rooms ?? {});
      }
    } catch { /* ignore */ }
  }, [token]);

  // Pre-fetch inventory on mount
  useEffect(() => {
    void fetchInventory();
    void fetchRoomsByTier();
  }, [fetchInventory, fetchRoomsByTier]);

  // If there's no active session, render children anyway (they'll show the "no session" prompt)
  if (!sp) {
    return <>{children}</>;
  }

  const value: CheckinFlowContextValue = {
    state: {
      sp,
      flowStep: sp.flowStep,
      inventory,
      roomsByTier,
    },
    actions: {
      sendFlowCommand,
      fetchInventory,
      fetchRoomsByTier,
    },
    meta: {
      token: token ?? null,
      laneId: laneId ?? '',
      currentSessionId,
    },
  };

  return <CheckinFlowCtx.Provider value={value}>{children}</CheckinFlowCtx.Provider>;
}
