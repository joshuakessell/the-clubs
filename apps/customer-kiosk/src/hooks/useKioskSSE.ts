import { useCallback, useMemo } from 'react';
import { useRealtimeSSE, type ParsedRealtimeEvent, API_BASE_URL } from '@the-clubs/shared';

export type KioskView = 'idle' | 'selection' | 'agreement' | 'payment' | 'complete';

export interface UseKioskSSEOptions {
  laneId: string | null;
  kioskToken: string | null;
  onSessionUpdated?: (payload: ParsedRealtimeEvent & { type: 'SESSION_UPDATED' }) => void;
  onSelectionProposed?: (payload: ParsedRealtimeEvent & { type: 'SELECTION_PROPOSED' }) => void;
  onSelectionLocked?: (payload: ParsedRealtimeEvent & { type: 'SELECTION_LOCKED' }) => void;
  onSelectionForced?: (payload: ParsedRealtimeEvent & { type: 'SELECTION_FORCED' }) => void;
  onAssignmentCreated?: (payload: ParsedRealtimeEvent & { type: 'ASSIGNMENT_CREATED' }) => void;
  onInventoryUpdated?: (payload: ParsedRealtimeEvent & { type: 'INVENTORY_UPDATED' }) => void;
  onCustomerConfirmationRequired?: (payload: ParsedRealtimeEvent & { type: 'CUSTOMER_CONFIRMATION_REQUIRED' }) => void;
}

/**
 * SSE hook for the customer kiosk.
 *
 * Connects to the API server's SSE endpoint for the assigned lane
 * and dispatches parsed events to the appropriate callbacks.
 */
export function useKioskSSE({
  laneId,
  kioskToken,
  onSessionUpdated,
  onSelectionProposed,
  onSelectionLocked,
  onSelectionForced,
  onAssignmentCreated,
  onInventoryUpdated,
  onCustomerConfirmationRequired,
}: UseKioskSSEOptions) {
  const url = useMemo(() => {
    if (!laneId) return '';
    return `${API_BASE_URL}/v1/realtime/sse/lane/${encodeURIComponent(laneId)}`;
  }, [laneId]);

  const authParams = useMemo(() => {
    if (!kioskToken) return undefined;
    return { kioskToken };
  }, [kioskToken]);

  const onEvent = useCallback(
    (event: ParsedRealtimeEvent) => {
      switch (event.type) {
        case 'SESSION_UPDATED':
          onSessionUpdated?.(event as ParsedRealtimeEvent & { type: 'SESSION_UPDATED' });
          break;
        case 'SELECTION_PROPOSED':
          onSelectionProposed?.(event as ParsedRealtimeEvent & { type: 'SELECTION_PROPOSED' });
          break;
        case 'SELECTION_LOCKED':
          onSelectionLocked?.(event as ParsedRealtimeEvent & { type: 'SELECTION_LOCKED' });
          break;
        case 'SELECTION_FORCED':
          onSelectionForced?.(event as ParsedRealtimeEvent & { type: 'SELECTION_FORCED' });
          break;
        case 'ASSIGNMENT_CREATED':
          onAssignmentCreated?.(event as ParsedRealtimeEvent & { type: 'ASSIGNMENT_CREATED' });
          break;
        case 'INVENTORY_UPDATED':
          onInventoryUpdated?.(event as ParsedRealtimeEvent & { type: 'INVENTORY_UPDATED' });
          break;
        case 'CUSTOMER_CONFIRMATION_REQUIRED':
          onCustomerConfirmationRequired?.(event as ParsedRealtimeEvent & { type: 'CUSTOMER_CONFIRMATION_REQUIRED' });
          break;
      }
    },
    [
      onSessionUpdated,
      onSelectionProposed,
      onSelectionLocked,
      onSelectionForced,
      onAssignmentCreated,
      onInventoryUpdated,
      onCustomerConfirmationRequired,
    ]
  );

  const { connected } = useRealtimeSSE({
    url,
    onEvent,
    authParams,
    enabled: Boolean(laneId) && Boolean(kioskToken),
  });

  return { connected };
}
