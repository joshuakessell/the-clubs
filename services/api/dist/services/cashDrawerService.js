"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDrawerSession = openDrawerSession;
exports.recordDrawerEvent = recordDrawerEvent;
exports.closeDrawerSession = closeDrawerSession;
/**
 * Cash drawer service — business logic for cash drawer sessions and events.
 *
 * Extracted from routes/cash-drawers.ts. Zero HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const HttpError_1 = require("../errors/HttpError");
async function openDrawerSession(input, staffId) {
    return (0, db_1.transaction)(async (client) => {
        const registerResult = await client.query(`SELECT id, signed_out_at FROM register_sessions WHERE id = $1`, [input.registerSessionId]);
        if (registerResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Register session not found');
        const activeDrawer = await client.query(`SELECT id FROM cash_drawer_sessions WHERE register_session_id = $1 AND status = 'OPEN' LIMIT 1`, [input.registerSessionId]);
        if (activeDrawer.rows.length > 0)
            throw new HttpError_1.HttpError(409, 'Cash drawer session already open');
        const insertResult = await client.query(`INSERT INTO cash_drawer_sessions (register_session_id, opened_by_staff_id, opening_float, notes, status) VALUES ($1, $2, $3, $4, 'OPEN') RETURNING *`, [input.registerSessionId, staffId, input.openingFloat, input.notes || null]);
        const session = insertResult.rows[0];
        return {
            sessionId: session.id, registerSessionId: session.register_session_id, openedByStaffId: session.opened_by_staff_id,
            openedAt: session.opened_at.toISOString(), openingFloat: session.opening_float, status: session.status, notes: session.notes,
        };
    });
}
async function recordDrawerEvent(sessionId, input, staffId) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT id, status FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
        if (sessionResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Cash drawer session not found');
        if (sessionResult.rows[0].status !== 'OPEN')
            throw new HttpError_1.HttpError(409, 'Cash drawer session is closed');
        const insertResult = await client.query(`INSERT INTO cash_drawer_events (cash_drawer_session_id, type, amount, reason, created_by_staff_id, metadata_json) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, occurred_at, type, amount`, [sessionId, input.type, input.amount ?? null, input.reason || null, staffId, input.metadataJson ?? null]);
        const event = insertResult.rows[0];
        return { eventId: event.id, occurredAt: event.occurred_at.toISOString(), type: event.type, amount: event.amount };
    });
}
async function closeDrawerSession(sessionId, input, staffId) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT * FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
        if (sessionResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Cash drawer session not found');
        const session = sessionResult.rows[0];
        if (session.status !== 'OPEN')
            throw new HttpError_1.HttpError(409, 'Cash drawer session is already closed');
        const sums = await client.query(`SELECT type, SUM(amount) as amount FROM cash_drawer_events WHERE cash_drawer_session_id = $1 GROUP BY type`, [session.id]);
        const sumByType = new Map();
        for (const row of sums.rows) {
            sumByType.set(row.type, typeof row.amount === 'number' ? row.amount : Number(row.amount ?? 0));
        }
        const paidIn = sumByType.get('PAID_IN') ?? 0;
        const paidOut = sumByType.get('PAID_OUT') ?? 0;
        const drops = sumByType.get('DROP') ?? 0;
        const adjustments = sumByType.get('ADJUSTMENT') ?? 0;
        const cashPaymentsAppliedToOrders = 0; // TODO: add once tender tracking is implemented
        const expectedCash = session.opening_float + paidIn - paidOut - drops + adjustments + cashPaymentsAppliedToOrders;
        const overShort = input.countedCash - expectedCash;
        const updated = await client.query(`UPDATE cash_drawer_sessions SET status = 'CLOSED', closed_by_staff_id = $1, closed_at = NOW(), counted_cash = $2, expected_cash = $3, over_short = $4, notes = COALESCE($5, notes) WHERE id = $6 RETURNING *`, [staffId, input.countedCash, expectedCash, overShort, input.notes ?? null, session.id]);
        const result = updated.rows[0];
        return {
            sessionId: result.id, status: result.status, closedAt: result.closed_at?.toISOString() || null,
            countedCash: result.counted_cash, expectedCash: result.expected_cash, overShort: result.over_short, notes: result.notes,
        };
    });
}
