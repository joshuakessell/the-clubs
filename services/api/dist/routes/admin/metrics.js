"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminMetricsRoutes = registerAdminMetricsRoutes;
const middleware_1 = require("../../auth/middleware");
const reportService_1 = require("../../services/reportService");
function registerAdminMetricsRoutes(fastify) {
    fastify.get('/v1/admin/metrics/summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const to = request.query.to ? new Date(request.query.to) : new Date();
            return reply.send(await (0, reportService_1.getCleaningMetricsSummary)(from, to));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch metrics summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/metrics/by-staff', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.query.staffId)
            return reply.status(400).send({ error: 'staffId is required' });
        try {
            const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const to = request.query.to ? new Date(request.query.to) : new Date();
            return reply.send(await (0, reportService_1.getCleaningMetricsByStaff)(request.query.staffId, from, to));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch metrics by staff');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
