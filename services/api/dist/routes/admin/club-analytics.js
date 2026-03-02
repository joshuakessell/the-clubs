"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminClubAnalyticsRoutes = registerAdminClubAnalyticsRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const clubAnalyticsService_1 = require("../../services/clubAnalyticsService");
const AnalyticsRangeSchema = zod_1.z.object({ from: zod_1.z.string().datetime().optional(), to: zod_1.z.string().datetime().optional(), tz: zod_1.z.string().optional().default('America/Chicago') });
function parseAndValidate(body) { return AnalyticsRangeSchema.parse(body); }
function registerAdminClubAnalyticsRoutes(fastify) {
    fastify.get('/v1/admin/club-analytics/employee-summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = parseAndValidate(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getEmployeeSummary)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed)));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch employee summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/club-analytics/sales-by-register', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = parseAndValidate(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getSalesByRegister)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed)));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch sales by register');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/club-analytics/sales-by-hour', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = parseAndValidate(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getSalesByHour)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed)));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch sales by hour');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/club-analytics/top-items', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = parseAndValidate(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getTopItems)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed)));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch top items');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/club-analytics/customer-spending', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const extendedSchema = AnalyticsRangeSchema.extend({ customerId: zod_1.z.string().uuid().optional() });
        let parsed;
        try {
            parsed = extendedSchema.parse(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getCustomerSpending)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed), parsed.customerId));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch customer spending');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/club-analytics/daily-summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = parseAndValidate(request.query);
        }
        catch {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, clubAnalyticsService_1.getDailySummary)((0, clubAnalyticsService_1.parseAnalyticsRange)(parsed)));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch daily summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
