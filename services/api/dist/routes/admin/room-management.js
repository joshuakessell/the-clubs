"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoomManagementRoutes = registerRoomManagementRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const roomManagementService_1 = require("../../services/roomManagementService");
const utils_1 = require("../../checkin/utils");
const RoomNumberSchema = zod_1.z.string().regex(/^\d{3}$/, 'Number must be exactly 3 digits');
const RoomTypeSchema = zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL']);
const StatusSchema = zod_1.z.enum(['CLEAN', 'DIRTY', 'OUT_OF_SERVICE']);
const SetStatusBodySchema = zod_1.z.object({ status: StatusSchema });
const CreateRoomSchema = zod_1.z.object({ number: RoomNumberSchema, type: RoomTypeSchema, floor: zod_1.z.number().int().min(1).max(10).default(1) });
const UpdateRoomSchema = zod_1.z.object({ type: RoomTypeSchema.optional(), floor: zod_1.z.number().int().min(1).max(10).optional() });
const CreateLockerSchema = zod_1.z.object({ number: RoomNumberSchema });
function registerRoomManagementRoutes(fastify) {
    fastify.get('/v1/admin/room-management', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (_request, reply) => reply.send(await (0, roomManagementService_1.listRoomsAndLockers)()));
    fastify.post('/v1/admin/room-management/rooms', { schema: { body: CreateRoomSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const body = request.body;
        try {
            return reply.status(201).send(await (0, roomManagementService_1.createRoom)(body.number, body.type, body.floor));
        }
        catch (e) {
            const dbErr = e;
            if (dbErr?.code === '23505') {
                return reply.status(409).send({ error: `Room ${body.number} already exists` });
            }
            request.log.error(e, 'Failed to create room');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/room-management/rooms/:roomId', { schema: { body: UpdateRoomSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        if (!body.type && body.floor === undefined)
            return reply.status(400).send({ error: 'At least one field (type, floor) is required' });
        try {
            return reply.send(await (0, roomManagementService_1.updateRoom)(request.params.roomId, body.type, body.floor));
        }
        catch (e) {
            const httpErr = (0, utils_1.getHttpError)(e);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            }
            request.log.error(e, 'Failed to update room');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/rooms/:roomId/set-status', { schema: { body: SetStatusBodySchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const body = request.body;
        try {
            return reply.send(await (0, roomManagementService_1.setRoomStatus)(request.params.roomId, body.status));
        }
        catch (e) {
            const httpErr = (0, utils_1.getHttpError)(e);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            }
            request.log.error(e, 'Failed to set room status');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/lockers', { schema: { body: CreateLockerSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const body = request.body;
        try {
            return reply.status(201).send(await (0, roomManagementService_1.createLocker)(body.number));
        }
        catch (e) {
            const dbErr = e;
            if (dbErr?.code === '23505') {
                return reply.status(409).send({ error: `Locker ${body.number} already exists` });
            }
            request.log.error(e, 'Failed to create locker');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/lockers/:lockerId/set-status', { schema: { body: SetStatusBodySchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const body = request.body;
        try {
            return reply.send(await (0, roomManagementService_1.setLockerStatus)(request.params.lockerId, body.status));
        }
        catch (e) {
            const httpErr = (0, utils_1.getHttpError)(e);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            }
            request.log.error(e, 'Failed to set locker status');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
