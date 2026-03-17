import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { CheckinBlockRow, VisitRow } from '../../visits/types';
import { calculateTotalHoursWithExtension, getLatestBlockEnd } from '../../visits/utils';

export function registerVisitActiveRoutes(fastify: FastifyInstance): void {
  fastify.get<{
    Querystring: { query?: string; membershipNumber?: string; customerName?: string };
  }>('/v1/visits/active', async (request, reply) => {
    try {
      const { query: searchQuery, membershipNumber, customerName } = request.query;

      type VisitSearchRow = VisitRow & { customer_name: string; membership_number: string | null };
      let visitsResult: { rows: VisitSearchRow[] };

      if (membershipNumber) {
        const raw = await db.execute<Record<string, unknown>>(
          sql`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.membership_number = ${membershipNumber}
           ORDER BY v.started_at DESC`
        );
        visitsResult = { rows: raw.rows as unknown as VisitSearchRow[] };
      } else if (customerName) {
        const raw = await db.execute<Record<string, unknown>>(
          sql`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.name ILIKE ${'%' + customerName + '%'}
           ORDER BY v.started_at DESC
           LIMIT 20`
        );
        visitsResult = { rows: raw.rows as unknown as VisitSearchRow[] };
      } else if (searchQuery) {
        const raw = await db.execute<Record<string, unknown>>(
          sql`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL 
             AND (c.membership_number = ${searchQuery} OR c.name ILIKE ${'%' + searchQuery + '%'})
           ORDER BY v.started_at DESC
           LIMIT 20`
        );
        visitsResult = { rows: raw.rows as unknown as VisitSearchRow[] };
      } else {
        return reply
          .status(400)
          .send({ error: 'Must provide query, membershipNumber, or customerName parameter' });
      }

      const activeVisits = await Promise.all(
        visitsResult.rows.map(async (visit) => {
          const blocksRaw = await db.execute<Record<string, unknown>>(
            sql`SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, resource_id, session_id, agreement_signed, created_at, updated_at
             FROM checkin_blocks WHERE visit_id = ${visit.id} ORDER BY ends_at DESC`
          );

          const blocks = blocksRaw.rows as unknown as CheckinBlockRow[];
          const latestBlockEnd = getLatestBlockEnd(blocks);
          const totalHoursIfRenewed = calculateTotalHoursWithExtension(blocks, 6);
          const canFinalExtend = calculateTotalHoursWithExtension(blocks, 2) <= 14;

          return {
            id: visit.id,
            customerId: visit.customer_id,
            customerName: visit.customer_name,
            membershipNumber: visit.membership_number || undefined,
            startedAt: visit.started_at,
            currentCheckoutAt: latestBlockEnd || visit.started_at,
            totalHoursIfRenewed,
            canFinalExtend,
            blocks: blocks.map((block) => ({
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              resourceId: block.resource_id,
              sessionId: block.session_id,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            })),
          };
        })
      );

      return reply.send({ visits: activeVisits });
    } catch (error) {
      fastify.log.error(error, 'Failed to search active visits');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
