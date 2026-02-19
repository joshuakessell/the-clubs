import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../../db';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';

export function registerAdminCustomerRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/customers - Search customers (admin)
   *
   * Used by office-dashboard Customer Admin Tools.
   */
  fastify.get<{
    Querystring: {
      search?: string;
      limit?: string;
    };
  }>(
    '/v1/admin/customers',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const search = (request.query.search || '').trim();
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);

      if (search.length < 2) {
        return reply.send({ customers: [] });
      }

      try {
        const result = await query<{
          id: string;
          name: string;
          membership_number: string | null;
          primary_language: string | null;
          past_due_balance: string | number | null;
        }>(
          `SELECT id, name, membership_number, primary_language, past_due_balance
         FROM customers
         WHERE name ILIKE $1 OR membership_number ILIKE $1
         ORDER BY name ASC
         LIMIT $2`,
          [`%${search}%`, limit]
        );

        return reply.send({
          customers: result.rows.map((r) => ({
            id: r.id,
            name: r.name,
            membershipNumber: r.membership_number,
            primaryLanguage: (r.primary_language as 'EN' | 'ES' | null) || null,
            pastDueBalance: parseFloat(String(r.past_due_balance || 0)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * PATCH /v1/admin/customers/:id - Update admin-controlled customer fields
   *
   * Admin-only and requires step-up re-auth (PIN or WebAuthn).
   * Supported edits (demo):
   * - pastDueBalance (waive)
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      pastDueBalance?: number;
    };
  }>(
    '/v1/admin/customers/:id',
    {
      preHandler: [requireReauthForAdmin],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const auditStaffId = request.staff.staffId;
      const auditStaffRole = request.staff.role;

      const UpdateSchema = z
        .object({
          pastDueBalance: z.number().min(0).optional(),
        })
        .refine((b) => b.pastDueBalance !== undefined, {
          message: 'At least one field is required',
        });

      let body: z.infer<typeof UpdateSchema>;
      try {
        body = UpdateSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const existing = await client.query<{
            id: string;
            past_due_balance: string | number | null;
            primary_language: string | null;
            name: string;
            membership_number: string | null;
          }>(
            `SELECT id, name, membership_number, primary_language, past_due_balance
           FROM customers
           WHERE id = $1
           FOR UPDATE`,
            [request.params.id]
          );

          if (existing.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const before = existing.rows[0]!;
          const updates: string[] = [];
          const params: unknown[] = [];
          let idx = 1;

          if (body.pastDueBalance !== undefined) {
            updates.push(`past_due_balance = $${idx}`);
            params.push(body.pastDueBalance);
            idx++;
          }

          params.push(request.params.id);

          const updated = await client.query<{
            id: string;
            name: string;
            membership_number: string | null;
            primary_language: string | null;
            past_due_balance: string | number | null;
          }>(
            `UPDATE customers
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${idx}
           RETURNING id, name, membership_number, primary_language, past_due_balance`,
            params
          );

          const after = updated.rows[0]!;

          await insertAuditLog(client, {
            staffId: auditStaffId,
            userId: auditStaffId,
            userRole: auditStaffRole,
            action: 'UPDATE',
            entityType: 'customer',
            entityId: request.params.id,
            oldValue: {
              pastDueBalance: parseFloat(String(before.past_due_balance || 0)),
            },
            newValue: {
              pastDueBalance: parseFloat(String(after.past_due_balance || 0)),
            },
          });

          return after;
        });

        return reply.send({
          id: result.id,
          name: result.name,
          membershipNumber: result.membership_number,
          primaryLanguage: (result.primary_language as 'EN' | 'ES' | null) || null,
          pastDueBalance: parseFloat(String(result.past_due_balance || 0)),
        });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          return reply.status(statusCode).send({
            error: message ?? 'Failed to update customer',
          });
        }
        request.log.error(error, 'Failed to update customer');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/customers/:customerId/agreements
   *
   * Admin-only: return per-visit agreement artifacts and PDF availability.
   * This is the management-friendly shape for viewing agreements by visit.
   */
  fastify.get<{ Params: { customerId: string }; Querystring: { limit?: string } }>(
    '/v1/admin/customers/:customerId/agreements',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      const { customerId } = request.params;
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);

      try {
        const visitsResult = await query<{
          id: string;
          started_at: Date;
          ended_at: Date | null;
        }>(
          `SELECT id, started_at, ended_at
           FROM visits
           WHERE customer_id = $1
           ORDER BY started_at DESC
           LIMIT $2`,
          [customerId, limit]
        );

        if (visitsResult.rows.length === 0) {
          return reply.send({ visits: [] });
        }

        const visitIds = visitsResult.rows.map((v) => v.id);
        const blocksResult = await query<{
          id: string;
          visit_id: string;
          block_type: string;
          starts_at: Date;
          ends_at: Date;
          rental_type: string;
          room_number: string | null;
          locker_number: string | null;
          agreement_signed: boolean;
          agreement_signed_at: Date | null;
          has_pdf: boolean;
          signature_png_base64: string | null;
          signature_strokes_json: unknown;
          signature_created_at: Date | null;
          agreement_version: string | null;
          agreement_text_snapshot: string | null;
        }>(
          `
          SELECT
            cb.id,
            cb.visit_id,
            cb.block_type::text as block_type,
            cb.starts_at,
            cb.ends_at,
            cb.rental_type::text as rental_type,
            r.number as room_number,
            l.number as locker_number,
            cb.agreement_signed,
            cb.agreement_signed_at,
            (cb.agreement_pdf IS NOT NULL) as has_pdf,
            sig.signature_png_base64,
            sig.signature_strokes_json,
            sig.created_at as signature_created_at,
            sig.agreement_version,
            sig.agreement_text_snapshot
          FROM checkin_blocks cb
          LEFT JOIN rooms r ON r.id = cb.room_id
          LEFT JOIN lockers l ON l.id = cb.locker_id
          LEFT JOIN LATERAL (
            SELECT signature_png_base64, signature_strokes_json, created_at, agreement_version, agreement_text_snapshot
            FROM agreement_signatures
            WHERE checkin_block_id = cb.id
            ORDER BY created_at DESC
            LIMIT 1
          ) sig ON TRUE
          WHERE cb.visit_id = ANY($1::uuid[])
          ORDER BY cb.starts_at DESC, cb.id DESC
          `,
          [visitIds]
        );

        const blocksByVisit = new Map<string, typeof blocksResult.rows>();
        for (const b of blocksResult.rows) {
          const arr = blocksByVisit.get(b.visit_id) ?? [];
          arr.push(b);
          blocksByVisit.set(b.visit_id, arr);
        }

        const visits = visitsResult.rows.map((v) => {
          const blocks = blocksByVisit.get(v.id) ?? [];
          return {
            visitId: v.id,
            visitStartedAt: v.started_at.toISOString(),
            visitEndedAt: v.ended_at ? v.ended_at.toISOString() : null,
            checkinBlocks: blocks.map((b) => {
              const hasSignature = Boolean(b.signature_png_base64) || Boolean(b.signature_strokes_json);
              return {
                checkinBlockId: b.id,
                blockType: b.block_type,
                startsAt: b.starts_at.toISOString(),
                endsAt: b.ends_at.toISOString(),
                rentalType: b.rental_type,
                roomNumber: b.room_number,
                lockerNumber: b.locker_number,
                agreementSigned: b.agreement_signed,
                agreementSignedAt: b.agreement_signed_at ? b.agreement_signed_at.toISOString() : null,
                hasPdf: b.has_pdf,
                hasSignature,
                signatureCreatedAt: b.signature_created_at ? b.signature_created_at.toISOString() : null,
                agreementVersion: b.agreement_version,
                agreementTitle: null,
              };
            }),
          };
        });

        return reply.send({ visits });
      } catch (error) {
        request.log.error(error, 'Failed to fetch customer agreements');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
