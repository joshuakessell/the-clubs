"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentsRoutes = documentsRoutes;
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../auth/middleware");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const auditLog_1 = require("../audit/auditLog");
const UPLOADS_DIR = (0, path_1.join)(process.cwd(), 'services', 'api', 'uploads');
async function ensureUploadsDir() {
    try {
        await fs_1.promises.mkdir(UPLOADS_DIR, { recursive: true });
    }
    catch {
        // Directory might already exist, ignore
    }
}
async function documentsRoutes(fastify) {
    fastify.get('/v1/admin/employees/:employeeId/documents', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const { employeeId } = request.params;
            const documents = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT 
          ed.*,
          s1.name as employee_name,
          s2.name as uploaded_by_name
         FROM employee_documents ed
         JOIN staff s1 ON s1.id = ed.employee_id
         JOIN staff s2 ON s2.id = ed.uploaded_by
         WHERE ed.employee_id = ${employeeId}
         ORDER BY ed.uploaded_at DESC`);
            return reply.send(documents.rows.map((doc) => ({
                id: doc.id,
                employeeId: doc.employee_id,
                employeeName: doc.employee_name,
                docType: doc.doc_type,
                filename: doc.filename,
                mimeType: doc.mime_type,
                uploadedBy: doc.uploaded_by,
                uploadedByName: doc.uploaded_by_name,
                uploadedAt: doc.uploaded_at.toISOString(),
                notes: doc.notes,
            })));
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch documents');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/employees/:employeeId/documents', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            if (!request.staff) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const staffId = request.staff.staffId;
            const { employeeId } = request.params;
            await ensureUploadsDir();
            const body = request.body;
            if (!body.fileData || !body.filename) {
                return reply.status(400).send({ error: 'fileData and filename are required' });
            }
            const docType = body.docType || 'OTHER';
            const notes = body.notes || null;
            if (!['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA', 'OTHER'].includes(docType)) {
                return reply.status(400).send({ error: 'Invalid document type' });
            }
            const buffer = Buffer.from(body.fileData, 'base64');
            const filename = body.filename;
            const mimeType = body.mimeType || 'application/octet-stream';
            const hash = (0, crypto_1.createHash)('sha256').update(buffer).digest('hex');
            if (employeeId.includes('..')) {
                return reply.status(400).send({ error: 'Invalid employee ID' });
            }
            if (filename.includes('..')) {
                return reply.status(400).send({ error: 'Invalid filename' });
            }
            const employeeDir = (0, path_1.join)(UPLOADS_DIR, employeeId);
            await fs_1.promises.mkdir(employeeDir, { recursive: true });
            const documentId = (0, crypto_1.randomUUID)();
            const storageKey = (0, path_1.join)(employeeId, documentId, filename);
            const filePath = (0, path_1.join)(UPLOADS_DIR, storageKey);
            await fs_1.promises.mkdir((0, path_1.join)(UPLOADS_DIR, employeeId, documentId), { recursive: true });
            await fs_1.promises.writeFile(filePath, buffer);
            const result = await db_1.db.transaction(async (tx) => {
                const docResult = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO employee_documents 
           (id, employee_id, doc_type, filename, mime_type, storage_key, uploaded_by, notes, sha256_hash)
           VALUES (${documentId}, ${employeeId}, ${docType}, ${filename}, ${mimeType}, ${storageKey}, ${staffId}, ${notes}, ${hash})
           RETURNING id, employee_id, doc_type, filename, mime_type, storage_key, uploaded_by, uploaded_at, notes, sha256_hash`);
                await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                    staffId,
                    action: 'DOCUMENT_UPLOADED',
                    entityType: 'employee_document',
                    entityId: documentId,
                });
                return docResult.rows[0];
            });
            return reply.send({
                id: result.id,
                employeeId: result.employee_id,
                docType: result.doc_type,
                filename: result.filename,
                mimeType: result.mime_type,
                uploadedAt: result.uploaded_at.toISOString(),
                notes: result.notes,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to upload document');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/documents/:documentId', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        try {
            const { documentId } = request.params;
            const docResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, doc_type, filename, mime_type, storage_key, uploaded_by, uploaded_at, notes, sha256_hash FROM employee_documents WHERE id = ${documentId}`);
            if (docResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Document not found' });
            }
            const doc = docResult.rows[0];
            if (request.staff) {
                const isAdmin = request.staff.role === 'ADMIN';
                const isEmployee = request.staff.staffId === doc.employee_id;
                if (!isAdmin && !isEmployee) {
                    return reply.status(403).send({ error: 'Forbidden' });
                }
            }
            else {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            if (doc.storage_key.includes('..')) {
                return reply.status(400).send({ error: 'Invalid file path' });
            }
            const filePath = (0, path_1.join)(UPLOADS_DIR, doc.storage_key);
            try {
                const fileBuffer = await fs_1.promises.readFile(filePath);
                reply.type(doc.mime_type);
                reply.header('Content-Disposition', `attachment; filename="${doc.filename}"`);
                return reply.send(fileBuffer);
            }
            catch (error) {
                request.log.error(error, 'Failed to read document file');
                return reply.status(404).send({ error: 'Document file not found' });
            }
        }
        catch (error) {
            request.log.error(error, 'Failed to download document');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
