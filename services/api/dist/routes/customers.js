"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerRoutes = customerRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const customerService_1 = require("../services/customerService");
// ── Zod Schemas ──
const SearchQuerySchema = zod_1.z.object({
    q: zod_1.z.string().min(3),
    limit: zod_1.z.coerce.number().int().min(1).max(20).optional().default(10),
});
const CustomerNotesListSchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: zod_1.z.string().optional(),
});
const CreateCustomerNoteSchema = zod_1.z.object({
    note: zod_1.z.string().min(1),
    isImportant: zod_1.z.boolean().optional(),
    sourceApp: zod_1.z.enum(['EMPLOYEE_REGISTER', 'OFFICE_DASHBOARD']).optional(),
});
const IdTypeSchema = zod_1.z.enum(['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']);
const CreateFromScanSchema = zod_1.z
    .object({
    idScanValue: zod_1.z.string().min(1).optional(),
    idScanHash: zod_1.z.string().min(16).optional(),
    rawScanText: zod_1.z.string().min(1).optional(),
    firstName: zod_1.z.string().min(1),
    lastName: zod_1.z.string().min(1),
    dob: zod_1.z.string().min(1),
    idExpirationDate: zod_1.z.string().optional(),
    idNumber: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    idType: IdTypeSchema.optional(),
    idTypeOther: zod_1.z.string().optional(),
    fullName: zod_1.z.string().optional(),
    addressLine1: zod_1.z.string().optional(),
    city: zod_1.z.string().optional(),
    addressState: zod_1.z.string().optional(),
    postalCode: zod_1.z.string().optional(),
})
    .refine((v) => Boolean(v.idScanValue || v.rawScanText), { message: 'idScanValue or rawScanText is required' })
    .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), { message: 'idTypeOther is required when idType is OTHER' });
const MatchIdentitySchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1),
    lastName: zod_1.z.string().min(1),
    dob: zod_1.z.string().min(1),
    idNumber: zod_1.z.string().optional(),
});
const CreateManualSchema = zod_1.z
    .object({
    firstName: zod_1.z.string().min(1),
    lastName: zod_1.z.string().min(1),
    dob: zod_1.z.string().min(1),
    idExpirationDate: zod_1.z.string().min(1),
    idType: IdTypeSchema,
    idTypeOther: zod_1.z.string().optional(),
    idNumber: zod_1.z.string().trim().min(1).optional(),
})
    .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), { message: 'idTypeOther is required when idType is OTHER' });
/**
 * Customer routes — thin wrappers around customerService.
 */
async function customerRoutes(fastify) {
    // GET /v1/customers/search
    fastify.get('/v1/customers/search', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let parsed;
        try {
            parsed = SearchQuerySchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const suggestions = await (0, customerService_1.searchCustomers)(parsed.q, parsed.limit);
            return reply.send({ suggestions });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to search customers');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // GET /v1/customers/:customerId/notes
    fastify.get('/v1/customers/:customerId/notes', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let parsed;
        try {
            parsed = CustomerNotesListSchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, customerService_1.listCustomerNotes)(request.params.customerId, { limit: parsed.limit, cursor: parsed.cursor });
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch customer notes');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/customers/:customerId/notes
    fastify.post('/v1/customers/:customerId/notes', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let parsed;
        try {
            parsed = CreateCustomerNoteSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, customerService_1.createCustomerNote)(request.params.customerId, parsed.note, { staffId: request.staff.staffId, staffName: request.staff.name }, { isImportant: parsed.isImportant, sourceApp: parsed.sourceApp });
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create customer note');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // GET /v1/customers/:id
    fastify.get('/v1/customers/:id', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const customer = await (0, customerService_1.getCustomerProfile)(request.params.id);
            if (!customer)
                return reply.status(404).send({ error: 'Customer not found' });
            return reply.send({ customer });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch customer profile');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/customers/create-from-scan
    fastify.post('/v1/customers/create-from-scan', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CreateFromScanSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, customerService_1.createFromScan)(body);
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
            }
            fastify.log.error(error, 'Failed to create customer from scan');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/customers/match-identity
    fastify.post('/v1/customers/match-identity', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = MatchIdentitySchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, customerService_1.matchIdentity)(body);
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to match customer identity');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/customers/create-manual
    fastify.post('/v1/customers/create-manual', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CreateManualSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, customerService_1.createManual)(body);
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
            }
            fastify.log.error(error, 'Failed to create customer (manual)');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
