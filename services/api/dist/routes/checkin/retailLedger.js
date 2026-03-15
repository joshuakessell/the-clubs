"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRetailLedgerRoutes = registerRetailLedgerRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const payload_1 = require("../../checkin/payload");
const types_1 = require("../../checkin/types");
const orderService_1 = require("../../services/orderService");
const AddRetailItemsSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        sku: zod_1.z.string().optional().nullable(),
        name: zod_1.z.string().min(1),
        quantity: zod_1.z.number().int().positive(),
        unitPrice: zod_1.z.number().nonnegative(),
    })).min(1),
});
function registerRetailLedgerRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/add-retail-items
     *
     * Creates a retail order linked to the active lane session so the items
     * appear on the check-in ledger. The order stays OPEN (unpaid) — the
     * customer pays for everything during the normal check-in payment step.
     */
    fastify.post('/v1/checkin/lane/:laneId/add-retail-items', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { laneId } = request.params;
        const body = request.body;
        try {
            // Find the active lane session
            const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status NOT IN ('COMPLETED', 'CANCELLED')
           ORDER BY created_at DESC
           LIMIT 1`);
            const session = sessionResult.rows[0];
            if (!session) {
                return reply.status(404).send({ error: 'No active session found' });
            }
            // Create the order linked to this session via metadata
            const orderResult = await (0, orderService_1.createOrder)({
                customerId: session.customer_id,
                metadataJson: { laneSessionId: session.id, laneId, addedToLedger: true },
            }, request.staff.staffId);
            // Add line items
            const lineItems = body.items.map((item) => ({
                kind: 'RETAIL',
                sku: item.sku ?? null,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toString(),
            }));
            await (0, orderService_1.addLineItems)(orderResult.orderId, lineItems);
            // buildFullSessionUpdatedPayload is already Drizzle-native — no transaction wrapper needed
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(session.id);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({
                success: true,
                orderId: orderResult.orderId,
                sessionId: session.id,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to add retail items to ledger');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
