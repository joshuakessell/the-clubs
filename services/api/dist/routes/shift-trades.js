"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftTradeRoutes = shiftTradeRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const shiftService_1 = require("../services/shiftService");
const CreateShiftTradeSchema = zod_1.z.object({ requesterShiftId: zod_1.z.string().uuid(), targetShiftId: zod_1.z.string().uuid() });
const AdminDecisionSchema = zod_1.z.object({ status: zod_1.z.enum(['APPROVED', 'DENIED']), decisionNotes: zod_1.z.string().max(2000).optional() });
async function shiftTradeRoutes(fastify) {
    fastify.get('/v1/schedule/shift-trade-requests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => reply.send({ trades: await (0, shiftService_1.listMyTradeRequests)(request.staff.staffId, request.query) }));
    fastify.post('/v1/schedule/shift-trade-requests', { schema: { body: CreateShiftTradeSchema }, preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const body = request.body;
        const id = await (0, shiftService_1.createTradeRequest)(request.staff.staffId, request.staff.role, body.requesterShiftId, body.targetShiftId);
        return reply.status(201).send({ id });
    });
    fastify.get('/v1/admin/shift-trade-requests', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const status = request.query.status ? zod_1.z.enum(['PENDING', 'APPROVED', 'DENIED']).parse(request.query.status) : undefined;
        return reply.send({ trades: await (0, shiftService_1.listAdminTradeRequests)({ status }) });
    });
    fastify.patch('/v1/admin/shift-trade-requests/:id', { schema: { body: AdminDecisionSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        const result = await (0, shiftService_1.decideTradeRequest)(request.params.id, body.status, request.staff.staffId, request.staff.role, body.decisionNotes);
        if (!result)
            return reply.status(404).send({ error: 'Not found' });
        return reply.send({ success: true });
    });
}
