import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { ClubEventDomainSchema, ClubEventTypeSchema } from '@the-clubs/shared';

// ---------------------------------------------------------------------------
// Query schema — all optional filters
// ---------------------------------------------------------------------------
const ClubLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  domain: ClubEventDomainSchema.optional(),
  eventType: ClubEventTypeSchema.optional(),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  registerId: z.string().optional(),
  orderId: z.string().uuid().optional(),
  visitId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
});

type ClubLogQuery = z.infer<typeof ClubLogQuerySchema>;

interface ClubEventDbRow {
  id: string;
  occurred_at: Date;
  event_type: string;
  event_domain: string;
  source_app: string;
  register_id: string | null;
  staff_id: string | null;
  staff_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  visit_id: string | null;
  order_id: string | null;
  amount: number | null;
  currency: string;
  summary: string;
  metadata: Record<string, unknown>;
}

/**
 * Adapter: wraps the drizzle `db` instance to act like a query function.
 * Needed because club-log builds dynamic WHERE clauses with positional params.
 */
function toQueryable() {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
      const values = params ?? [];
      let built = sql.empty();
      const regex = /\$(\d+)/g;
      let lastIndex = 0;
      for (const match of queryText.matchAll(regex)) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex, match.index))}`;
        const paramIndex = Number.parseInt(match[1]!, 10) - 1;
        built = sql`${built}${values[paramIndex]}`;
        lastIndex = match.index! + match[0].length;
      }
      if (lastIndex < queryText.length) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex))}`;
      }
      const result = await db.execute(built);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerAdminClubLogRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: ClubLogQuery }>(
    '/v1/admin/club-log',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      let parsed: ClubLogQuery;
      try {
        parsed = ClubLogQuerySchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const { limit, cursor, from, to, domain, eventType, staffId, customerId, registerId, orderId, visitId, search } = parsed;

      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (cursor) {
          conditions.push(`ce.occurred_at <= (SELECT occurred_at FROM club_events WHERE id = $${paramIdx}) AND ce.id != $${paramIdx}`);
          params.push(cursor);
          paramIdx++;
        }

        if (from) {
          conditions.push(`ce.occurred_at >= $${paramIdx}`);
          params.push(new Date(from));
          paramIdx++;
        }
        if (to) {
          conditions.push(`ce.occurred_at <= $${paramIdx}`);
          params.push(new Date(to));
          paramIdx++;
        }

        if (domain) {
          conditions.push(`ce.event_domain = $${paramIdx}`);
          params.push(domain);
          paramIdx++;
        }
        if (eventType) {
          conditions.push(`ce.event_type = $${paramIdx}`);
          params.push(eventType);
          paramIdx++;
        }
        if (staffId) {
          conditions.push(`ce.staff_id = $${paramIdx}::uuid`);
          params.push(staffId);
          paramIdx++;
        }
        if (customerId) {
          conditions.push(`ce.customer_id = $${paramIdx}::uuid`);
          params.push(customerId);
          paramIdx++;
        }
        if (registerId) {
          conditions.push(`ce.register_id = $${paramIdx}`);
          params.push(registerId);
          paramIdx++;
        }
        if (orderId) {
          conditions.push(`ce.order_id = $${paramIdx}::uuid`);
          params.push(orderId);
          paramIdx++;
        }
        if (visitId) {
          conditions.push(`ce.visit_id = $${paramIdx}::uuid`);
          params.push(visitId);
          paramIdx++;
        }
        if (search) {
          conditions.push(`ce.search_blob ILIKE '%' || $${paramIdx} || '%'`);
          params.push(search);
          paramIdx++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        params.push(limit + 1);
        const limitParam = `$${paramIdx}`;

        const queryText = `
          SELECT ce.id, ce.occurred_at, ce.event_type, ce.event_domain, ce.source_app,
                 ce.register_id, ce.staff_id, ce.staff_name,
                 ce.customer_id, ce.customer_name, ce.visit_id, ce.order_id,
                 ce.amount, ce.currency, ce.summary, ce.metadata
          FROM club_events ce
          ${whereClause}
          ORDER BY ce.occurred_at DESC, ce.id DESC
          LIMIT ${limitParam}
        `;

        const qClient = toQueryable();
        const result = await qClient.query<ClubEventDbRow>(queryText, params);

        const hasMore = result.rows.length > limit;
        const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
        const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1]!.id : null;

        const events = rows.map((r) => ({
          id: r.id,
          occurredAt: new Date(r.occurred_at).toISOString(),
          eventType: r.event_type,
          eventDomain: r.event_domain,
          sourceApp: r.source_app,
          registerId: r.register_id,
          staffId: r.staff_id,
          staffName: r.staff_name,
          customerId: r.customer_id,
          customerName: r.customer_name,
          visitId: r.visit_id,
          orderId: r.order_id,
          amount: r.amount,
          currency: r.currency,
          summary: r.summary,
          metadata: r.metadata,
        }));

        return reply.send({
          events,
          nextCursor,
          hasMore,
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch club log');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
