"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerSpendLedgerRoutes = customerSpendLedgerRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const customerSpendLedger_1 = require("../ledger/customerSpendLedger");
const ListSchema = zod_1.z.object({
    from: zod_1.z.string().datetime().optional(),
    to: zod_1.z.string().datetime().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: zod_1.z.string().optional(),
});
async function customerSpendLedgerRoutes(fastify) {
    /**
     * GET /v1/customers/:customerId/spend-ledger
     */
    fastify.get('/v1/customers/:customerId/spend-ledger', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let parsed;
        try {
            parsed = ListSchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const from = parsed.from ? new Date(parsed.from) : null;
        const to = parsed.to ? new Date(parsed.to) : null;
        try {
            const result = await (0, customerSpendLedger_1.listCustomerSpendLedgerByVisit)({
                customerId: request.params.customerId,
                from,
                to,
                limit: parsed.limit,
                cursor: parsed.cursor ?? null,
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch spend ledger');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/customers/:customerId/visits/:visitId/spend-ledger
     */
    fastify.get('/v1/customers/:customerId/visits/:visitId/spend-ledger', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '200', 10) || 200, 1), 500);
        try {
            const result = await (0, customerSpendLedger_1.listVisitSpendLedgerEntries)({
                customerId: request.params.customerId,
                visitId: request.params.visitId === 'unassigned' ? null : request.params.visitId,
                limit,
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch visit spend ledger');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
