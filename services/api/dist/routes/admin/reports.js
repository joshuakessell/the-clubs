"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminReportRoutes = registerAdminReportRoutes;
const middleware_1 = require("../../auth/middleware");
const reportService_1 = require("../../services/reportService");
function registerAdminReportRoutes(fastify) {
    fastify.get('/v1/admin/reports/cash-totals', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, reportService_1.getCashTotals)());
        }
        catch (e) {
            request.log.error(e, 'Failed to build cash totals');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/daily-summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, reportService_1.getDailySummary)(request.query.date ?? new Date().toISOString().split('T')[0]));
        }
        catch (e) {
            request.log.error(e, 'Failed to build daily summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/revenue-trend', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, reportService_1.getRevenueTrend)(Number.parseInt(request.query.days ?? '30', 10)));
        }
        catch (e) {
            request.log.error(e, 'Failed to build revenue trend');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/staff-productivity', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            return reply.send(await (0, reportService_1.getStaffProductivity)(request.query.from ?? today, request.query.to ?? today, request.query.staffId));
        }
        catch (e) {
            request.log.error(e, 'Failed to build staff productivity');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/staff-productivity-hourly', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.query.date || !request.query.staffId)
            return reply.status(400).send({ error: 'date and staffId are required' });
        try {
            return reply.send(await (0, reportService_1.getStaffProductivityHourly)(request.query.date, request.query.staffId));
        }
        catch (e) {
            request.log.error(e, 'Failed to build hourly productivity');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/operations-summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            return reply.send(await (0, reportService_1.getOperationsSummary)(request.query.from ?? today, request.query.to ?? today));
        }
        catch (e) {
            request.log.error(e, 'Failed to build operations summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/hourly-heatmap', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, reportService_1.getHourlyHeatmap)(Number.parseInt(request.query.weeks ?? '4', 10)));
        }
        catch (e) {
            request.log.error(e, 'Failed to build hourly heatmap');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/revenue-breakdown', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            return reply.send(await (0, reportService_1.getRevenueBreakdown)(request.query.from ?? today, request.query.to ?? today));
        }
        catch (e) {
            request.log.error(e, 'Failed to build revenue breakdown');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/reports/labor-cost', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            return reply.send(await (0, reportService_1.getLaborCost)(request.query.from ?? today, request.query.to ?? today, Number.parseFloat(request.query.hourlyRate ?? '15')));
        }
        catch (e) {
            request.log.error(e, 'Failed to build labor cost report');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
