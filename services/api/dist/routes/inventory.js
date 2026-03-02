"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryRoutes = inventoryRoutes;
const middleware_1 = require("../auth/middleware");
const middleware_2 = require("../auth/middleware");
const kioskToken_1 = require("../auth/kioskToken");
const inventoryService_1 = require("../services/inventoryService");
/**
 * Inventory routes for room and locker availability.
 * Thin HTTP wrappers delegating to inventoryService.
 */
async function inventoryRoutes(fastify) {
    /**
     * GET /v1/inventory/summary - Get inventory summary by status and type
     */
    fastify.get('/v1/inventory/summary', async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getInventorySummary)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch inventory summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/available - Get available (CLEAN) rooms by tier
     */
    fastify.get('/v1/inventory/available', async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getInventoryAvailable)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch available inventory');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/unavailable-options - Unavailable resources for waitlist selection
     */
    fastify.get('/v1/inventory/unavailable-options', {
        preHandler: [middleware_2.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getUnavailableOptions)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch unavailable inventory options');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/rooms-by-tier - Get all rooms grouped by tier for assignment
     */
    fastify.get('/v1/inventory/rooms-by-tier', {
        preHandler: [middleware_1.requireAuth],
    }, async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getRoomsByTier)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch rooms by tier');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/rooms - Get all rooms with details
     */
    fastify.get('/v1/inventory/rooms', async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getAllRooms)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch rooms');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/detailed - Get detailed inventory with occupancy info
     */
    fastify.get('/v1/inventory/detailed', {
        preHandler: [middleware_1.requireAuth],
    }, async (_request, reply) => {
        try {
            const result = await (0, inventoryService_1.getDetailedInventory)();
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch detailed inventory');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
