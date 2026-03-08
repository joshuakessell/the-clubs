"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminLateCheckoutBanAlertRoutes = registerAdminLateCheckoutBanAlertRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
const ExtendBanSchema = zod_1.z.object({
    bannedUntil: zod_1.z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' }),
    managerNotes: zod_1.z.string().optional(),
});
const RemoveBanSchema = zod_1.z.object({
    managerNotes: zod_1.z.string().optional(),
});
function registerAdminLateCheckoutBanAlertRoutes(fastify) {
    /**
     * GET /v1/admin/late-checkout-ban-alerts
     *
     * Returns all currently banned customers (where banned_until > NOW()).
     */
    fastify.get('/v1/admin/late-checkout-ban-alerts', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (_request, reply) => {
        const result = await (0, db_1.query)(`SELECT id, name, membership_number, banned_until
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
    /**
     * POST /v1/admin/late-checkout-ban-alerts/:id/remove-ban
     *
     * Removes the ban entirely (sets banned_until = NULL).
     */
    fastify.post('/v1/admin/late-checkout-ban-alerts/:id/remove-ban', { schema: { body: RemoveBanSchema }, preHandler: [middleware_1.requireReauthForAdmin] }, async (request, reply) => {
        const parsed = request.body;
        try {
            await (0, db_1.transaction)(async (client) => {
                const check = await client.query(`SELECT id, name, banned_until FROM customers WHERE id = $1 FOR UPDATE`, [request.params.id]);
                if (check.rows.length === 0) {
                    const err = new Error('Customer not found');
                    err.statusCode = 404;
                    throw err;
                }
                const customer = check.rows[0];
                await client.query(`UPDATE customers SET banned_until = NULL, updated_at = NOW() WHERE id = $1`, [customer.id]);
                await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
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
                    await client.query(`INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES ($1::uuid, $2::uuid, $3, 'OFFICE_DASHBOARD', $4, true)`, [customer.id, request.staff.staffId, request.staff.name, parsed.managerNotes.trim()]);
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
    /**
     * POST /v1/admin/late-checkout-ban-alerts/:id/extend-ban
     *
     * Extends (or shortens) the ban to a specific date.
     */
    fastify.post('/v1/admin/late-checkout-ban-alerts/:id/extend-ban', { schema: { body: ExtendBanSchema }, preHandler: [middleware_1.requireReauthForAdmin] }, async (request, reply) => {
        const parsed = request.body;
        const newBannedUntil = new Date(parsed.bannedUntil);
        if (newBannedUntil <= new Date()) {
            return reply.status(400).send({ error: 'Ban date must be in the future' });
        }
        try {
            await (0, db_1.transaction)(async (client) => {
                const check = await client.query(`SELECT id, name, banned_until FROM customers WHERE id = $1 FOR UPDATE`, [request.params.id]);
                if (check.rows.length === 0) {
                    const err = new Error('Customer not found');
                    err.statusCode = 404;
                    throw err;
                }
                const customer = check.rows[0];
                await client.query(`UPDATE customers SET banned_until = $1, updated_at = NOW() WHERE id = $2`, [newBannedUntil, customer.id]);
                await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
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
                    await client.query(`INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES ($1::uuid, $2::uuid, $3, 'OFFICE_DASHBOARD', $4, true)`, [customer.id, request.staff.staffId, request.staff.name, parsed.managerNotes.trim()]);
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
