import type { FastifyInstance } from 'fastify';
import { getHttpError } from '../../checkin/utils';
import { z } from 'zod';
import { db, type DrizzleTx } from '../../db';
import { sql } from 'drizzle-orm';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { insertAuditLogDrizzle } from '../../audit/auditLog';
import { HttpError } from '../../errors/HttpError';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
 */
function toQueryable(tx: DrizzleTx) {
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

// Admin customer search and update delegates to inline service-like functions below.
// The agreements endpoint is also included. These could be further extracted into
// customerAdminService.ts, but the 3 endpoints are kept here for now.

export function registerAdminCustomerRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { q?: string; search?: string; limit?: string } }>(
    '/v1/admin/customers', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const search = (request.query.q || request.query.search || '').trim();
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '25', 10) || 25, 1), 100);
      if (search.length < 2) return reply.send({ customers: [] });

      try {
        const searchPattern = `%${search}%`;
        const result = await db.execute<{ id: string; name: string; dob: string | null; membership_number: string | null; membership_card_type: string | null; membership_valid_until: Date | null; primary_language: string | null; past_due_balance: string | number | null; last_visit: Date | null }>(
          sql`SELECT c.id, c.name, c.dob, c.membership_number, c.membership_card_type, c.membership_valid_until, c.primary_language, c.past_due_balance, (SELECT MAX(v.started_at) FROM visits v WHERE v.customer_id = c.id) as last_visit FROM customers c WHERE c.name ILIKE ${searchPattern} OR c.membership_number ILIKE ${searchPattern} ORDER BY c.name ASC LIMIT ${limit}`
        );
        const toISO = (v: unknown): string | null => { if (!v) return null; if (v instanceof Date) return v.toISOString(); if (typeof v === 'string') return v; return null; };
        return reply.send({ customers: result.rows.map((r) => ({ id: r.id, name: r.name, dob: r.dob, membershipNumber: r.membership_number, membershipCardType: r.membership_card_type, membershipValidUntil: toISO(r.membership_valid_until), primaryLanguage: (r.primary_language as 'EN' | 'ES' | null) || null, pastDueBalance: Number.parseFloat(String(r.past_due_balance || 0)), lastVisit: toISO(r.last_visit) })) });
      } catch (e) { request.log.error(e, 'Failed to search customers'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  const UpdateSchema = z.object({ pastDueBalance: z.number().min(0).optional() }).refine((b) => b.pastDueBalance !== undefined, { message: 'At least one field is required' });

  fastify.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateSchema> }>(
    '/v1/admin/customers/:id', { preHandler: [requireReauthForAdmin] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const body = request.body as z.infer<typeof UpdateSchema>;

      try {
        const result = await db.transaction(async (tx) => {
          const existing = await tx.execute<{ id: string; past_due_balance: string | number | null; name: string; membership_number: string | null; primary_language: string | null }>(
            sql`SELECT id, name, membership_number, primary_language, past_due_balance FROM customers WHERE id = ${request.params.id} FOR UPDATE`
          );
          if (existing.rows.length === 0) throw new HttpError(404, 'Customer not found');
          const before = existing.rows[0]!;
          // Dynamic SQL for updates using toQueryable adapter
          const updates: string[] = []; const params: unknown[] = []; let idx = 1;
          if (body.pastDueBalance !== undefined) { updates.push(`past_due_balance = $${idx}`); params.push(body.pastDueBalance); idx++; }
          params.push(request.params.id);
          const queryText = `UPDATE customers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, name, membership_number, primary_language, past_due_balance`;
          const updated = await toQueryable(tx).query<{ id: string; name: string; membership_number: string | null; primary_language: string | null; past_due_balance: string | number | null }>(queryText, params);
          const after = updated.rows[0]!;
          await insertAuditLogDrizzle(tx, { staffId: request.staff!.staffId, userId: request.staff!.staffId, userRole: request.staff!.role, action: 'UPDATE', entityType: 'customer', entityId: request.params.id, oldValue: { pastDueBalance: Number.parseFloat(String(before.past_due_balance || 0)) }, newValue: { pastDueBalance: Number.parseFloat(String(after.past_due_balance || 0)) } });
          return after;
        });
        return reply.send({ id: result.id, name: result.name, membershipNumber: result.membership_number, primaryLanguage: (result.primary_language as 'EN' | 'ES' | null) || null, pastDueBalance: Number.parseFloat(String(result.past_due_balance || 0)) });
      } catch (error: unknown) {
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to update customer' });
        request.log.error(error, 'Failed to update customer'); return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get<{ Params: { customerId: string }; Querystring: { limit?: string } }>(
    '/v1/admin/customers/:customerId/agreements', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { customerId } = request.params;
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '25', 10) || 25, 1), 100);
      try {
        const visitsResult = await db.execute<{ id: string; started_at: Date; ended_at: Date | null }>(
          sql`SELECT id, started_at, ended_at FROM visits WHERE customer_id = ${customerId} ORDER BY started_at DESC LIMIT ${limit}`
        );
        if (visitsResult.rows.length === 0) return reply.send({ visits: [] });
        const visitIds = visitsResult.rows.map((v) => v.id);
        type AgreementBlockRow = { id: string; visit_id: string; block_type: string; starts_at: Date; ends_at: Date; rental_type: string | null; resource_number: string | null; resource_kind: string | null; agreement_signed: boolean; agreement_signed_at: Date | null; has_pdf: boolean; payment_total: string | null; payment_method: string | null; signature_png_base64: string | null; signature_strokes_json: unknown; signature_created_at: Date | null; agreement_version: string | null; agreement_text_snapshot: string | null };
        const blocksResult = await db.execute<AgreementBlockRow>(
          sql`SELECT cb.id, cb.visit_id, cb.block_type::text as block_type, cb.starts_at, cb.ends_at, cb.rental_type::text as rental_type, r.number as resource_number, r.kind as resource_kind, cb.agreement_signed, cb.agreement_signed_at, (cb.agreement_pdf IS NOT NULL) as has_pdf, pi.total as payment_total, pi.payment_method, sig.signature_png_base64, sig.signature_strokes_json, sig.created_at as signature_created_at, sig.agreement_version, sig.agreement_text_snapshot FROM checkin_blocks cb LEFT JOIN inventory_resources r ON r.id = cb.resource_id LEFT JOIN lane_sessions ls ON ls.id = cb.session_id LEFT JOIN orders pi ON pi.id = ls.order_id LEFT JOIN LATERAL (SELECT signature_png_base64, signature_strokes_json, created_at, agreement_version, agreement_text_snapshot FROM agreement_signatures WHERE checkin_block_id = cb.id ORDER BY created_at DESC LIMIT 1) sig ON TRUE WHERE cb.visit_id IN (${sql.join(visitIds.map(id => sql`${id}::uuid`), sql`, `)}) ORDER BY cb.starts_at DESC, cb.id DESC`
        );
        const blocksByVisit = new Map<string, AgreementBlockRow[]>();
        for (const b of blocksResult.rows) { const arr = blocksByVisit.get(b.visit_id) ?? []; arr.push(b); blocksByVisit.set(b.visit_id, arr); }
        const toISO = (v: unknown): string => { if (v instanceof Date) return v.toISOString(); return String(v ?? ''); };
        const toISONull = (v: unknown): string | null => { if (!v) return null; return toISO(v); };
        return reply.send({ visits: visitsResult.rows.map((v) => ({ visitId: v.id, visitStartedAt: toISO(v.started_at), visitEndedAt: toISONull(v.ended_at), checkinBlocks: (blocksByVisit.get(v.id) ?? []).map((b) => ({ checkinBlockId: b.id, blockType: b.block_type, startsAt: toISO(b.starts_at), endsAt: toISO(b.ends_at), rentalType: b.rental_type, resourceNumber: b.resource_number, resourceKind: b.resource_kind, agreementSigned: b.agreement_signed, agreementSignedAt: toISONull(b.agreement_signed_at), hasPdf: b.has_pdf, paymentTotal: b.payment_total ? Number.parseFloat(b.payment_total) : null, paymentMethod: b.payment_method, hasSignature: Boolean(b.signature_png_base64) || Boolean(b.signature_strokes_json), signatureCreatedAt: toISONull(b.signature_created_at), agreementVersion: b.agreement_version, agreementTitle: null })) })) });
      } catch (e) { request.log.error(e, 'Failed to fetch customer agreements'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );
}
