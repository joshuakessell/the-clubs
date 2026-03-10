import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';

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
