import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/middleware';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { generateAgreementPdf } from '../utils/pdf-generator';

type SessionDocumentRow = {
  id: string;
  created_at: Date;
  has_signature: boolean;
  signature_hash_prefix: string | null;
};

type SignatureQueryRow = {
  sig_id: string;
  signature_png_base64: string | null;
  signature_strokes_json: unknown;
  signature_created_at: Date | null;
};

function buildSignatureMetadata(r: SignatureQueryRow): { has_signature: boolean; signature_hash_prefix: string | undefined } {
  const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
  const signatureMaterial =
    (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
    (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
  const signatureHashPrefix =
    hasSignature && signatureMaterial
      ? crypto.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
      : undefined;
  return { has_signature: hasSignature, signature_hash_prefix: signatureHashPrefix };
}

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
           cb.agreement_signed,
           sig.id as sig_id,
           sig.signature_png_base64,
           sig.signature_strokes_json,
           sig.created_at as signature_created_at,
           v.started_at as visit_started_at,
           v.ended_at as visit_ended_at
         FROM visits v
         JOIN checkin_blocks cb ON cb.visit_id = v.id
         LEFT JOIN LATERAL (
           SELECT id, signature_png_base64, signature_strokes_json, created_at
           FROM agreement_signatures
           WHERE checkin_block_id = cb.id
           ORDER BY created_at DESC
           LIMIT 1
         ) sig ON TRUE
         WHERE v.customer_id = ${customerId}
         ORDER BY v.started_at DESC NULLS LAST, cb.created_at DESC`
      );

      type DocRow = { id: string; created_at: Date; agreement_signed: boolean; visit_started_at: Date | null; visit_ended_at: Date | null } & SignatureQueryRow;
      const documents = (rows.rows as unknown as DocRow[]).map((r) => {
        const sigMeta = buildSignatureMetadata(r);
        return {
          id: r.id,
          doc_type: 'AGREEMENT_PDF',
          mime_type: 'application/pdf',
          created_at: r.created_at.toISOString(),
          has_signature: sigMeta.has_signature,
          signature_hash_prefix: sigMeta.signature_hash_prefix,
          has_pdf: r.agreement_signed,
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
           cb.agreement_signed,
           sig.id as sig_id,
           sig.signature_png_base64,
           sig.signature_strokes_json,
           sig.created_at as signature_created_at
         FROM checkin_blocks cb
         LEFT JOIN LATERAL (
           SELECT id, signature_png_base64, signature_strokes_json, created_at
           FROM agreement_signatures
           WHERE checkin_block_id = cb.id
           ORDER BY created_at DESC
           LIMIT 1
         ) sig ON TRUE
         WHERE cb.session_id = ${sessionId}
         ORDER BY cb.created_at DESC`
      );

      type DocRow = { id: string; created_at: Date; agreement_signed: boolean } & SignatureQueryRow;
      const documents = (rows.rows as unknown as DocRow[]).map((r) => {
        const sigMeta = buildSignatureMetadata(r);
        let createdAtStr = String(r.created_at);
        if (r.created_at instanceof Date) {
          createdAtStr = r.created_at.toISOString();
        } else if (typeof r.created_at === 'string') {
          createdAtStr = r.created_at;
        }

        return {
          id: r.id,
          doc_type: 'AGREEMENT_PDF',
          mime_type: 'application/pdf',
          created_at: createdAtStr,
          has_signature: sigMeta.has_signature,
          signature_hash_prefix: sigMeta.signature_hash_prefix,
          has_pdf: r.agreement_signed,
        };
      });

      return reply.send({ documents });
    }
  );

  // ── On-demand PDF reconstruction ──
  // Queries agreement_signatures for the stored signature data, agreement text,
  // and customer info, then generates the PDF using pdf-generator.ts.

  fastify.get<{ Params: { documentId: string } }>(
    '/v1/documents/:documentId/download',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { documentId } = request.params;

      type PdfDataRow = {
        block_id: string;
        agreement_signed: boolean;
        customer_name: string;
        customer_dob: Date | null;
        membership_number: string | null;
        sig_signed_at: Date | null;
        sig_png_base64: string | null;
        sig_agreement_text: string | null;
        sig_agreement_version: string | null;
        agreement_title: string | null;
        block_starts_at: Date;
        // Manual override: no signature record exists but agreement is signed
      };

      const result = await db.execute<Record<string, unknown>>(
        sql`SELECT
             cb.id as block_id,
             cb.agreement_signed,
             cb.starts_at as block_starts_at,
             c.name as customer_name,
             c.dob as customer_dob,
             c.membership_number,
             sig.signed_at as sig_signed_at,
             sig.signature_png_base64 as sig_png_base64,
             sig.agreement_text_snapshot as sig_agreement_text,
             sig.agreement_version as sig_agreement_version,
             a.title as agreement_title
           FROM checkin_blocks cb
           JOIN visits v ON v.id = cb.visit_id
           JOIN customers c ON c.id = v.customer_id
           LEFT JOIN LATERAL (
             SELECT signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, agreement_id
             FROM agreement_signatures
             WHERE checkin_block_id = cb.id
             ORDER BY created_at DESC LIMIT 1
           ) sig ON TRUE
           LEFT JOIN agreements a ON a.id = sig.agreement_id
           WHERE cb.id = ${documentId}`
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const row = result.rows[0] as unknown as PdfDataRow;
      const customerName = row.customer_name || 'Guest';
      const signedAt = row.sig_signed_at ? new Date(row.sig_signed_at) : new Date(row.block_starts_at);
      let agreementText = row.sig_agreement_text || '';
      const isManualOverride = row.agreement_signed && !row.sig_png_base64;

      if (!agreementText) {
        const fallbackResult = await db.execute<{ body_text: string }>(
          sql`SELECT body_text FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
        );
        agreementText = fallbackResult.rows[0]?.body_text || 'Agreement text is unavailable.';
      }

      try {
        const pdfBuf = await generateAgreementPdf({
          agreementTitle: row.agreement_title || 'Club Agreement',
          agreementVersion: row.sig_agreement_version || undefined,
          agreementText,
          customerName,
          customerDob: row.customer_dob,
          membershipNumber: row.membership_number || undefined,
          checkinAt: new Date(row.block_starts_at),
          signedAt,
          ...(isManualOverride
            ? { signatureText: 'Manual Signature Override' }
            : { signatureImageBase64: row.sig_png_base64 || undefined }),
        });

        return reply
          .header('Content-Disposition', `inline; filename="agreement-${documentId.slice(0, 8)}.pdf"`)
          .type('application/pdf')
          .send(pdfBuf);
      } catch (err) {
        request.log.error({ err, documentId }, 'Failed to generate PDF on the fly');
        return reply.status(500).send({ error: 'Failed to generate PDF document' });
      }
    }
  );
}

