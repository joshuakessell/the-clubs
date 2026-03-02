import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/middleware';
import { optionalAuth } from '../auth/middleware';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import {
  getInventorySummary,
  getInventoryAvailable,
  getUnavailableOptions,
  getRoomsByTier,
  getAllRooms,
  getDetailedInventory,
} from '../services/inventoryService';

/**
 * Inventory routes for room and locker availability.
 * Thin HTTP wrappers delegating to inventoryService.
 */
export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/inventory/summary - Get inventory summary by status and type
   */
  fastify.get('/v1/inventory/summary', async (_request, reply) => {
    try {
      const result = await getInventorySummary();
      return reply.send(result);
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch inventory summary');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/inventory/available - Get available (CLEAN) rooms by tier
   */
  fastify.get('/v1/inventory/available', async (_request, reply) => {
    try {
      const result = await getInventoryAvailable();
      return reply.send(result);
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch available inventory');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/inventory/unavailable-options - Unavailable resources for waitlist selection
   */
  fastify.get(
    '/v1/inventory/unavailable-options',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (_request, reply) => {
      try {
        const result = await getUnavailableOptions();
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch unavailable inventory options');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/inventory/rooms-by-tier - Get all rooms grouped by tier for assignment
   */
  fastify.get(
    '/v1/inventory/rooms-by-tier',
    {
      preHandler: [requireAuth],
    },
    async (_request, reply) => {
      try {
        const result = await getRoomsByTier();
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch rooms by tier');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/inventory/rooms - Get all rooms with details
   */
  fastify.get('/v1/inventory/rooms', async (_request, reply) => {
    try {
      const result = await getAllRooms();
      return reply.send(result);
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch rooms');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/inventory/detailed - Get detailed inventory with occupancy info
   */
  fastify.get(
    '/v1/inventory/detailed',
    {
      preHandler: [requireAuth],
    },
    async (_request, reply) => {
      try {
        const result = await getDetailedInventory();
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch detailed inventory');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
