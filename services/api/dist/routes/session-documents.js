"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionDocumentsRoutes = sessionDocumentsRoutes;
const middleware_1 = require("../auth/middleware");
const db_1 = require("../db");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Session document verification routes.
 *
 * These are intentionally minimal "debug/verification" endpoints so staff apps can prove:
 * - agreement PDF bytes exist
 * - signature artifact exists
 */
async function sessionDocumentsRoutes(fastify) {
    /**
     * GET /v1/documents/customers
     *
     * Auth required.
     * Returns a list of customers matching a name search (for agreement lookup).
     */
    fastify.get('/v1/documents/customers', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const name = request.query.name?.trim() ?? '';
        if (!name) {
            return reply.status(400).send({ message: 'name query is required' });
        }
        const rows = await (0, db_1.query)(`SELECT
           c.id,
           c.name,
           c.dob,
           c.membership_number,
           MAX(v.started_at) as last_visit_at
         FROM customers c
         LEFT JOIN visits v ON v.customer_id = c.id
         WHERE c.name ILIKE '%' || $1 || '%'
         GROUP BY c.id
         ORDER BY c.name ASC, last_visit_at DESC NULLS LAST
         LIMIT 50`, [name]);
        const customers = rows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            dob: r.dob ? r.dob.toISOString() : null,
            membership_number: r.membership_number,
            last_visit_at: r.last_visit_at ? r.last_visit_at.toISOString() : null,
        }));
        return reply.send({ customers });
    });
    /**
     * GET /v1/documents/by-customer/:customerId
     *
     * Auth required.
     * Returns a list of agreement documents for a customer.
     */
    fastify.get('/v1/documents/by-customer/:customerId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { customerId } = request.params;
        const rows = await (0, db_1.query)(`SELECT
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
         WHERE v.customer_id = $1
         ORDER BY v.started_at DESC NULLS LAST, cb.created_at DESC`, [customerId]);
        const documents = rows.rows.map((r) => {
            const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
            const signatureMaterial = (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
                (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
            const signatureHashPrefix = hasSignature && signatureMaterial
                ? crypto_1.default.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
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
    });
    /**
     * GET /v1/documents/by-session/:sessionId
     *
     * Auth required.
     * Returns a list of documents tied to a lane session's check-in block.
     */
    fastify.get('/v1/documents/by-session/:sessionId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { sessionId } = request.params;
        const rows = await (0, db_1.query)(`SELECT
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
         WHERE cb.session_id = $1
         ORDER BY cb.created_at DESC`, [sessionId]);
        const documents = rows.rows.map((r) => {
            const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
            const signatureMaterial = (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
                (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
            const signatureHashPrefix = hasSignature && signatureMaterial
                ? crypto_1.default.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
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
    });
    /**
     * GET /v1/documents/:documentId/download
     *
     * Auth required.
     * Returns the raw PDF bytes for an agreement (stored on checkin_blocks.agreement_pdf).
     */
    fastify.get('/v1/documents/:documentId/download', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { documentId } = request.params;
        const result = await (0, db_1.query)(`SELECT agreement_pdf FROM checkin_blocks WHERE id = $1`, [documentId]);
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Document not found' });
        }
        const pdf = result.rows[0].agreement_pdf;
        if (!pdf) {
            return reply.status(404).send({ error: 'Agreement PDF not stored for this document' });
        }
        reply.type('application/pdf');
        reply.header('Content-Disposition', `attachment; filename="agreement-${documentId}.pdf"`);
        return reply.send(pdf);
    });
}
