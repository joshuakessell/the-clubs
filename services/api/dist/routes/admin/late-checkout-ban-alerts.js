"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminLateCheckoutBanAlertRoutes = registerAdminLateCheckoutBanAlertRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
const utils_2 = require("../../checkout/utils");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertCustomerActivityEvent.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const parts = queryText.split(/\$\d+/);
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            for (let i = 0; i < parts.length; i++) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
                if (i < values.length) {
                    built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
                }
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
const ExtendBanSchema = zod_1.z.object({
    bannedUntil: zod_1.z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' }),
    managerNotes: zod_1.z.string().optional(),
});
const RemoveBanSchema = zod_1.z.object({
    managerNotes: zod_1.z.string().optional(),
});
function registerAdminLateCheckoutBanAlertRoutes(fastify) {
    // ── Overdue Alerts — real-time list of guests past checkout time ──
    fastify.get('/v1/admin/overdue-alerts', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (_request, reply) => {
        const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT DISTINCT ON (cb.resource_id)
          cb.id as occupancy_id,
          cb.visit_id,
          c.id as customer_id,
          c.name as customer_name,
          CASE WHEN ir.kind = 'room' THEN 'ROOM' ELSE 'LOCKER' END as resource_type,
          ir.number as resource_number,
          cb.starts_at as checkin_at,
          cb.ends_at as scheduled_checkout_at,
          EXTRACT(EPOCH FROM (NOW() - cb.ends_at)) / 60 as late_minutes_raw
        FROM checkin_blocks cb
        JOIN visits v ON cb.visit_id = v.id
        JOIN customers c ON v.customer_id = c.id
        JOIN inventory_resources ir ON cb.resource_id = ir.id
        WHERE cb.resource_id IS NOT NULL
          AND v.ended_at IS NULL
          AND cb.ends_at < NOW()
        ORDER BY cb.resource_id, cb.ends_at DESC`);
        const alerts = result.rows.map((r) => {
            const lateMinutes = Math.max(0, Math.floor(Number(r.late_minutes_raw)));
            const { feeAmount, banApplied } = (0, utils_2.calculateLateFee)(lateMinutes);
            return {
                occupancyId: r.occupancy_id,
                visitId: r.visit_id,
                customerId: r.customer_id,
                customerName: r.customer_name,
                resourceType: r.resource_type,
                resourceNumber: r.resource_number,
                checkinAt: r.checkin_at instanceof Date ? r.checkin_at.toISOString() : String(r.checkin_at),
                scheduledCheckoutAt: r.scheduled_checkout_at instanceof Date ? r.scheduled_checkout_at.toISOString() : String(r.scheduled_checkout_at),
                lateMinutes,
                estimatedFee: feeAmount,
                banWouldApply: banApplied,
            };
        });
        // Sort by most overdue first
        alerts.sort((a, b) => b.lateMinutes - a.lateMinutes);
        return reply.send({ alerts });
    });
    // ── Ban Alerts — existing banned customer list ──
    fastify.get('/v1/admin/late-checkout-ban-alerts', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (_request, reply) => {
        const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, membership_number, banned_until
         FROM customers
         WHERE banned_until IS NOT NULL AND banned_until > NOW()
         ORDER BY banned_until ASC`);
        const alerts = result.rows.map((r) => ({
            id: r.id,
            customerName: r.name,
            membershipNumber: r.membership_number,
            bannedUntil: r.banned_until.toISOString(),
        }));
        return reply.send({ alerts });
    });
    fastify.post('/v1/admin/late-checkout-ban-alerts/:id/remove-ban', { preHandler: [middleware_1.requireReauthForAdmin] }, async (request, reply) => {
        const parsed = request.body;
        try {
            await db_1.db.transaction(async (tx) => {
                const check = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, banned_until FROM customers WHERE id = ${request.params.id} FOR UPDATE`);
                if (check.rows.length === 0) {
                    const err = new Error('Customer not found');
                    err.statusCode = 404;
                    throw err;
                }
                const customer = check.rows[0];
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE customers SET banned_until = NULL, updated_at = NOW() WHERE id = ${customer.id}`);
                await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
                    customerId: customer.id,
                    actionType: 'BAN_REMOVED',
                    actionCategory: 'ADMIN',
                    sourceApp: 'OFFICE_DASHBOARD',
                    actorType: 'STAFF',
                    actorStaffId: request.staff.staffId,
                    actorStaffName: request.staff.name,
                    summary: 'Ban removed by manager',
                    metadata: {
                        previousBannedUntil: customer.banned_until?.toISOString() ?? null,
                        managerNotes: parsed.managerNotes ?? null,
                    },
                    dedupeKey: `ACT:BAN_REMOVED:${customer.id}:${Date.now()}`,
                    searchParts: [customer.id, customer.name],
                });
                if (parsed.managerNotes?.trim()) {
                    await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES (${customer.id}::uuid, ${request.staff.staffId}::uuid, ${request.staff.name}, 'OFFICE_DASHBOARD', ${parsed.managerNotes.trim()}, true)`);
                }
            });
            return reply.send({ success: true });
        }
        catch (error) {
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            request.log.error(error, 'Failed to remove ban');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/late-checkout-ban-alerts/:id/extend-ban', { preHandler: [middleware_1.requireReauthForAdmin] }, async (request, reply) => {
        const parsed = request.body;
        const newBannedUntil = new Date(parsed.bannedUntil);
        if (newBannedUntil <= new Date()) {
            return reply.status(400).send({ error: 'Ban date must be in the future' });
        }
        try {
            await db_1.db.transaction(async (tx) => {
                const check = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, banned_until FROM customers WHERE id = ${request.params.id} FOR UPDATE`);
                if (check.rows.length === 0) {
                    const err = new Error('Customer not found');
                    err.statusCode = 404;
                    throw err;
                }
                const customer = check.rows[0];
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE customers SET banned_until = ${newBannedUntil}, updated_at = NOW() WHERE id = ${customer.id}`);
                await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
                    customerId: customer.id,
                    actionType: 'BAN_EXTENDED',
                    actionCategory: 'ADMIN',
                    sourceApp: 'OFFICE_DASHBOARD',
                    actorType: 'STAFF',
                    actorStaffId: request.staff.staffId,
                    actorStaffName: request.staff.name,
                    summary: `Ban extended to ${newBannedUntil.toISOString().split('T')[0]}`,
                    metadata: {
                        previousBannedUntil: customer.banned_until?.toISOString() ?? null,
                        newBannedUntil: newBannedUntil.toISOString(),
                        managerNotes: parsed.managerNotes ?? null,
                    },
                    dedupeKey: `ACT:BAN_EXTENDED:${customer.id}:${Date.now()}`,
                    searchParts: [customer.id, customer.name],
                });
                if (parsed.managerNotes?.trim()) {
                    await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES (${customer.id}::uuid, ${request.staff.staffId}::uuid, ${request.staff.name}, 'OFFICE_DASHBOARD', ${parsed.managerNotes.trim()}, true)`);
                }
            });
            return reply.send({ success: true, bannedUntil: newBannedUntil.toISOString() });
        }
        catch (error) {
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            request.log.error(error, 'Failed to extend ban');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
