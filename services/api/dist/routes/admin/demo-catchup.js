"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminDemoCatchupRoutes = registerAdminDemoCatchupRoutes;
const seed_demo_1 = require("../../db/seed-demo");
function registerAdminDemoCatchupRoutes(fastify) {
    /**
     * Catch up the demo Simulator to the present. Only runs if DEMO_MODE=true.
     */
    fastify.post('/v1/admin/demo-catchup', async (request, reply) => {
        if (process.env.DEMO_MODE !== 'true') {
            return reply.code(403).send({ error: 'Not available outside demo mode' });
        }
        try {
            await (0, seed_demo_1.seedDemoData)({ forceReseed: false });
            return reply.send({ success: true });
        }
        catch (e) {
            fastify.log.error(e, 'Failed to catch up demo data');
            return reply.code(500).send({ error: 'Failed to run simulator' });
        }
    });
}
