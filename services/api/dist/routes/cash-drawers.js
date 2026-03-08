"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cashDrawerRoutes = cashDrawerRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const idempotency_1 = require("../middleware/idempotency");
const cashDrawerService_1 = require("../services/cashDrawerService");
const CashDrawerOpenSchema = zod_1.z.object({ registerSessionId: zod_1.z.string().uuid(), openingFloat: zod_1.z.number().int().nonnegative(), notes: zod_1.z.string().optional().nullable() });
const CashDrawerEventSchema = zod_1.z.object({
    type: zod_1.z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT']),
    amount: zod_1.z.number().int().optional().nullable(), reason: zod_1.z.string().optional().nullable(), metadataJson: zod_1.z.record(zod_1.z.unknown()).optional().nullable(),
}).superRefine((value, ctx) => {
    if (value.type === 'NO_SALE_OPEN') {
        if (value.amount !== null && value.amount !== undefined) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'amount must be null for NO_SALE_OPEN', path: ['amount'] });
        }
        return;
    }
    if (value.amount === null || value.amount === undefined) {
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'amount is required for money-moving events', path: ['amount'] });
        return;
    }
    if (value.type !== 'ADJUSTMENT' && value.amount < 0)
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'amount must be >= 0 for this event type', path: ['amount'] });
});
const CashDrawerCloseSchema = zod_1.z.object({ countedCash: zod_1.z.number().int().nonnegative(), notes: zod_1.z.string().optional().nullable() });
async function cashDrawerRoutes(fastify) {
    fastify.post('/v1/cash-drawers/open', { schema: { body: CashDrawerOpenSchema }, preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        return reply.send(await (0, cashDrawerService_1.openDrawerSession)(body, request.staff.staffId));
    });
    fastify.post('/v1/cash-drawers/:sessionId/events', { schema: { body: CashDrawerEventSchema }, preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        return reply.send(await (0, cashDrawerService_1.recordDrawerEvent)(request.params.sessionId, body, request.staff.staffId));
    });
    fastify.post('/v1/cash-drawers/:sessionId/close', { schema: { body: CashDrawerCloseSchema }, preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        return reply.send(await (0, cashDrawerService_1.closeDrawerSession)(request.params.sessionId, body, request.staff.staffId));
    });
}
