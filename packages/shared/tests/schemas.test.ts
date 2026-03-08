import { describe, it, expect } from 'vitest';
import {
  RoomSchema,
  RoomStatusUpdateSchema,
  BatchStatusUpdateSchema,
  IdScanPayloadSchema,
  InventorySummarySchema,
} from '../src/schemas';

describe('RoomSchema', () => {
  const validRoom = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    number: '101',
    type: 'STANDARD',
    status: 'CLEAN',
    floor: 1,
    lastStatusChange: '2024-01-01T00:00:00Z',
    overrideFlag: false,
  };

  it('accepts a valid room', () => {
    const result = RoomSchema.safeParse(validRoom);
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = RoomSchema.safeParse({ ...validRoom, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid room type', () => {
    const result = RoomSchema.safeParse({ ...validRoom, type: 'PENTHOUSE' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = RoomSchema.safeParse({ ...validRoom, status: 'UNKNOWN' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive floor', () => {
    const result = RoomSchema.safeParse({ ...validRoom, floor: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts optional assignedToCustomerId', () => {
    const result = RoomSchema.safeParse({
      ...validRoom,
      assignedToCustomerId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(true);
  });
});

describe('RoomStatusUpdateSchema', () => {
  it('accepts valid update', () => {
    const result = RoomStatusUpdateSchema.safeParse({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      newStatus: 'CLEAN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = RoomStatusUpdateSchema.safeParse({
      roomId: 'bad',
      newStatus: 'CLEAN',
    });
    expect(result.success).toBe(false);
  });

  it('defaults override to false', () => {
    const result = RoomStatusUpdateSchema.safeParse({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      newStatus: 'DIRTY',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.override).toBe(false);
    }
  });
});

describe('BatchStatusUpdateSchema', () => {
  it('accepts valid batch', () => {
    const result = BatchStatusUpdateSchema.safeParse({
      roomIds: ['550e8400-e29b-41d4-a716-446655440000'],
      newStatus: 'CLEAN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty roomIds', () => {
    const result = BatchStatusUpdateSchema.safeParse({
      roomIds: [],
      newStatus: 'CLEAN',
    });
    expect(result.success).toBe(false);
  });
});

describe('InventorySummarySchema', () => {
  it('accepts valid summary', () => {
    const result = InventorySummarySchema.safeParse({
      clean: 10, cleaning: 2, dirty: 5, total: 17,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative values', () => {
    const result = InventorySummarySchema.safeParse({
      clean: -1, cleaning: 0, dirty: 0, total: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('IdScanPayloadSchema', () => {
  it('accepts payload with raw barcode', () => {
    const result = IdScanPayloadSchema.safeParse({ raw: '@\nANSI 636...' });
    expect(result.success).toBe(true);
  });

  it('accepts payload with firstName + lastName', () => {
    const result = IdScanPayloadSchema.safeParse({ firstName: 'John', lastName: 'Doe' });
    expect(result.success).toBe(true);
  });

  it('accepts payload with fullName', () => {
    const result = IdScanPayloadSchema.safeParse({ fullName: 'John Doe' });
    expect(result.success).toBe(true);
  });

  it('accepts payload with idNumber', () => {
    const result = IdScanPayloadSchema.safeParse({ idNumber: 'DL123456' });
    expect(result.success).toBe(true);
  });

  it('rejects empty payload (no identifiers)', () => {
    const result = IdScanPayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects payload with only dob (no identifier)', () => {
    const result = IdScanPayloadSchema.safeParse({ dob: '1990-01-01' });
    expect(result.success).toBe(false);
  });
});
