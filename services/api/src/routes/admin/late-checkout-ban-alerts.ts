import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';
import { calculateLateFee } from '../../checkout/utils';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertCustomerActivityEvent.
 */
function toQueryable(tx: any) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await tx.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

const ExtendBanSchema = z.object({
  bannedUntil: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' }),
  managerNotes: z.string().optional(),
});

const RemoveBanSchema = z.object({
  managerNotes: z.string().optional(),
});

export function registerAdminLateCheckoutBanAlertRoutes(fastify: FastifyInstance): void {

  // ── Overdue Alerts — real-time list of guests past checkout time ──
  fastify.get(
    '/v1/admin/overdue-alerts',
    { preHandler: [requireAuth, requireAdmin] },
    async (_request, reply) => {
      const result = await db.execute<Record<string, unknown>>(
        sql`SELECT DISTINCT ON (cb.resource_id)
          cb.id as occupancy_id,
          cb.visit_id,
          c.id as customer_id,
          c.name as customer_name,
          CASE WHEN ir.kind = 'room' THEN 'ROOM' ELSE 'LOCKER' END as resource_type,
          ir.number as resource_number,
          cb.starts_at as checkin_at,
          cb.ends_at as scheduled_checkout_at,
          EXTRACT(EPOCH FROM (NOW() - cb.ends_at)) / 60 as late_minutes_raw
        FROM checkin_blocks cb
        JOIN visits v ON cb.visit_id = v.id
        JOIN customers c ON v.customer_id = c.id
        JOIN inventory_resources ir ON cb.resource_id = ir.id
        WHERE cb.resource_id IS NOT NULL
          AND v.ended_at IS NULL
          AND cb.ends_at < NOW()
        ORDER BY cb.resource_id, cb.ends_at DESC`
      );

      type OverdueRow = {
        occupancy_id: string; visit_id: string; customer_id: string; customer_name: string;
        resource_type: string; resource_number: string; checkin_at: Date; scheduled_checkout_at: Date;
        late_minutes_raw: number | string;
      };

      const alerts = (result.rows as unknown as OverdueRow[]).map((r) => {
        const lateMinutes = Math.max(0, Math.floor(Number(r.late_minutes_raw)));
        const { feeAmount, banApplied } = calculateLateFee(lateMinutes);
        return {
          occupancyId: r.occupancy_id,
          visitId: r.visit_id,
          customerId: r.customer_id,
          customerName: r.customer_name,
          resourceType: r.resource_type,
          resourceNumber: r.resource_number,
          checkinAt: r.checkin_at instanceof Date ? r.checkin_at.toISOString() : String(r.checkin_at),
          scheduledCheckoutAt: r.scheduled_checkout_at instanceof Date ? r.scheduled_checkout_at.toISOString() : String(r.scheduled_checkout_at),
          lateMinutes,
          estimatedFee: feeAmount,
          banWouldApply: banApplied,
        };
      });

      // Sort by most overdue first
      alerts.sort((a, b) => b.lateMinutes - a.lateMinutes);

      return reply.send({ alerts });
    }
  );

  // ── Ban Alerts — existing banned customer list ──
  fastify.get(
    '/v1/admin/late-checkout-ban-alerts',
    { preHandler: [requireAuth, requireAdmin] },
    async (_request, reply) => {
      const result = await db.execute<Record<string, unknown>>(
        sql`SELECT id, name, membership_number, banned_until
         FROM customers
         WHERE banned_until IS NOT NULL AND banned_until > NOW()
         ORDER BY banned_until ASC`
      );

      type BanRow = { id: string; name: string; membership_number: string | null; banned_until: Date };
      const alerts = (result.rows as unknown as BanRow[]).map((r) => ({
        id: r.id,
        customerName: r.name,
        membershipNumber: r.membership_number,
        bannedUntil: r.banned_until.toISOString(),
      }));

      return reply.send({ alerts });
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof RemoveBanSchema> }>(
    '/v1/admin/late-checkout-ban-alerts/:id/remove-ban',
    { preHandler: [requireReauthForAdmin] },
    async (request, reply) => {
      const parsed = request.body as z.infer<typeof RemoveBanSchema>;

      try {
        await db.transaction(async (tx) => {
          const check = await tx.execute<Record<string, unknown>>(
            sql`SELECT id, name, banned_until FROM customers WHERE id = ${request.params.id} FOR UPDATE`
          );
          if (check.rows.length === 0) {
            const err = new Error('Customer not found') as Error & { statusCode: number };
            err.statusCode = 404;
            throw err;
          }
          const customer = check.rows[0] as unknown as { id: string; name: string; banned_until: Date | null };

          await tx.execute(
            sql`UPDATE customers SET banned_until = NULL, updated_at = NOW() WHERE id = ${customer.id}`
          );

          await insertCustomerActivityEvent(toQueryable(tx) as any, {
            customerId: customer.id,
            actionType: 'BAN_REMOVED',
            actionCategory: 'ADMIN',
            sourceApp: 'OFFICE_DASHBOARD',
            actorType: 'STAFF',
            actorStaffId: request.staff!.staffId,
            actorStaffName: request.staff!.name,
            summary: 'Ban removed by manager',
            metadata: {
              previousBannedUntil: customer.banned_until?.toISOString() ?? null,
              managerNotes: parsed.managerNotes ?? null,
            },
            dedupeKey: `ACT:BAN_REMOVED:${customer.id}:${Date.now()}`,
            searchParts: [customer.id, customer.name],
          });

          if (parsed.managerNotes?.trim()) {
            await tx.execute(
              sql`INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES (${customer.id}::uuid, ${request.staff!.staffId}::uuid, ${request.staff!.name}, 'OFFICE_DASHBOARD', ${parsed.managerNotes.trim()}, true)`
            );
          }
        });

        return reply.send({ success: true });
      } catch (error: unknown) {
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message });
        request.log.error(error, 'Failed to remove ban');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof ExtendBanSchema> }>(
    '/v1/admin/late-checkout-ban-alerts/:id/extend-ban',
    { preHandler: [requireReauthForAdmin] },
    async (request, reply) => {
      const parsed = request.body as z.infer<typeof ExtendBanSchema>;

      const newBannedUntil = new Date(parsed.bannedUntil);
      if (newBannedUntil <= new Date()) {
        return reply.status(400).send({ error: 'Ban date must be in the future' });
      }

      try {
        await db.transaction(async (tx) => {
          const check = await tx.execute<Record<string, unknown>>(
            sql`SELECT id, name, banned_until FROM customers WHERE id = ${request.params.id} FOR UPDATE`
          );
          if (check.rows.length === 0) {
            const err = new Error('Customer not found') as Error & { statusCode: number };
            err.statusCode = 404;
            throw err;
          }
          const customer = check.rows[0] as unknown as { id: string; name: string; banned_until: Date | null };

          await tx.execute(
            sql`UPDATE customers SET banned_until = ${newBannedUntil}, updated_at = NOW() WHERE id = ${customer.id}`
          );

          await insertCustomerActivityEvent(toQueryable(tx) as any, {
            customerId: customer.id,
            actionType: 'BAN_EXTENDED',
            actionCategory: 'ADMIN',
            sourceApp: 'OFFICE_DASHBOARD',
            actorType: 'STAFF',
            actorStaffId: request.staff!.staffId,
            actorStaffName: request.staff!.name,
            summary: `Ban extended to ${newBannedUntil.toISOString().split('T')[0]}`,
            metadata: {
              previousBannedUntil: customer.banned_until?.toISOString() ?? null,
              newBannedUntil: newBannedUntil.toISOString(),
              managerNotes: parsed.managerNotes ?? null,
            },
            dedupeKey: `ACT:BAN_EXTENDED:${customer.id}:${Date.now()}`,
            searchParts: [customer.id, customer.name],
          });

          if (parsed.managerNotes?.trim()) {
            await tx.execute(
              sql`INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
               VALUES (${customer.id}::uuid, ${request.staff!.staffId}::uuid, ${request.staff!.name}, 'OFFICE_DASHBOARD', ${parsed.managerNotes.trim()}, true)`
            );
          }
        });

        return reply.send({ success: true, bannedUntil: newBannedUntil.toISOString() });
      } catch (error: unknown) {
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message });
        request.log.error(error, 'Failed to extend ban');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
