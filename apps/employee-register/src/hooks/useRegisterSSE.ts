import { useCallback, useMemo } from 'react';
import { useRealtimeSSE, type ParsedRealtimeEvent, API_BASE_URL } from '@the-clubs/shared';

export interface UseRegisterSSEOptions {
  laneId: string | null;
  staffToken: string | null;
  kioskToken?: string | null;
  onSessionUpdated?: (payload: ParsedRealtimeEvent & { type: 'SESSION_UPDATED' }) => void;
  onInventoryUpdated?: (payload: ParsedRealtimeEvent & { type: 'INVENTORY_UPDATED' }) => void;
  onWaitlistUpdated?: (payload: ParsedRealtimeEvent & { type: 'WAITLIST_UPDATED' }) => void;
  onCheckoutRequested?: (payload: ParsedRealtimeEvent & { type: 'CHECKOUT_REQUESTED' }) => void;
  onCheckoutClaimed?: (payload: ParsedRealtimeEvent & { type: 'CHECKOUT_CLAIMED' }) => void;
  onCheckoutCompleted?: (payload: ParsedRealtimeEvent & { type: 'CHECKOUT_COMPLETED' }) => void;
  onCustomerConfirmed?: (payload: ParsedRealtimeEvent & { type: 'CUSTOMER_CONFIRMED' }) => void;
  onCustomerDeclined?: (payload: ParsedRealtimeEvent & { type: 'CUSTOMER_DECLINED' }) => void;
}

/**
 * SSE hook for the employee register.
 *
 * Connects to the API server's SSE endpoint for the assigned lane
 * and dispatches parsed events to the appropriate callbacks.
 */
export function useRegisterSSE({
  laneId,
  staffToken,
  kioskToken,
  onSessionUpdated,
  onInventoryUpdated,
  onWaitlistUpdated,
  onCheckoutRequested,
  onCheckoutClaimed,
  onCheckoutCompleted,
  onCustomerConfirmed,
  onCustomerDeclined,
}: UseRegisterSSEOptions) {
  const url = useMemo(() => {
    if (!laneId) return '';
    return `${API_BASE_URL}/v1/realtime/sse/lane/${encodeURIComponent(laneId)}`;
  }, [laneId]);

  const authParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (staffToken) params.staffToken = staffToken;
    if (kioskToken) params.kioskToken = kioskToken;
    return Object.keys(params).length > 0 ? params : undefined;
  }, [staffToken, kioskToken]);

  const onEvent = useCallback(
    (event: ParsedRealtimeEvent) => {
      switch (event.type) {
        case 'SESSION_UPDATED':
          onSessionUpdated?.(event as ParsedRealtimeEvent & { type: 'SESSION_UPDATED' });
          break;
        case 'INVENTORY_UPDATED':
          onInventoryUpdated?.(event as ParsedRealtimeEvent & { type: 'INVENTORY_UPDATED' });
          break;
        case 'WAITLIST_UPDATED':
          onWaitlistUpdated?.(event as ParsedRealtimeEvent & { type: 'WAITLIST_UPDATED' });
          break;
        case 'CHECKOUT_REQUESTED':
          onCheckoutRequested?.(event as ParsedRealtimeEvent & { type: 'CHECKOUT_REQUESTED' });
          break;
        case 'CHECKOUT_CLAIMED':
          onCheckoutClaimed?.(event as ParsedRealtimeEvent & { type: 'CHECKOUT_CLAIMED' });
          break;
        case 'CHECKOUT_COMPLETED':
          onCheckoutCompleted?.(event as ParsedRealtimeEvent & { type: 'CHECKOUT_COMPLETED' });
          break;
        case 'CUSTOMER_CONFIRMED':
          onCustomerConfirmed?.(event as ParsedRealtimeEvent & { type: 'CUSTOMER_CONFIRMED' });
          break;
        case 'CUSTOMER_DECLINED':
          onCustomerDeclined?.(event as ParsedRealtimeEvent & { type: 'CUSTOMER_DECLINED' });
          break;
      }
    },
    [
      onSessionUpdated,
      onInventoryUpdated,
      onWaitlistUpdated,
      onCheckoutRequested,
      onCheckoutClaimed,
      onCheckoutCompleted,
      onCustomerConfirmed,
      onCustomerDeclined,
    ]
  );

  const { connected } = useRealtimeSSE({
    url,
    onEvent,
    authParams,
    enabled: Boolean(laneId) && Boolean(staffToken || kioskToken),
  });

  return { connected };
}
