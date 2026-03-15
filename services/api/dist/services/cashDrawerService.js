"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDrawerSession = openDrawerSession;
exports.recordDrawerEvent = recordDrawerEvent;
exports.closeDrawerSession = closeDrawerSession;
/**
 * Cash drawer service — business logic for cash drawer sessions and events.
 *
 * Extracted from routes/cash-drawers.ts. Zero HTTP/Fastify concepts.
 * Migrated to Drizzle ORM typed queries.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function openDrawerSession(input, staffId) {
    return db_1.db.transaction(async (tx) => {
        const [register] = await tx
            .select({ id: schema_1.registerSessions.id, signedOutAt: schema_1.registerSessions.signedOutAt })
            .from(schema_1.registerSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.registerSessions.id, input.registerSessionId));
        if (!register)
            throw new HttpError_1.HttpError(404, 'Register session not found');
        const [activeDrawer] = await tx
            .select({ id: schema_1.cashDrawerSessions.id })
            .from(schema_1.cashDrawerSessions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cashDrawerSessions.registerSessionId, input.registerSessionId), (0, drizzle_orm_1.eq)(schema_1.cashDrawerSessions.status, 'OPEN')))
            .limit(1);
        if (activeDrawer)
            throw new HttpError_1.HttpError(409, 'Cash drawer session already open');
        const [session] = await tx
            .insert(schema_1.cashDrawerSessions)
            .values({
            registerSessionId: input.registerSessionId,
            openedByStaffId: staffId,
            openingFloat: input.openingFloat,
            notes: input.notes || null,
            status: 'OPEN',
        })
            .returning();
        return {
            sessionId: session.id,
            registerSessionId: session.registerSessionId,
            openedByStaffId: session.openedByStaffId,
            openedAt: session.openedAt,
            openingFloat: session.openingFloat,
            status: session.status,
            notes: session.notes,
        };
    });
}
async function recordDrawerEvent(sessionId, input, staffId) {
    return db_1.db.transaction(async (tx) => {
        const [session] = await tx
            .select({ id: schema_1.cashDrawerSessions.id, status: schema_1.cashDrawerSessions.status })
            .from(schema_1.cashDrawerSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.cashDrawerSessions.id, sessionId))
            .for('update');
        if (!session)
            throw new HttpError_1.HttpError(404, 'Cash drawer session not found');
        if (session.status !== 'OPEN')
            throw new HttpError_1.HttpError(409, 'Cash drawer session is closed');
        const [event] = await tx
            .insert(schema_1.cashDrawerEvents)
            .values({
            cashDrawerSessionId: sessionId,
            type: input.type,
            amount: input.amount ?? null,
            reason: input.reason || null,
            createdByStaffId: staffId,
            metadataJson: input.metadataJson ?? null,
        })
            .returning({
            id: schema_1.cashDrawerEvents.id,
            occurredAt: schema_1.cashDrawerEvents.occurredAt,
            type: schema_1.cashDrawerEvents.type,
            amount: schema_1.cashDrawerEvents.amount,
        });
        return {
            eventId: event.id,
            occurredAt: event.occurredAt,
            type: event.type,
            amount: event.amount,
        };
    });
}
async function closeDrawerSession(sessionId, input, staffId) {
    return db_1.db.transaction(async (tx) => {
        const [session] = await tx
            .select()
            .from(schema_1.cashDrawerSessions)
            .where((0, drizzle_orm_1.eq)(schema_1.cashDrawerSessions.id, sessionId))
            .for('update');
        if (!session)
            throw new HttpError_1.HttpError(404, 'Cash drawer session not found');
        if (session.status !== 'OPEN')
            throw new HttpError_1.HttpError(409, 'Cash drawer session is already closed');
        const sums = await tx
            .select({
            type: schema_1.cashDrawerEvents.type,
            amount: (0, drizzle_orm_1.sum)(schema_1.cashDrawerEvents.amount),
        })
            .from(schema_1.cashDrawerEvents)
            .where((0, drizzle_orm_1.eq)(schema_1.cashDrawerEvents.cashDrawerSessionId, session.id))
            .groupBy(schema_1.cashDrawerEvents.type);
        const sumByType = new Map();
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
            .update(schema_1.cashDrawerSessions)
            .set({
            status: 'CLOSED',
            closedByStaffId: staffId,
            closedAt: (0, drizzle_orm_1.sql) `NOW()`,
            countedCash: input.countedCash,
            expectedCash,
            overShort,
            notes: input.notes ?? undefined,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.cashDrawerSessions.id, session.id))
            .returning();
        return {
            sessionId: result.id,
            status: result.status,
            closedAt: result.closedAt || null,
            countedCash: result.countedCash,
            expectedCash: result.expectedCash,
            overShort: result.overShort,
            notes: result.notes,
        };
    });
}
