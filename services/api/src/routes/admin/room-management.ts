import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { listRoomsAndLockers, createRoom, updateRoom, setRoomStatus, createLocker, setLockerStatus } from '../../services/roomManagementService';

const RoomNumberSchema = z.string().regex(/^\d{3}$/, 'Number must be exactly 3 digits');
const RoomTypeSchema = z.enum(['STANDARD', 'DOUBLE', 'SPECIAL']);
const StatusSchema = z.enum(['CLEAN', 'DIRTY', 'OUT_OF_SERVICE']);
const CreateRoomSchema = z.object({ number: RoomNumberSchema, type: RoomTypeSchema, floor: z.number().int().min(1).max(10).default(1) });
const UpdateRoomSchema = z.object({ type: RoomTypeSchema.optional(), floor: z.number().int().min(1).max(10).optional() });

export function registerRoomManagementRoutes(fastify: FastifyInstance): void {
  fastify.get('/v1/admin/room-management', { preHandler: [requireAuth, requireAdmin] }, async (_request, reply) => reply.send(await listRoomsAndLockers()));

  fastify.post('/v1/admin/room-management/rooms', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let body: z.infer<typeof CreateRoomSchema>; try { body = CreateRoomSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    try { return reply.status(201).send(await createRoom(body.number, body.type, body.floor)); }
    catch (e: any) { if (e?.code === '23505') return reply.status(409).send({ error: `Room ${body.number} already exists` }); request.log.error(e, 'Failed to create room'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.patch<{ Params: { roomId: string } }>('/v1/admin/room-management/rooms/:roomId', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let body: z.infer<typeof UpdateRoomSchema>; try { body = UpdateRoomSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    if (!body.type && body.floor === undefined) return reply.status(400).send({ error: 'At least one field (type, floor) is required' });
    try { return reply.send(await updateRoom(request.params.roomId, body.type, body.floor)); }
    catch (e: any) { if (e?.statusCode) return reply.status(e.statusCode).send({ error: e.message }); request.log.error(e, 'Failed to update room'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post<{ Params: { roomId: string } }>('/v1/admin/room-management/rooms/:roomId/set-status', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let body: z.infer<typeof StatusSchema>; try { body = StatusSchema.parse((request.body as any)?.status); } catch (e) { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await setRoomStatus(request.params.roomId, body)); }
    catch (e: any) { if (e?.statusCode) return reply.status(e.statusCode).send({ error: e.message }); request.log.error(e, 'Failed to set room status'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post('/v1/admin/room-management/lockers', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let body: { number: string }; try { body = z.object({ number: RoomNumberSchema }).parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    try { return reply.status(201).send(await createLocker(body.number)); }
    catch (e: any) { if (e?.code === '23505') return reply.status(409).send({ error: `Locker ${body.number} already exists` }); request.log.error(e, 'Failed to create locker'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post<{ Params: { lockerId: string } }>('/v1/admin/room-management/lockers/:lockerId/set-status', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let body: z.infer<typeof StatusSchema>; try { body = StatusSchema.parse((request.body as any)?.status); } catch (e) { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await setLockerStatus(request.params.lockerId, body)); }
    catch (e: any) { if (e?.statusCode) return reply.status(e.statusCode).send({ error: e.message }); request.log.error(e, 'Failed to set locker status'); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
