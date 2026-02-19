import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  CustomerActivityActorSchema,
  CustomerActivityEventSchema,
  CustomerActivityMetadataSchemas,
  CustomerNotesListSchema,
  CreateCustomerNoteSchema,
  CustomerActivityResourceRefSchema,
} from '../src/customerActivitySchemas';

const uuid = () => randomUUID();

// ---------------------------------------------------------------------------
// CustomerActivityResourceRefSchema
// ---------------------------------------------------------------------------
describe('CustomerActivityResourceRefSchema', () => {
  it('accepts valid room ref', () => {
    const result = CustomerActivityResourceRefSchema.safeParse({
      type: 'room',
      number: '101',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid locker ref', () => {
    const result = CustomerActivityResourceRefSchema.safeParse({
      type: 'locker',
      number: 'L5',
      resourceId: uuid(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = CustomerActivityResourceRefSchema.safeParse({
      type: 'shelf',
      number: '1',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CustomerActivityActorSchema
// ---------------------------------------------------------------------------
describe('CustomerActivityActorSchema', () => {
  it('accepts valid STAFF actor', () => {
    const result = CustomerActivityActorSchema.safeParse({
      type: 'STAFF',
      staffId: uuid(),
      staffName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects STAFF without staffId', () => {
    const result = CustomerActivityActorSchema.safeParse({
      type: 'STAFF',
      staffName: 'Alice',
    });
    expect(result.success).toBe(false);
  });

  it('rejects STAFF without staffName', () => {
    const result = CustomerActivityActorSchema.safeParse({
      type: 'STAFF',
      staffId: uuid(),
    });
    expect(result.success).toBe(false);
  });

  it('accepts SYSTEM actor without staffId', () => {
    const result = CustomerActivityActorSchema.safeParse({ type: 'SYSTEM' });
    expect(result.success).toBe(true);
  });

  it('accepts CUSTOMER actor', () => {
    const result = CustomerActivityActorSchema.safeParse({ type: 'CUSTOMER' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CustomerActivityMetadataSchemas
// ---------------------------------------------------------------------------
describe('CustomerActivityMetadataSchemas', () => {
  it('CHECKIN_STARTED accepts valid metadata', () => {
    const result = CustomerActivityMetadataSchemas.CHECKIN_STARTED.safeParse({
      laneId: 'lane-1',
      laneSessionId: uuid(),
      mode: 'CHECKIN',
    });
    expect(result.success).toBe(true);
  });

  it('CHECKIN_COMPLETED accepts valid metadata', () => {
    const result = CustomerActivityMetadataSchemas.CHECKIN_COMPLETED.safeParse({
      visitId: uuid(),
      checkinBlockId: uuid(),
      assignedResource: { type: 'room', number: '101' },
      amountCents: 5000,
      currency: 'USD',
    });
    expect(result.success).toBe(true);
  });

  it('CHECKOUT_REQUEST_CREATED accepts valid metadata', () => {
    const result = CustomerActivityMetadataSchemas.CHECKOUT_REQUEST_CREATED.safeParse({
      checkoutRequestId: uuid(),
      visitId: uuid(),
      resource: { type: 'room', number: '101' },
    });
    expect(result.success).toBe(true);
  });

  it('ORDER_PAID accepts valid metadata with line items', () => {
    const result = CustomerActivityMetadataSchemas.ORDER_PAID.safeParse({
      orderId: uuid(),
      totalCents: 1500,
      currency: 'USD',
      lineItems: [{ name: 'Water', quantity: 2, totalCents: 400 }],
    });
    expect(result.success).toBe(true);
  });

  it('NOTE_ADDED accepts valid metadata', () => {
    const result = CustomerActivityMetadataSchemas.NOTE_ADDED.safeParse({
      noteId: uuid(),
      isImportant: true,
      noteLength: 42,
      notePreview: 'Customer requested...',
    });
    expect(result.success).toBe(true);
  });

  it('PAST_DUE_WAIVED accepts valid metadata', () => {
    const result = CustomerActivityMetadataSchemas.PAST_DUE_WAIVED.safeParse({
      previousPastDueCents: 5000,
      newPastDueCents: 0,
      reason: 'Manager discretion',
    });
    expect(result.success).toBe(true);
  });

  it('UPGRADE_STARTED requires target with toResource or toTier', () => {
    const valid = CustomerActivityMetadataSchemas.UPGRADE_STARTED.safeParse({
      visitId: uuid(),
      fromResource: { type: 'room', number: '101' },
      target: { toTier: 'DOUBLE' },
    });
    expect(valid.success).toBe(true);

    const invalid = CustomerActivityMetadataSchemas.UPGRADE_STARTED.safeParse({
      visitId: uuid(),
      fromResource: { type: 'room', number: '101' },
      target: {},
    });
    expect(invalid.success).toBe(false);
  });

  it('ADDON_PURCHASED requires at least one add-on', () => {
    const result = CustomerActivityMetadataSchemas.ADDON_PURCHASED.safeParse({
      visitId: uuid(),
      addOns: [],
      totalCents: 0,
      currency: 'USD',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CustomerActivityEventSchema
// ---------------------------------------------------------------------------
describe('CustomerActivityEventSchema', () => {
  const validEvent = {
    id: uuid(),
    occurredAt: '2026-01-15T10:30:00.000Z',
    customerId: uuid(),
    actionType: 'NOTE_ADDED',
    actionCategory: 'NOTE',
    sourceApp: 'EMPLOYEE_REGISTER',
    actor: { type: 'STAFF', staffId: uuid(), staffName: 'Bob' },
    summary: 'Note added to customer file',
    metadata: {
      noteId: uuid(),
      isImportant: false,
    },
  };

  it('accepts valid full event', () => {
    const result = CustomerActivityEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('rejects invalid actionType', () => {
    const result = CustomerActivityEventSchema.safeParse({
      ...validEvent,
      actionType: 'INVALID_ACTION',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid occurredAt format', () => {
    const result = CustomerActivityEventSchema.safeParse({
      ...validEvent,
      occurredAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CustomerNotesListSchema
// ---------------------------------------------------------------------------
describe('CustomerNotesListSchema', () => {
  it('defaults limit to 50', () => {
    const result = CustomerNotesListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it('coerces string limit to number', () => {
    const result = CustomerNotesListSchema.safeParse({ limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(25);
  });

  it('rejects limit above 200', () => {
    const result = CustomerNotesListSchema.safeParse({ limit: 201 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateCustomerNoteSchema
// ---------------------------------------------------------------------------
describe('CreateCustomerNoteSchema', () => {
  it('accepts valid note', () => {
    const result = CreateCustomerNoteSchema.safeParse({
      note: 'Customer is allergic to latex.',
      isImportant: true,
      sourceApp: 'OFFICE_DASHBOARD',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty note', () => {
    const result = CreateCustomerNoteSchema.safeParse({ note: '' });
    expect(result.success).toBe(false);
  });

  it('rejects note exceeding max length', () => {
    const result = CreateCustomerNoteSchema.safeParse({ note: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });
});
