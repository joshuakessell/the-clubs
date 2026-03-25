import type { FastifyInstance } from 'fastify';
import { seedDemoData } from '../../db/seed-demo';

export function registerAdminDemoCatchupRoutes(fastify: FastifyInstance): void {
  /**
   * Catch up the demo Simulator to the present. Only runs if DEMO_MODE=true.
   * The simulator itself handles all bootstrapping (staff, rooms, shifts).
   */
  fastify.post('/v1/admin/demo-catchup', async (request, reply) => {
    if (process.env.DEMO_MODE !== 'true') {
      return reply.code(403).send({ error: 'Not available outside demo mode' });
    }
    try {
      await seedDemoData({ forceReseed: false });
      return reply.send({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fastify.log.error(e, 'Failed to catch up demo data');
      return reply.code(500).send({ error: 'Failed to run simulator', detail: msg });
    }
  });
}
