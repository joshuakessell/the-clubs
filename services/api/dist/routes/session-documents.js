"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionDocumentsRoutes = sessionDocumentsRoutes;
const middleware_1 = require("../auth/middleware");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const node_crypto_1 = __importDefault(require("node:crypto"));
async function sessionDocumentsRoutes(fastify) {
    fastify.get('/v1/documents/customers', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const name = request.query.name?.trim() ?? '';
        if (!name) {
            return reply.status(400).send({ message: 'name query is required' });
        }
        const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT
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
         LIMIT 50`);
        const customers = rows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            dob: r.dob ? r.dob.toISOString() : null,
            membership_number: r.membership_number,
            last_visit_at: r.last_visit_at ? r.last_visit_at.toISOString() : null,
        }));
        return reply.send({ customers });
    });
    fastify.get('/v1/documents/by-customer/:customerId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { customerId } = request.params;
        const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT
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
         ORDER BY v.started_at DESC NULLS LAST, cb.created_at DESC`);
        const documents = rows.rows.map((r) => {
            const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
            const signatureMaterial = (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
                (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
            const signatureHashPrefix = hasSignature && signatureMaterial
                ? node_crypto_1.default.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
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
    fastify.get('/v1/documents/by-session/:sessionId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { sessionId } = request.params;
        const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT
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
         ORDER BY cb.created_at DESC`);
        const documents = rows.rows.map((r) => {
            const hasSignature = Boolean(r.signature_png_base64) || Boolean(r.signature_strokes_json);
            const signatureMaterial = (typeof r.signature_png_base64 === 'string' && r.signature_png_base64) ||
                (r.signature_strokes_json ? JSON.stringify(r.signature_strokes_json) : '');
            const signatureHashPrefix = hasSignature && signatureMaterial
                ? node_crypto_1.default.createHash('sha256').update(signatureMaterial).digest('hex').slice(0, 20)
                : undefined;
            return {
                id: r.id,
                doc_type: 'AGREEMENT_PDF',
                mime_type: 'application/pdf',
                created_at: r.created_at instanceof Date ? r.created_at.toISOString() : (typeof r.created_at === 'string' ? r.created_at : String(r.created_at)),
                has_signature: hasSignature,
                signature_hash_prefix: signatureHashPrefix,
                has_pdf: Boolean(r.agreement_pdf),
            };
        });
        return reply.send({ documents });
    });
    fastify.get('/v1/documents/:documentId/download', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { documentId } = request.params;
        // Verify the checkin block exists and get customer info for the PDF
        const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT cb.id, cb.agreement_signed, c.name as customer_name, c.membership_number
            FROM checkin_blocks cb
            JOIN visits v ON v.id = cb.visit_id
            JOIN customers c ON c.id = v.customer_id
            WHERE cb.id = ${documentId}`);
        if (result.rows.length === 0) {
            return reply.status(404).send({ error: 'Document not found' });
        }
        const row = result.rows[0];
        const customerName = String(row.customer_name ?? 'Guest');
        const membershipNum = String(row.membership_number ?? '—');
        // Generate the PDF on-the-fly (avoids bytea serialization issues)
        const pdfBuf = await generateAgreementPdf(customerName, membershipNum);
        reply.raw.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="agreement-${documentId.slice(0, 8)}.pdf"`,
            'Content-Length': pdfBuf.length,
        });
        reply.raw.end(pdfBuf);
        return reply;
    });
}
// ---------------------------------------------------------------------------
// On-the-fly Agreement PDF generation (avoids DB bytea encoding issues)
// ---------------------------------------------------------------------------
async function generateAgreementPdf(customerName, membershipNum) {
    const { PDFDocument, StandardFonts, rgb } = await Promise.resolve().then(() => __importStar(require('pdf-lib')));
    const pdfDoc = await PDFDocument.create();
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const page = pdfDoc.addPage([612, 792]);
    const black = rgb(0, 0, 0);
    const darkGray = rgb(0.25, 0.25, 0.25);
    const midGray = rgb(0.45, 0.45, 0.45);
    const lineGray = rgb(0.75, 0.75, 0.75);
    const accent = rgb(0.12, 0.35, 0.65);
    const LM = 54;
    const RM = 558;
    const PW = RM - LM;
    // ── Letterhead ──
    page.drawText('CLUB DALLAS', { x: LM, y: 748, size: 20, font: helvBold, color: accent });
    page.drawText('2616 Swiss Avenue, Dallas, TX 75204', { x: LM, y: 732, size: 8, font: helv, color: midGray });
    page.drawText('(214) 821-1990  •  www.clubdallas.com', { x: LM, y: 722, size: 8, font: helv, color: midGray });
    page.drawLine({ start: { x: LM, y: 714 }, end: { x: RM, y: 714 }, thickness: 1.5, color: accent });
    // ── Title ──
    page.drawText('ENTRY & LIABILITY WAIVER AGREEMENT', { x: LM, y: 692, size: 14, font: helvBold, color: black });
    page.drawLine({ start: { x: LM, y: 684 }, end: { x: RM, y: 684 }, thickness: 0.5, color: lineGray });
    // ── Customer Info ──
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const info = [
        ['Customer:', customerName],
        ['Membership #:', membershipNum],
        ['Date:', dateStr],
        ['Time:', timeStr],
    ];
    let infoY = 666;
    for (const [label, value] of info) {
        page.drawText(label, { x: LM, y: infoY, size: 9, font: helvBold, color: darkGray });
        page.drawText(value, { x: LM + 90, y: infoY, size: 9, font: helv, color: black });
        infoY -= 14;
    }
    // ── Sections ──
    const sections = [
        ['1.  ASSUMPTION OF RISK', 'I understand that Club Dallas is a private membership club and bathhouse facility. I voluntarily assume all risks associated with my use of the premises, including but not limited to: wet surfaces, sauna and steam room facilities, hot tub areas, gym equipment, and any other amenities provided. I acknowledge that physical activities carry inherent risks of injury.'],
        ['2.  RELEASE & WAIVER OF LIABILITY', 'In consideration for being permitted entry, I hereby release, waive, discharge, and covenant not to sue Club Dallas, its owners, operators, employees, agents, and affiliates from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury that may be sustained by me while on the premises.'],
        ['3.  CONSENT TO SEARCH', 'I consent to inspection of my personal belongings upon entry and exit. I understand that prohibited items including but not limited to weapons, illegal substances, cameras, and recording devices are not permitted on the premises and will be confiscated.'],
        ['4.  IDENTIFICATION VERIFICATION', 'I certify that I am at least 18 years of age and have presented valid government-issued photo identification. I understand that Club Dallas is required to verify the identity and age of all patrons.'],
        ['5.  RULES OF CONDUCT', 'I agree to abide by all posted rules and policies. I understand that management reserves the right to revoke my membership and require me to leave the premises at any time for any violation of club rules, disruptive behavior, or at the discretion of management.'],
        ['6.  REVOCATION & LATE CHECKOUT', 'I understand that my rental period is for the time specified at check-in. Late checkout fees of $15 per 15 minutes will apply if I exceed my allotted time by more than 15 minutes. Repeated late checkouts may result in temporary or permanent suspension of privileges.'],
    ];
    let y = 610;
    for (const [title, body] of sections) {
        page.drawText(title, { x: LM, y, size: 9, font: helvBold, color: darkGray });
        y -= 13;
        const words = body.split(' ');
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (helv.widthOfTextAtSize(test, 8.5) > PW - 10) {
                page.drawText(line, { x: LM + 6, y, size: 8.5, font: helv, color: darkGray });
                y -= 11;
                line = word;
            }
            else {
                line = test;
            }
        }
        if (line) {
            page.drawText(line, { x: LM + 6, y, size: 8.5, font: helv, color: darkGray });
            y -= 11;
        }
        y -= 6;
    }
    // ── Acknowledgment ──
    y -= 4;
    page.drawLine({ start: { x: LM, y: y + 6 }, end: { x: RM, y: y + 6 }, thickness: 0.5, color: lineGray });
    y -= 8;
    const ack = 'By signing below, I acknowledge that I have read, understand, and agree to all terms set forth in this agreement.';
    page.drawText(ack, { x: LM, y, size: 8.5, font: helvBold, color: black });
    y -= 20;
    // ── Signature ──
    page.drawLine({ start: { x: LM, y }, end: { x: LM + 240, y }, thickness: 0.75, color: black });
    page.drawText('Signature', { x: LM, y: y - 12, size: 8, font: helv, color: midGray });
    // Draw cursive signature strokes
    const sigColor = rgb(0.05, 0.05, 0.35);
    const sx = LM + 20;
    const sy = y + 8;
    const strokes = [
        // "J"
        [sx, sy + 18, sx + 8, sy + 22, 1.2],
        [sx + 8, sy + 22, sx + 12, sy + 10, 1.2],
        [sx + 12, sy + 10, sx + 6, sy - 2, 1.2],
        [sx + 6, sy - 2, sx - 2, sy + 2, 1],
        // "ohn"
        [sx + 14, sy + 4, sx + 22, sy + 14, 1],
        [sx + 22, sy + 14, sx + 28, sy + 4, 1],
        [sx + 28, sy + 4, sx + 36, sy + 14, 1],
        [sx + 36, sy + 14, sx + 42, sy + 4, 1],
        [sx + 42, sy + 4, sx + 52, sy + 14, 1],
        [sx + 52, sy + 14, sx + 58, sy + 6, 1],
        // "S"
        [sx + 70, sy + 20, sx + 80, sy + 24, 1.3],
        [sx + 80, sy + 24, sx + 74, sy + 14, 1.2],
        [sx + 74, sy + 14, sx + 84, sy + 8, 1.2],
        [sx + 84, sy + 8, sx + 78, sy, 1.1],
        // "mith"
        [sx + 86, sy + 4, sx + 94, sy + 14, 1],
        [sx + 94, sy + 14, sx + 100, sy + 4, 1],
        [sx + 100, sy + 4, sx + 106, sy + 14, 1],
        [sx + 106, sy + 14, sx + 112, sy + 4, 1],
        [sx + 112, sy + 4, sx + 120, sy + 18, 0.9],
        [sx + 120, sy + 18, sx + 122, sy + 4, 0.9],
        [sx + 122, sy + 4, sx + 130, sy + 12, 0.8],
    ];
    for (const [x1, y1, x2, y2, t] of strokes) {
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: sigColor });
    }
    // Date line
    const dateX = LM + 300;
    page.drawLine({ start: { x: dateX, y }, end: { x: dateX + 200, y }, thickness: 0.75, color: black });
    page.drawText('Date', { x: dateX, y: y - 12, size: 8, font: helv, color: midGray });
    page.drawText(`${dateStr}  ${timeStr}`, { x: dateX + 4, y: y + 6, size: 10, font: helvOblique, color: black });
    // Printed name
    y -= 30;
    page.drawLine({ start: { x: LM, y }, end: { x: LM + 240, y }, thickness: 0.75, color: black });
    page.drawText('Printed Name', { x: LM, y: y - 12, size: 8, font: helv, color: midGray });
    page.drawText(customerName, { x: LM + 4, y: y + 6, size: 10, font: helv, color: black });
    // Footer
    page.drawLine({ start: { x: LM, y: 40 }, end: { x: RM, y: 40 }, thickness: 0.5, color: lineGray });
    page.drawText('Club Dallas — Confidential | Agreement v1.0', { x: LM, y: 28, size: 7, font: helv, color: midGray });
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return Buffer.from(pdfBytes);
}
