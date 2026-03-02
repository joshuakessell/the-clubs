import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../../db';
import { requireAdmin, requireAuth } from '../../auth/middleware';

// Rooms must be exactly 3 digits
const RoomNumberSchema = z.string().regex(/^\d{3}$/, 'Number must be exactly 3 digits');
const RoomTypeSchema = z.enum(['STANDARD', 'DOUBLE', 'SPECIAL']);
const StatusSchema = z.enum(['CLEAN', 'DIRTY', 'OUT_OF_SERVICE']);

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  floor: number;
  created_at: string;
  updated_at: string;
  assigned_to_customer_id: string | null;
}

interface LockerRow {
  id: string;
  number: string;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to_customer_id: string | null;
}

export function registerRoomManagementRoutes(fastify: FastifyInstance): void {
  // ─── LIST ALL ROOMS + LOCKERS ─────────────────────────────────────
  fastify.get(
    '/v1/admin/room-management',
    { preHandler: [requireAuth, requireAdmin] },
    async (_request, reply) => {
      const [roomsResult, lockersResult] = await Promise.all([
        query<RoomRow>(
          `SELECT id, number, type, status, floor,
                  created_at, updated_at, assigned_to_customer_id
           FROM rooms
           ORDER BY number ASC`
        ),
        query<LockerRow>(
          `SELECT id, number, status,
                  created_at, updated_at, assigned_to_customer_id
           FROM lockers
           ORDER BY number ASC`
        ),
      ]);

      return reply.send({
        rooms: roomsResult.rows.map((r) => ({
          id: r.id,
          number: r.number,
          type: r.type,
          status: r.status,
          floor: r.floor,
          isOccupied: r.assigned_to_customer_id !== null,
        })),
        lockers: lockersResult.rows.map((l) => ({
          id: l.id,
          number: l.number,
          status: l.status,
          isOccupied: l.assigned_to_customer_id !== null,
        })),
      });
    }
  );

  // ─── CREATE ROOM ──────────────────────────────────────────────────
  const CreateRoomSchema = z.object({
    number: RoomNumberSchema,
    type: RoomTypeSchema,
    floor: z.number().int().min(1).max(10).default(1),
  });

  fastify.post(
    '/v1/admin/room-management/rooms',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let body: z.infer<typeof CreateRoomSchema>;
      try {
        body = CreateRoomSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await query<RoomRow>(
          `INSERT INTO rooms (number, type, floor, status)
           VALUES ($1, $2, $3, 'CLEAN')
           RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`,
          [body.number, body.type, body.floor]
        );

        return reply.status(201).send(result.rows[0]);
      } catch (error: any) {
        if (error?.code === '23505') {
          return reply.status(409).send({ error: `Room ${body.number} already exists` });
        }
        request.log.error(error, 'Failed to create room');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // ─── UPDATE ROOM ──────────────────────────────────────────────────
  const UpdateRoomSchema = z.object({
    type: RoomTypeSchema.optional(),
    floor: z.number().int().min(1).max(10).optional(),
  });

  fastify.patch<{ Params: { roomId: string } }>(
    '/v1/admin/room-management/rooms/:roomId',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let body: z.infer<typeof UpdateRoomSchema>;
      try {
        body = UpdateRoomSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      if (!body.type && !body.floor) {
        return reply.status(400).send({ error: 'At least one field (type, floor) is required' });
      }

      try {
        const setClauses: string[] = [];
        const params: unknown[] = [];
        let idx = 1;

        if (body.type) {
          setClauses.push(`type = $${idx++}`);
          params.push(body.type);
        }
        if (body.floor !== undefined) {
          setClauses.push(`floor = $${idx++}`);
          params.push(body.floor);
        }
        setClauses.push(`updated_at = NOW()`);
        params.push(request.params.roomId);

        const result = await query<RoomRow>(
          `UPDATE rooms SET ${setClauses.join(', ')} WHERE id = $${idx}
           RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`,
          params
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Room not found' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        request.log.error(error, 'Failed to update room');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // ─── SET ROOM STATUS ──────────────────────────────────────────────
  const SetStatusSchema = z.object({
    status: StatusSchema,
  });

  fastify.post<{ Params: { roomId: string } }>(
    '/v1/admin/room-management/rooms/:roomId/set-status',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let body: z.infer<typeof SetStatusSchema>;
      try {
        body = SetStatusSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const current = await client.query<RoomRow>(
            `SELECT id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id
             FROM rooms WHERE id = $1 FOR UPDATE`,
            [request.params.roomId]
          );

          if (current.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const room = current.rows[0]!;

          if (room.status === 'OCCUPIED' && body.status === 'OUT_OF_SERVICE') {
            throw { statusCode: 409, message: 'Cannot set an occupied room to Out of Service. Check out the customer first.' };
          }

          if (room.status === body.status) {
            return room;
          }

          const updated = await client.query<RoomRow>(
            `UPDATE rooms SET status = $1, updated_at = NOW(), last_status_change = NOW()
             WHERE id = $2
             RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`,
            [body.status, room.id]
          );

          return updated.rows[0]!;
        });

        return reply.send(result);
      } catch (error: any) {
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        request.log.error(error, 'Failed to set room status');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // ─── CREATE LOCKER ────────────────────────────────────────────────
  const CreateLockerSchema = z.object({
    number: RoomNumberSchema,
  });

  fastify.post(
    '/v1/admin/room-management/lockers',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let body: z.infer<typeof CreateLockerSchema>;
      try {
        body = CreateLockerSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await query<LockerRow>(
          `INSERT INTO lockers (number, status)
           VALUES ($1, 'CLEAN')
           RETURNING id, number, status, created_at, updated_at, assigned_to_customer_id`,
          [body.number]
        );

        return reply.status(201).send(result.rows[0]);
      } catch (error: any) {
        if (error?.code === '23505') {
          return reply.status(409).send({ error: `Locker ${body.number} already exists` });
        }
        request.log.error(error, 'Failed to create locker');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // ─── SET LOCKER STATUS ────────────────────────────────────────────
  fastify.post<{ Params: { lockerId: string } }>(
    '/v1/admin/room-management/lockers/:lockerId/set-status',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let body: z.infer<typeof SetStatusSchema>;
      try {
        body = SetStatusSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const current = await client.query<LockerRow>(
            `SELECT id, number, status, created_at, updated_at, assigned_to_customer_id
             FROM lockers WHERE id = $1 FOR UPDATE`,
            [request.params.lockerId]
          );

          if (current.rows.length === 0) {
            throw { statusCode: 404, message: 'Locker not found' };
          }

          const locker = current.rows[0]!;

          if (locker.status === 'OCCUPIED' && body.status === 'OUT_OF_SERVICE') {
            throw { statusCode: 409, message: 'Cannot set an occupied locker to Out of Service. Check out the customer first.' };
          }

          if (locker.status === body.status) {
            return locker;
          }

          const updated = await client.query<LockerRow>(
            `UPDATE lockers SET status = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, number, status, created_at, updated_at, assigned_to_customer_id`,
            [body.status, locker.id]
          );

          return updated.rows[0]!;
        });

        return reply.send(result);
      } catch (error: any) {
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        request.log.error(error, 'Failed to set locker status');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
