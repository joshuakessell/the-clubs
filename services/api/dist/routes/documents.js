"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentsRoutes = documentsRoutes;
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const auditLog_1 = require("../audit/auditLog");
const UPLOADS_DIR = (0, path_1.join)(process.cwd(), 'services', 'api', 'uploads');
/**
 * Ensure uploads directory exists.
 */
async function ensureUploadsDir() {
    try {
        await fs_1.promises.mkdir(UPLOADS_DIR, { recursive: true });
    }
    catch {
        // Directory might already exist, ignore
    }
}
/**
 * Documents management routes.
 */
async function documentsRoutes(fastify) {
    /**
     * GET /v1/admin/employees/:employeeId/documents
     *
     * Lists all documents for an employee.
     */
    fastify.get('/v1/admin/employees/:employeeId/documents', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            const { employeeId } = request.params;
            const documents = await (0, db_1.query)(`SELECT 
          ed.*,
          s1.name as employee_name,
          s2.name as uploaded_by_name
         FROM employee_documents ed
         JOIN staff s1 ON s1.id = ed.employee_id
         JOIN staff s2 ON s2.id = ed.uploaded_by
         WHERE ed.employee_id = $1
         ORDER BY ed.uploaded_at DESC`, [employeeId]);
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
    /**
     * POST /v1/admin/employees/:employeeId/documents
     *
     * Uploads a document for an employee.
     */
    fastify.post('/v1/admin/employees/:employeeId/documents', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            if (!request.staff) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const staffId = request.staff.staffId;
            const { employeeId } = request.params;
            await ensureUploadsDir();
            // For POC, accept JSON with base64 encoded file
            // In production, use @fastify/multipart for proper file uploads
            const body = request.body;
            if (!body.fileData || !body.filename) {
                return reply.status(400).send({ error: 'fileData and filename are required' });
            }
            const docType = body.docType || 'OTHER';
            const notes = body.notes || null;
            if (!['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA', 'OTHER'].includes(docType)) {
                return reply.status(400).send({ error: 'Invalid document type' });
            }
            // Decode base64 file data
            const buffer = Buffer.from(body.fileData, 'base64');
            const filename = body.filename;
            const mimeType = body.mimeType || 'application/octet-stream';
            // Compute SHA256 hash
            const hash = (0, crypto_1.createHash)('sha256').update(buffer).digest('hex');
            // Validate inputs to prevent path traversal
            if (employeeId.includes('..')) {
                return reply.status(400).send({ error: 'Invalid employee ID' });
            }
            if (filename.includes('..')) {
                return reply.status(400).send({ error: 'Invalid filename' });
            }
            // Create storage path
            const employeeDir = (0, path_1.join)(UPLOADS_DIR, employeeId);
            await fs_1.promises.mkdir(employeeDir, { recursive: true });
            const documentId = (0, crypto_1.randomUUID)();
            const storageKey = (0, path_1.join)(employeeId, documentId, filename);
            const filePath = (0, path_1.join)(UPLOADS_DIR, storageKey);
            // Ensure directory exists
            await fs_1.promises.mkdir((0, path_1.join)(UPLOADS_DIR, employeeId, documentId), { recursive: true });
            // Write file
            await fs_1.promises.writeFile(filePath, buffer);
            // Save to database
            const result = await (0, db_1.transaction)(async (client) => {
                const docResult = await client.query(`INSERT INTO employee_documents 
           (id, employee_id, doc_type, filename, mime_type, storage_key, uploaded_by, notes, sha256_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`, [documentId, employeeId, docType, filename, mimeType, storageKey, staffId, notes, hash]);
                // Write audit log
                await (0, auditLog_1.insertAuditLog)(client, {
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
    /**
     * GET /v1/admin/documents/:documentId
     *
     * Downloads a document.
     */
    fastify.get('/v1/admin/documents/:documentId', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        try {
            const { documentId } = request.params;
            // Get document info
            const docResult = await (0, db_1.query)(`SELECT * FROM employee_documents WHERE id = $1`, [documentId]);
            if (docResult.rows.length === 0) {
                return reply.status(404).send({ error: 'Document not found' });
            }
            const doc = docResult.rows[0];
            // Check access: admin or the employee themselves
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
            // Validate storage key to prevent path traversal
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
