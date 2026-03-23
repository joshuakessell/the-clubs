import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sql, eq, isNull, ilike, or, and, desc } from 'drizzle-orm';
import { visits, customers } from '../../db/schema/index';
import type { CheckinBlockRow, VisitRow } from '../../visits/types';
import { calculateTotalHoursWithExtension, getLatestBlockEnd } from '../../visits/utils';

export function registerVisitActiveRoutes(fastify: FastifyInstance): void {
  fastify.get<{
    Querystring: { query?: string; membershipNumber?: string; customerName?: string };
  }>('/v1/visits/active', async (request, reply) => {
    try {
      const { query: searchQuery, membershipNumber, customerName } = request.query;

      type VisitSearchRow = VisitRow & { customer_name: string; membership_number: string | null };
      if (!membershipNumber && !customerName && !searchQuery) {
        return reply
          .status(400)
          .send({ error: 'Must provide query, membershipNumber, or customerName parameter' });
      }

      let condition: any = isNull(visits.endedAt);

      if (membershipNumber) {
        condition = and(condition, eq(customers.membershipNumber, String(membershipNumber)));
      } else if (customerName) {
        condition = and(condition, ilike(customers.name, `%${customerName}%`));
      } else if (searchQuery) {
        condition = and(
          condition,
          or(
            eq(customers.membershipNumber, String(searchQuery)),
            ilike(customers.name, `%${searchQuery}%`)
          )
        );
      }

      let query = db
        .select({
          id: visits.id,
          customer_id: visits.customerId,
          started_at: visits.startedAt,
          ended_at: visits.endedAt,
          created_at: visits.createdAt,
          updated_at: visits.updatedAt,
          customer_name: customers.name,
          membership_number: customers.membershipNumber,
        })
        .from(visits)
        .innerJoin(customers, eq(visits.customerId, customers.id))
        .where(condition)
        .orderBy(desc(visits.startedAt));

      if (!membershipNumber) {
        query = query.limit(20) as any;
      }

      const rawRows = await query;
      const visitsResult = { rows: rawRows as unknown as VisitSearchRow[] };

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
