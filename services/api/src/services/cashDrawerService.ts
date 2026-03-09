/**
 * Cash drawer service — business logic for cash drawer sessions and events.
 *
 * Extracted from routes/cash-drawers.ts. Zero HTTP/Fastify concepts.
 * Migrated to Drizzle ORM typed queries.
 */
import { db } from '../db';
import { cashDrawerSessions, cashDrawerEvents, registerSessions } from '../db/schema';
import { eq, and, sql, sum } from 'drizzle-orm';
import { HttpError } from '../errors/HttpError';

// ── Types ──

export interface OpenDrawerInput { registerSessionId: string; openingFloat: number; notes?: string | null; }
export type DrawerEventType = 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'NO_SALE_OPEN' | 'ADJUSTMENT';
export interface RecordEventInput { type: DrawerEventType; amount?: number | null; reason?: string | null; metadataJson?: Record<string, unknown> | null; }
export interface CloseDrawerInput { countedCash: number; notes?: string | null; }

// ── Service Methods ──

export async function openDrawerSession(input: OpenDrawerInput, staffId: string) {
  return db.transaction(async (tx) => {
    const [register] = await tx
      .select({ id: registerSessions.id, signedOutAt: registerSessions.signedOutAt })
      .from(registerSessions)
      .where(eq(registerSessions.id, input.registerSessionId));
    if (!register) throw new HttpError(404, 'Register session not found');

    const [activeDrawer] = await tx
      .select({ id: cashDrawerSessions.id })
      .from(cashDrawerSessions)
      .where(and(
        eq(cashDrawerSessions.registerSessionId, input.registerSessionId),
        eq(cashDrawerSessions.status, 'OPEN')
      ))
      .limit(1);
    if (activeDrawer) throw new HttpError(409, 'Cash drawer session already open');

    const [session] = await tx
      .insert(cashDrawerSessions)
      .values({
        registerSessionId: input.registerSessionId,
        openedByStaffId: staffId,
        openingFloat: input.openingFloat,
        notes: input.notes || null,
        status: 'OPEN',
      })
      .returning();

    return {
      sessionId: session!.id,
      registerSessionId: session!.registerSessionId,
      openedByStaffId: session!.openedByStaffId,
      openedAt: session!.openedAt,
      openingFloat: session!.openingFloat,
      status: session!.status,
      notes: session!.notes,
    };
  });
}

export async function recordDrawerEvent(sessionId: string, input: RecordEventInput, staffId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: cashDrawerSessions.id, status: cashDrawerSessions.status })
      .from(cashDrawerSessions)
      .where(eq(cashDrawerSessions.id, sessionId))
      .for('update');
    if (!session) throw new HttpError(404, 'Cash drawer session not found');
    if (session.status !== 'OPEN') throw new HttpError(409, 'Cash drawer session is closed');

    const [event] = await tx
      .insert(cashDrawerEvents)
      .values({
        cashDrawerSessionId: sessionId,
        type: input.type,
        amount: input.amount ?? null,
        reason: input.reason || null,
        createdByStaffId: staffId,
        metadataJson: input.metadataJson ?? null,
      })
      .returning({
        id: cashDrawerEvents.id,
        occurredAt: cashDrawerEvents.occurredAt,
        type: cashDrawerEvents.type,
        amount: cashDrawerEvents.amount,
      });

    return {
      eventId: event!.id,
      occurredAt: event!.occurredAt,
      type: event!.type,
      amount: event!.amount,
    };
  });
}

export async function closeDrawerSession(sessionId: string, input: CloseDrawerInput, staffId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(cashDrawerSessions)
      .where(eq(cashDrawerSessions.id, sessionId))
      .for('update');
    if (!session) throw new HttpError(404, 'Cash drawer session not found');
    if (session.status !== 'OPEN') throw new HttpError(409, 'Cash drawer session is already closed');

    const sums = await tx
      .select({
        type: cashDrawerEvents.type,
        amount: sum(cashDrawerEvents.amount),
      })
      .from(cashDrawerEvents)
      .where(eq(cashDrawerEvents.cashDrawerSessionId, session.id))
      .groupBy(cashDrawerEvents.type);

    const sumByType = new Map<string, number>();
    for (const row of sums) {
      sumByType.set(row.type, Number(row.amount ?? 0));
    }

    const paidIn = sumByType.get('PAID_IN') ?? 0;
    const paidOut = sumByType.get('PAID_OUT') ?? 0;
    const drops = sumByType.get('DROP') ?? 0;
    const adjustments = sumByType.get('ADJUSTMENT') ?? 0;
    const cashPaymentsAppliedToOrders = 0; // TODO: add once tender tracking is implemented
    const expectedCash = session.openingFloat + paidIn - paidOut - drops + adjustments + cashPaymentsAppliedToOrders;
    const overShort = input.countedCash - expectedCash;

    const [result] = await tx
      .update(cashDrawerSessions)
      .set({
        status: 'CLOSED',
        closedByStaffId: staffId,
        closedAt: sql`NOW()`,
        countedCash: input.countedCash,
        expectedCash,
        overShort,
        notes: input.notes ?? undefined,
      })
      .where(eq(cashDrawerSessions.id, session.id))
      .returning();

    return {
      sessionId: result!.id,
      status: result!.status,
      closedAt: result!.closedAt || null,
      countedCash: result!.countedCash,
      expectedCash: result!.expectedCash,
      overShort: result!.overShort,
      notes: result!.notes,
    };
  });
}
