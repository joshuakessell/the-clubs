/**
 * Calendar routes — CRUD for club calendar events.
 * All endpoints require admin authentication.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import {
  listCalendarEvents,
  getUpcomingEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../../services/calendarService';

/* ── Validation Schemas ────────────────────────────────────────── */

const CreateEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  eventType: z.enum(['GENERAL', 'WEEKEND_EVENT', 'PRIVATE_PARTY', 'HOLIDAY', 'SPECIAL']).optional(),
  highlight: z.boolean().optional(),
});

const UpdateEventSchema = CreateEventSchema.partial();

/* ── Route Registration ────────────────────────────────────────── */

export function registerCalendarRoutes(fastify: FastifyInstance): void {
  // List events for a month
  fastify.get<{ Querystring: { month?: string } }>(
    '/v1/admin/calendar',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const month = request.query.month ?? new Date().toISOString().slice(0, 7);
      const events = await listCalendarEvents(month);
      const upcoming = await getUpcomingEvents(14);
      return reply.send({ events, upcoming });
    }
  );

  // Create event
  fastify.post(
    '/v1/admin/calendar',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const parsed = CreateEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      const event = await createCalendarEvent({
        ...parsed.data,
        createdBy: request.staff?.staffId,
      });
      return reply.status(201).send({ event });
    }
  );

  // Update event
  fastify.patch<{ Params: { id: string } }>(
    '/v1/admin/calendar/:id',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const parsed = UpdateEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      const event = await updateCalendarEvent(request.params.id, parsed.data);
      if (!event) {
        return reply.status(404).send({ error: 'Event not found' });
      }
      return reply.send({ event });
    }
  );

  // Delete event
  fastify.delete<{ Params: { id: string } }>(
    '/v1/admin/calendar/:id',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const deleted = await deleteCalendarEvent(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Event not found' });
      }
      return reply.send({ success: true });
    }
  );
}
