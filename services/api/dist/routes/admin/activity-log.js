"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminActivityLogRoutes = registerAdminActivityLogRoutes;
const utils_1 = require("../../checkin/utils");
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const activityQueryService_1 = require("../../services/activityQueryService");
const ListSchema = zod_1.z.object({
    from: zod_1.z.string().datetime().optional(), to: zod_1.z.string().datetime().optional(), q: zod_1.z.string().optional(),
    customerId: zod_1.z.string().uuid().optional(), actorStaffId: zod_1.z.string().uuid().optional(),
    actionCategories: zod_1.z.string().optional(), actionTypes: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional().default(50), cursor: zod_1.z.string().optional(),
});
function registerAdminActivityLogRoutes(fastify) {
    fastify.get('/v1/admin/activity-log', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = ListSchema.parse(request.query);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            return reply.send(await (0, activityQueryService_1.listActivityEvents)(parsed));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch activity log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/customers/:customerId/activity-log', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '41', 10) || 41, 5), 201);
        try {
            const result = await (0, activityQueryService_1.getCustomerActivityLog)({ customerId: request.params.customerId, centerEventId: request.query.centerEventId, limit });
            return reply.send(result);
        }
        catch (error) {
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            request.log.error(error, 'Failed to fetch customer activity log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/activity-log/audit', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? '50', 10), 1), 200);
            return reply.send(await (0, activityQueryService_1.listAuditLog)({ ...request.query, limit }));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch audit log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/activity-log/stats', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, activityQueryService_1.getActivityStats)(request.query));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch activity log stats');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
