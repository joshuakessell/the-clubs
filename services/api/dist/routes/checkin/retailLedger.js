"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRetailLedgerRoutes = registerRetailLedgerRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const db_1 = require("../../db");
const payload_1 = require("../../checkin/payload");
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
        let body;
        try {
            body = AddRetailItemsSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            // Find the active lane session
            const sessionResult = await (0, db_1.transaction)(async (client) => {
                const result = await client.query(`SELECT * FROM lane_sessions
             WHERE lane_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')
             ORDER BY created_at DESC
             LIMIT 1`, [laneId]);
                return result.rows[0];
            });
            if (!sessionResult) {
                return reply.status(404).send({ error: 'No active session found' });
            }
            // Create the order linked to this session via metadata
            const orderResult = await (0, orderService_1.createOrder)({
                customerId: sessionResult.customer_id,
                metadataJson: { laneSessionId: sessionResult.id, laneId, addedToLedger: true },
            }, request.staff.staffId);
            // Add line items
            const lineItems = body.items.map((item) => ({
                kind: 'RETAIL',
                sku: item.sku ?? null,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
            }));
            await (0, orderService_1.addLineItems)(orderResult.orderId, lineItems);
            // Broadcast updated session so kiosk + register refresh ledger
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, sessionResult.id));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({
                success: true,
                orderId: orderResult.orderId,
                sessionId: sessionResult.id,
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
