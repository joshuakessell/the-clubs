"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoomManagementRoutes = registerRoomManagementRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const roomManagementService_1 = require("../../services/roomManagementService");
const RoomNumberSchema = zod_1.z.string().regex(/^\d{3}$/, 'Number must be exactly 3 digits');
const RoomTypeSchema = zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL']);
const StatusSchema = zod_1.z.enum(['CLEAN', 'DIRTY', 'OUT_OF_SERVICE']);
const CreateRoomSchema = zod_1.z.object({ number: RoomNumberSchema, type: RoomTypeSchema, floor: zod_1.z.number().int().min(1).max(10).default(1) });
const UpdateRoomSchema = zod_1.z.object({ type: RoomTypeSchema.optional(), floor: zod_1.z.number().int().min(1).max(10).optional() });
function registerRoomManagementRoutes(fastify) {
    fastify.get('/v1/admin/room-management', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (_request, reply) => reply.send(await (0, roomManagementService_1.listRoomsAndLockers)()));
    fastify.post('/v1/admin/room-management/rooms', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let body;
        try {
            body = CreateRoomSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            return reply.status(201).send(await (0, roomManagementService_1.createRoom)(body.number, body.type, body.floor));
        }
        catch (e) {
            if (e?.code === '23505')
                return reply.status(409).send({ error: `Room ${body.number} already exists` });
            request.log.error(e, 'Failed to create room');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/room-management/rooms/:roomId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let body;
        try {
            body = UpdateRoomSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        if (!body.type && body.floor === undefined)
            return reply.status(400).send({ error: 'At least one field (type, floor) is required' });
        try {
            return reply.send(await (0, roomManagementService_1.updateRoom)(request.params.roomId, body.type, body.floor));
        }
        catch (e) {
            if (e?.statusCode)
                return reply.status(e.statusCode).send({ error: e.message });
            request.log.error(e, 'Failed to update room');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/rooms/:roomId/set-status', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let body;
        try {
            body = StatusSchema.parse(request.body?.status);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, roomManagementService_1.setRoomStatus)(request.params.roomId, body));
        }
        catch (e) {
            if (e?.statusCode)
                return reply.status(e.statusCode).send({ error: e.message });
            request.log.error(e, 'Failed to set room status');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/lockers', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let body;
        try {
            body = zod_1.z.object({ number: RoomNumberSchema }).parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            return reply.status(201).send(await (0, roomManagementService_1.createLocker)(body.number));
        }
        catch (e) {
            if (e?.code === '23505')
                return reply.status(409).send({ error: `Locker ${body.number} already exists` });
            request.log.error(e, 'Failed to create locker');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/room-management/lockers/:lockerId/set-status', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let body;
        try {
            body = StatusSchema.parse(request.body?.status);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed' });
        }
        try {
            return reply.send(await (0, roomManagementService_1.setLockerStatus)(request.params.lockerId, body));
        }
        catch (e) {
            if (e?.statusCode)
                return reply.status(e.statusCode).send({ error: e.message });
            request.log.error(e, 'Failed to set locker status');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
