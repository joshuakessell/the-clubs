import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { transaction } from '../../db';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';

const ListSchema = z.object({
  status: z.enum(['PENDING', 'RESOLVED']).optional().default('PENDING'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const DecideSchema = z.object({
  decision: z.enum(['APPROVE', 'DENY']),
  banDays: z.coerce.number().int().min(1).max(365).optional().default(30),
  managerNotes: z.string().optional(),
});

export function registerAdminLateCheckoutBanAlertRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/late-checkout-ban-alerts
   */
  fastify.get<{ Querystring: z.infer<typeof ListSchema> }>(
    '/v1/admin/late-checkout-ban-alerts',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: z.infer<typeof ListSchema>;
      try {
        parsed = ListSchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const status = parsed.status;

      const rows = await transaction((client) =>
        client.query<{
          id: string;
          customer_id: string;
          checkout_request_id: string;
          occupancy_id: string;
          visit_id: string | null;
          late_minutes: number;
          fee_amount_cents: number;
          recommended_ban_days: number;
          status: string;
          created_at: Date;
          created_by_staff_name: string | null;
          customer_name: string;
          notes_json: string;
        }>(
          `
          SELECT
            a.id,
            a.customer_id,
            a.checkout_request_id,
            a.occupancy_id,
            a.visit_id,
            a.late_minutes,
            a.fee_amount_cents,
            a.recommended_ban_days,
            a.status,
            a.created_at,
            a.created_by_staff_name,
            c.name as customer_name,
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', n.id,
                    'createdAt', n.created_at,
                    'createdByStaffName', n.created_by_staff_name,
                    'note', n.note,
                    'isImportant', n.is_important
                  )
                  ORDER BY n.created_at DESC
                )::text
                FROM customer_notes n
                WHERE n.customer_id = a.customer_id
                  AND n.created_at >= date_trunc('day', a.created_at)
                  AND n.created_at < date_trunc('day', a.created_at) + interval '1 day'
              ),
              '[]'
            ) as notes_json
          FROM late_checkout_ban_alerts a
          JOIN customers c ON c.id = a.customer_id
          WHERE a.status = $1
          ORDER BY a.created_at DESC
          LIMIT $2
          `,
          [status, parsed.limit]
        )
      );

      const alerts = rows.rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        checkoutRequestId: r.checkout_request_id,
        occupancyId: r.occupancy_id,
        visitId: r.visit_id,
        lateMinutes: r.late_minutes,
        feeAmountCents: r.fee_amount_cents,
        recommendedBanDays: r.recommended_ban_days,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        createdByStaffName: r.created_by_staff_name,
        customerNotesThatDay: JSON.parse(r.notes_json) as unknown,
      }));

      return reply.send({ alerts });
    }
  );

  /**
   * POST /v1/admin/late-checkout-ban-alerts/:id/decide
   */
  fastify.post<{
    Params: { id: string };
    Body: z.infer<typeof DecideSchema>;
  }>(
    '/v1/admin/late-checkout-ban-alerts/:id/decide',
    { preHandler: [requireReauthForAdmin] },
    async (request, reply) => {
      let parsed: z.infer<typeof DecideSchema>;
      try {
        parsed = DecideSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const decision = parsed.decision;

      try {
        const result = await transaction(async (client) => {
          const alertRow = await client.query<{
            id: string;
            status: string;
            customer_id: string;
            late_minutes: number;
            checkout_request_id: string;
          }>(
            `SELECT id, status, customer_id, late_minutes, checkout_request_id
             FROM late_checkout_ban_alerts
             WHERE id = $1
             FOR UPDATE`,
            [request.params.id]
          );
          if (alertRow.rows.length === 0) {
            throw { statusCode: 404, message: 'Alert not found' };
          }
          const alert = alertRow.rows[0]!;
          if (alert.status !== 'PENDING') {
            throw { statusCode: 409, message: `Alert is ${alert.status}` };
          }

          let bannedUntil: Date | null = null;
          if (decision === 'APPROVE') {
            const days = parsed.banDays ?? 30;
            bannedUntil = new Date();
            bannedUntil.setDate(bannedUntil.getDate() + days);
            await client.query(
              `UPDATE customers SET banned_until = $1, updated_at = NOW() WHERE id = $2`,
              [bannedUntil, alert.customer_id]
            );
          }

          await client.query(
            `UPDATE late_checkout_ban_alerts
             SET status = 'RESOLVED',
                 decided_at = NOW(),
                 decided_by_staff_id = $1,
                 decided_by_staff_name = $2,
                 decision = $3,
                 ban_days = $4,
                 manager_notes = $5
             WHERE id = $6`,
            [
              request.staff!.staffId,
              request.staff!.name,
              decision,
              decision === 'APPROVE' ? parsed.banDays ?? 30 : null,
              parsed.managerNotes ?? null,
              alert.id,
            ]
          );

          await insertCustomerActivityEvent(client, {
            customerId: alert.customer_id,
            actionType: decision === 'APPROVE' ? 'BAN_APPROVED' : 'BAN_DENIED',
            actionCategory: 'ADMIN',
            sourceApp: 'OFFICE_DASHBOARD',
            actorType: 'STAFF',
            actorStaffId: request.staff!.staffId,
            actorStaffName: request.staff!.name,
            summary:
              decision === 'APPROVE'
                ? `Ban approved (${parsed.banDays ?? 30} days)`
                : 'Ban denied',
            metadata: {
              lateCheckoutAlertId: alert.id,
              checkoutRequestId: alert.checkout_request_id,
              lateMinutes: alert.late_minutes,
              banDays: decision === 'APPROVE' ? parsed.banDays ?? 30 : null,
              managerNotes: parsed.managerNotes ?? null,
            },
            dedupeKey: `ACT:LATE_CHECKOUT_BAN_DECISION:${alert.id}:${decision}`,
            searchParts: [alert.id, alert.checkout_request_id],
          });

          if (parsed.managerNotes?.trim()) {
            await client.query(
              `
              INSERT INTO customer_notes
                (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
              VALUES
                ($1::uuid, $2::uuid, $3, 'OFFICE_DASHBOARD', $4, true)
              `,
              [
                alert.customer_id,
                request.staff!.staffId,
                request.staff!.name,
                parsed.managerNotes.trim(),
              ]
            );
          }

          return { decision, bannedUntil: bannedUntil ? bannedUntil.toISOString() : null };
        });

        return reply.send(result);
      } catch (error: any) {
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        request.log.error(error, 'Failed to decide late checkout ban');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
