import { describe, it, expect } from 'vitest';
import {
  safeParseRealtimeEvent,
  SessionUpdatedPayloadSchema,
  InventoryUpdatedPayloadSchema,
  UpgradeHoldAvailablePayloadSchema,
  UpgradeOfferExpiredPayloadSchema,
} from '../src/realtimeSchemas';
import { RoomStatus } from '../src/enums';

// ---------------------------------------------------------------------------
// SessionUpdatedPayloadSchema
// ---------------------------------------------------------------------------
describe('SessionUpdatedPayloadSchema', () => {
  const minimalValid = {
    sessionId: 'sess-001',
    customerName: 'Jane Doe',
  };

  it('parses minimal valid payload', () => {
    const result = SessionUpdatedPayloadSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
  });

  it('normalizes null optional fields to undefined', () => {
    const result = SessionUpdatedPayloadSchema.safeParse({
      ...minimalValid,
      customerId: null,
      membershipNumber: null,
      customerPrimaryLanguage: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerId).toBeUndefined();
      expect(result.data.membershipNumber).toBeUndefined();
      expect(result.data.customerPrimaryLanguage).toBeUndefined();
    }
  });

  it('defaults allowedRentals to empty array', () => {
    const result = SessionUpdatedPayloadSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowedRentals).toEqual([]);
    }
  });

  it('accepts full payload with all optional fields', () => {
    const result = SessionUpdatedPayloadSchema.safeParse({
      ...minimalValid,
      customerId: 'cust-001',
      membershipNumber: 'M-123',
      membershipChoice: 'SIX_MONTH',
      membershipPurchaseIntent: 'PURCHASE',
      mode: 'CHECKIN',
      selectionConfirmed: true,
      agreementSigned: true,
      assignedResourceType: 'room',
      assignedResourceNumber: '101',
      flowStep: 'PAYMENT',
      flowVersion: 3,
      flowLastActor: 'EMPLOYEE',
      paymentStatus: 'DUE',
      pastDueBalance: 500,
      customerPrimaryLanguage: 'ES',
      allowedRentals: ['STANDARD', 'DOUBLE'],
    });
    expect(result.success).toBe(true);
  });

  it('passes through unknown fields', () => {
    const result = SessionUpdatedPayloadSchema.safeParse({
      ...minimalValid,
      futureField: 'hello',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).futureField).toBe('hello');
    }
  });

  it('rejects missing required sessionId', () => {
    const result = SessionUpdatedPayloadSchema.safeParse({ customerName: 'Jane' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InventoryUpdatedPayloadSchema
// ---------------------------------------------------------------------------
describe('InventoryUpdatedPayloadSchema', () => {
  const summary = { clean: 5, cleaning: 2, dirty: 1, total: 8 };

  it('parses valid inventory payload', () => {
    const result = InventoryUpdatedPayloadSchema.safeParse({
      inventory: {
        byType: { STANDARD: summary, DOUBLE: summary, SPECIAL: summary, LOCKER: summary },
        overall: summary,
        lockers: summary,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional available field', () => {
    const result = InventoryUpdatedPayloadSchema.safeParse({
      inventory: {
        byType: { STANDARD: summary, DOUBLE: summary, SPECIAL: summary, LOCKER: summary },
        overall: summary,
        lockers: summary,
      },
      available: {
        rooms: { SPECIAL: 1, DOUBLE: 2, STANDARD: 3 },
        rawRooms: { SPECIAL: 1, DOUBLE: 2, STANDARD: 3 },
        waitlistDemand: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
        lockers: 10,
        total: 16,
      },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UpgradeHoldAvailablePayloadSchema
// ---------------------------------------------------------------------------
describe('UpgradeHoldAvailablePayloadSchema', () => {
  it('parses valid payload', () => {
    const result = UpgradeHoldAvailablePayloadSchema.safeParse({
      waitlistId: 'wl-001',
      customerName: 'John',
      desiredTier: 'DOUBLE',
      roomId: 'room-1',
      roomNumber: '201',
      expiresAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = UpgradeHoldAvailablePayloadSchema.safeParse({
      waitlistId: 'wl-001',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpgradeOfferExpiredPayloadSchema
// ---------------------------------------------------------------------------
describe('UpgradeOfferExpiredPayloadSchema', () => {
  it('parses valid payload', () => {
    const result = UpgradeOfferExpiredPayloadSchema.safeParse({
      waitlistId: 'wl-001',
      customerName: 'John',
      desiredTier: 'SPECIAL',
      roomId: 'room-2',
      roomNumber: '301',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// safeParseRealtimeEvent
// ---------------------------------------------------------------------------
describe('safeParseRealtimeEvent', () => {
  it('returns null for invalid input', () => {
    expect(safeParseRealtimeEvent(null)).toBeNull();
    expect(safeParseRealtimeEvent(42)).toBeNull();
    expect(safeParseRealtimeEvent('hello')).toBeNull();
  });

  it('returns null for missing base fields', () => {
    expect(safeParseRealtimeEvent({ type: 'SESSION_UPDATED' })).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(
      safeParseRealtimeEvent({
        type: 'UNKNOWN_FUTURE_EVENT',
        payload: {},
        timestamp: '2026-01-01T00:00:00Z',
      })
    ).toBeNull();
  });

  it('parses SESSION_UPDATED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'SESSION_UPDATED',
      payload: { sessionId: 's1', customerName: 'Test' },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('SESSION_UPDATED');
    expect(result!.payload.sessionId).toBe('s1');
  });

  it('parses CHECKOUT_REQUESTED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'CHECKOUT_REQUESTED',
      payload: {
        request: {
          requestId: 'r1',
          customerName: 'Jane',
          rentalType: 'STANDARD',
          roomNumber: '101',
          scheduledCheckoutAt: '2026-01-01T10:00:00Z',
          currentTime: '2026-01-01T11:00:00Z',
          lateMinutes: 60,
          lateFeeAmount: 10,
          banApplied: false,
        },
      },
      timestamp: '2026-01-01T11:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('CHECKOUT_REQUESTED');
  });

  it('parses ROOM_STATUS_CHANGED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'ROOM_STATUS_CHANGED',
      payload: {
        roomId: 'room-1',
        previousStatus: RoomStatus.DIRTY,
        newStatus: RoomStatus.CLEANING,
        changedBy: 'staff-1',
        override: false,
      },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ROOM_STATUS_CHANGED');
  });

  it('parses SELECTION_PROPOSED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'SELECTION_PROPOSED',
      payload: { sessionId: 's1', rentalType: 'DOUBLE', proposedBy: 'EMPLOYEE' },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('SELECTION_PROPOSED');
  });

  it('parses ASSIGNMENT_CREATED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'ASSIGNMENT_CREATED',
      payload: { sessionId: 's1', rentalType: 'STANDARD', roomId: 'r1', roomNumber: '105' },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('ASSIGNMENT_CREATED');
  });

  it('parses WAITLIST_CREATED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'WAITLIST_CREATED',
      payload: {
        sessionId: 's1',
        waitlistId: 'wl-1',
        desiredType: 'DOUBLE',
        backupType: 'STANDARD',
        position: 1,
      },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('WAITLIST_CREATED');
  });

  it('parses CHECKOUT_COMPLETED event', () => {
    const result = safeParseRealtimeEvent({
      type: 'CHECKOUT_COMPLETED',
      payload: { requestId: 'r1', kioskDeviceId: 'd1', success: true },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('CHECKOUT_COMPLETED');
  });

  it('returns null when payload does not match schema', () => {
    const result = safeParseRealtimeEvent({
      type: 'SESSION_UPDATED',
      payload: { wrong: 'shape' },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).toBeNull();
  });
});
