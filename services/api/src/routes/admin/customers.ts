import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../../db';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';

// Admin customer search and update delegates to inline service-like functions below.
// The agreements endpoint is also included. These could be further extracted into
// customerAdminService.ts, but the 3 endpoints are kept here for now.

export function registerAdminCustomerRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { q?: string; search?: string; limit?: string } }>(
    '/v1/admin/customers', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const search = (request.query.q || request.query.search || '').trim();
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);
      if (search.length < 2) return reply.send({ customers: [] });

      try {
        const result = await query<{ id: string; name: string; dob: string | null; membership_number: string | null; membership_card_type: string | null; membership_valid_until: Date | null; primary_language: string | null; past_due_balance: string | number | null; last_visit: Date | null }>(
          `SELECT c.id, c.name, c.dob, c.membership_number, c.membership_card_type, c.membership_valid_until, c.primary_language, c.past_due_balance, (SELECT MAX(v.started_at) FROM visits v WHERE v.customer_id = c.id) as last_visit FROM customers c WHERE c.name ILIKE $1 OR c.membership_number ILIKE $1 ORDER BY c.name ASC LIMIT $2`, [`%${search}%`, limit]
        );
        return reply.send({ customers: result.rows.map((r) => ({ id: r.id, name: r.name, dob: r.dob, membershipNumber: r.membership_number, membershipCardType: r.membership_card_type, membershipValidUntil: r.membership_valid_until?.toISOString() ?? null, primaryLanguage: (r.primary_language as 'EN' | 'ES' | null) || null, pastDueBalance: parseFloat(String(r.past_due_balance || 0)), lastVisit: r.last_visit?.toISOString() ?? null })) });
      } catch (e) { request.log.error(e, 'Failed to search customers'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: { pastDueBalance?: number } }>(
    '/v1/admin/customers/:id', { preHandler: [requireReauthForAdmin] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const UpdateSchema = z.object({ pastDueBalance: z.number().min(0).optional() }).refine((b) => b.pastDueBalance !== undefined, { message: 'At least one field is required' });
      let body: z.infer<typeof UpdateSchema>;
      try { body = UpdateSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }

      try {
        const result = await transaction(async (client) => {
          const existing = await client.query<{ id: string; past_due_balance: string | number | null; name: string; membership_number: string | null; primary_language: string | null }>(`SELECT id, name, membership_number, primary_language, past_due_balance FROM customers WHERE id = $1 FOR UPDATE`, [request.params.id]);
          if (existing.rows.length === 0) throw { statusCode: 404, message: 'Customer not found' };
          const before = existing.rows[0]!;
          const updates: string[] = []; const params: unknown[] = []; let idx = 1;
          if (body.pastDueBalance !== undefined) { updates.push(`past_due_balance = $${idx}`); params.push(body.pastDueBalance); idx++; }
          params.push(request.params.id);
          const updated = await client.query<{ id: string; name: string; membership_number: string | null; primary_language: string | null; past_due_balance: string | number | null }>(`UPDATE customers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, name, membership_number, primary_language, past_due_balance`, params);
          const after = updated.rows[0]!;
          await insertAuditLog(client, { staffId: request.staff!.staffId, userId: request.staff!.staffId, userRole: request.staff!.role, action: 'UPDATE', entityType: 'customer', entityId: request.params.id, oldValue: { pastDueBalance: parseFloat(String(before.past_due_balance || 0)) }, newValue: { pastDueBalance: parseFloat(String(after.past_due_balance || 0)) } });
          return after;
        });
        return reply.send({ id: result.id, name: result.name, membershipNumber: result.membership_number, primaryLanguage: (result.primary_language as 'EN' | 'ES' | null) || null, pastDueBalance: parseFloat(String(result.past_due_balance || 0)) });
      } catch (error: any) {
        if (error?.statusCode) return reply.status(error.statusCode).send({ error: error.message ?? 'Failed to update customer' });
        request.log.error(error, 'Failed to update customer'); return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get<{ Params: { customerId: string }; Querystring: { limit?: string } }>(
    '/v1/admin/customers/:customerId/agreements', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { customerId } = request.params;
      const limit = Math.min(Math.max(parseInt(request.query.limit || '25', 10) || 25, 1), 100);
      try {
        const visitsResult = await query<{ id: string; started_at: Date; ended_at: Date | null }>(`SELECT id, started_at, ended_at FROM visits WHERE customer_id = $1 ORDER BY started_at DESC LIMIT $2`, [customerId, limit]);
        if (visitsResult.rows.length === 0) return reply.send({ visits: [] });
        const visitIds = visitsResult.rows.map((v) => v.id);
        const blocksResult = await query<any>(`SELECT cb.id, cb.visit_id, cb.block_type::text as block_type, cb.starts_at, cb.ends_at, cb.rental_type::text as rental_type, r.number as room_number, l.number as locker_number, cb.agreement_signed, cb.agreement_signed_at, (cb.agreement_pdf IS NOT NULL) as has_pdf, pi.amount as payment_total, pi.payment_method, sig.signature_png_base64, sig.signature_strokes_json, sig.created_at as signature_created_at, sig.agreement_version, sig.agreement_text_snapshot FROM checkin_blocks cb LEFT JOIN rooms r ON r.id = cb.room_id LEFT JOIN lockers l ON l.id = cb.locker_id LEFT JOIN lane_sessions ls ON ls.id = cb.session_id LEFT JOIN payment_intents pi ON pi.id = ls.payment_intent_id LEFT JOIN LATERAL (SELECT signature_png_base64, signature_strokes_json, created_at, agreement_version, agreement_text_snapshot FROM agreement_signatures WHERE checkin_block_id = cb.id ORDER BY created_at DESC LIMIT 1) sig ON TRUE WHERE cb.visit_id = ANY($1::uuid[]) ORDER BY cb.starts_at DESC, cb.id DESC`, [visitIds]);
        const blocksByVisit = new Map<string, any[]>();
        for (const b of blocksResult.rows) { const arr = blocksByVisit.get(b.visit_id) ?? []; arr.push(b); blocksByVisit.set(b.visit_id, arr); }
        return reply.send({ visits: visitsResult.rows.map((v) => ({ visitId: v.id, visitStartedAt: v.started_at.toISOString(), visitEndedAt: v.ended_at?.toISOString() ?? null, checkinBlocks: (blocksByVisit.get(v.id) ?? []).map((b: any) => ({ checkinBlockId: b.id, blockType: b.block_type, startsAt: b.starts_at.toISOString(), endsAt: b.ends_at.toISOString(), rentalType: b.rental_type, roomNumber: b.room_number, lockerNumber: b.locker_number, agreementSigned: b.agreement_signed, agreementSignedAt: b.agreement_signed_at?.toISOString() ?? null, hasPdf: b.has_pdf, paymentTotal: b.payment_total ? parseFloat(b.payment_total) : null, paymentMethod: b.payment_method, hasSignature: Boolean(b.signature_png_base64) || Boolean(b.signature_strokes_json), signatureCreatedAt: b.signature_created_at?.toISOString() ?? null, agreementVersion: b.agreement_version, agreementTitle: null })) })) });
      } catch (e) { request.log.error(e, 'Failed to fetch customer agreements'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );
}
