import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/middleware';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

type SessionDocumentRow = {
  id: string;
  created_at: Date;
  agreement_pdf: Buffer | null;
  signature_png_base64: string | null;
  signature_strokes_json: unknown;
  signature_created_at: Date | null;
};

export async function sessionDocumentsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { name?: string } }>(
    '/v1/documents/customers',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const name = request.query.name?.trim() ?? '';
      if (!name) {
        return reply.status(400).send({ message: 'name query is required' });
      }

      const rows = await db.execute<Record<string, unknown>>(
        sql`SELECT
           c.id,
           c.name,
           c.dob,
           c.membership_number,
           MAX(v.started_at) as last_visit_at
         FROM customers c
         LEFT JOIN visits v ON v.customer_id = c.id
         WHERE c.name ILIKE ${'%' + name + '%'}
         GROUP BY c.id
         ORDER BY c.name ASC, last_visit_at DESC NULLS LAST
         LIMIT 50`
      );

      type CustomerSearchRow = { id: string; name: string; dob: Date | null; membership_number: string | null; last_visit_at: Date | null };
      const customers = (rows.rows as unknown as CustomerSearchRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        dob: r.dob ? r.dob.toISOString() : null,
        membership_number: r.membership_number,
        last_visit_at: r.last_visit_at ? r.last_visit_at.toISOString() : null,
      }));

      return reply.send({ customers });
    }
  );

  fastify.get<{ Params: { customerId: string } }>(
    '/v1/documents/by-customer/:customerId',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { customerId } = request.params;

      const rows = await db.execute<Record<string, unknown>>(
        sql`SELECT
           cb.id,
           cb.created_at,
           cb.agreement_pdf,
           sig.signature_png_base64,
           sig.signature_strokes_json,
           sig.created_at as signature_created_at,
           v.started_at as visit_started_at,
           v.ended_at as visit_ended_at
         FROM visits v
         JOIN checkin_blocks cb ON cb.visit_id = v.id
         LEFT JOIN LATERAL (
           SELECT signature_png_base64, signature_strokes_json, created_at
           FROM agreement_signatures
           WHERE checkin_block_id = cb.id
           ORDER BY created_at DESC
           LIMIT 1
         ) sig ON TRUE
         WHERE v.customer_id = ${customerId}
         ORDER BY v.started_at DESC NULLS LAST, cb.created_at DESC`
      );

      type DocRow = SessionDocumentRow & { visit_started_at: Date | null; visit_ended_at: Date | null };
      const documents = (rows.rows as unknown as DocRow[]).map((r) => {
        const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
        const signatureMaterial =
          (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
          (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
        const signatureHashPrefix =
          hasSignature && signatureMaterial
            ? crypto.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
            : undefined;

        return {
          id: r.id,
          doc_type: 'AGREEMENT_PDF',
          mime_type: 'application/pdf',
          created_at: r.created_at.toISOString(),
          has_signature: hasSignature,
          signature_hash_prefix: signatureHashPrefix,
          has_pdf: Boolean(r.agreement_pdf),
          visit_started_at: r.visit_started_at ? r.visit_started_at.toISOString() : null,
          visit_ended_at: r.visit_ended_at ? r.visit_ended_at.toISOString() : null,
        };
      });

      return reply.send({ documents });
    }
  );

  fastify.get<{ Params: { sessionId: string } }>(
    '/v1/documents/by-session/:sessionId',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { sessionId } = request.params;

      const rows = await db.execute<Record<string, unknown>>(
        sql`SELECT
           cb.id,
           cb.created_at,
           cb.agreement_pdf,
           sig.signature_png_base64,
           sig.signature_strokes_json,
           sig.created_at as signature_created_at
         FROM checkin_blocks cb
         LEFT JOIN LATERAL (
           SELECT signature_png_base64, signature_strokes_json, created_at
           FROM agreement_signatures
           WHERE checkin_block_id = cb.id
           ORDER BY created_at DESC
           LIMIT 1
         ) sig ON TRUE
         WHERE cb.session_id = ${sessionId}
         ORDER BY cb.created_at DESC`
      );

      const documents = (rows.rows as unknown as SessionDocumentRow[]).map((r) => {
        const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
        const signatureMaterial =
          (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
          (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
        const signatureHashPrefix =
          hasSignature && signatureMaterial
            ? crypto.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
            : undefined;

        return {
          id: r.id,
          doc_type: 'AGREEMENT_PDF',
          mime_type: 'application/pdf',
          created_at: r.created_at.toISOString(),
          has_signature: hasSignature,
          signature_hash_prefix: signatureHashPrefix,
          has_pdf: Boolean(r.agreement_pdf),
        };
      });

      return reply.send({ documents });
    }
  );

  fastify.get<{ Params: { documentId: string } }>(
    '/v1/documents/:documentId/download',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { documentId } = request.params;

      const result = await db.execute<Record<string, unknown>>(
        sql`SELECT agreement_pdf FROM checkin_blocks WHERE id = ${documentId}`
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Document not found' });
      }
      const raw = (result.rows[0] as Record<string, unknown>).agreement_pdf;
      if (!raw) {
        return reply.status(404).send({ error: 'Agreement PDF not stored for this document' });
      }

      // Drizzle may return bytea as: real Buffer, JSON-like {type,data} object, or hex string
      let pdfBuf: Buffer;
      if (Buffer.isBuffer(raw)) {
        pdfBuf = raw;
      } else if (typeof raw === 'object' && raw !== null && 'type' in raw && 'data' in raw) {
        // JSON-serialized Buffer: { type: 'Buffer', data: number[] }
        pdfBuf = Buffer.from((raw as { data: number[] }).data);
      } else if (typeof raw === 'string') {
        // Hex-encoded bytea: \x2550444...
        pdfBuf = Buffer.from(raw.replace(/^\\x/, ''), 'hex');
      } else {
        return reply.status(500).send({ error: 'Unexpected PDF data format' });
      }

      // Send raw binary directly — bypass Fastify's JSON serializer
      reply.raw.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="agreement-${documentId.slice(0, 8)}.pdf"`,
        'Content-Length': pdfBuf.length,
      });
      reply.raw.end(pdfBuf);
      return reply;
    }
  );
}
