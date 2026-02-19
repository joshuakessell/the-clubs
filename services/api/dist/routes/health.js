"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRoutes = healthRoutes;
const db_1 = require("../db");
async function healthRoutes(fastify) {
    fastify.get('/health', async (_request, reply) => {
        let isHealthy = fastify.dbHealthy;
        // Auto-recover health status when DB connectivity returns after a startup failure.
        if (!isHealthy && process.env.SKIP_DB !== 'true') {
            try {
                await (0, db_1.query)('SELECT 1');
                fastify.dbHealthy = true;
                isHealthy = true;
            }
            catch {
                isHealthy = false;
            }
        }
        if (!isHealthy) {
            reply.code(503);
        }
        return {
            status: isHealthy ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    });
}
