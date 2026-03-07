import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import {
  searchCustomers,
  listCustomerNotes,
  createCustomerNote,
  getCustomerProfile,
  createFromScan,
  matchIdentity,
  createManual,
} from '../services/customerService';

// ── Zod Schemas ──

const SearchQuerySchema = z.object({
  q: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

const CustomerNotesListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
});

const CreateCustomerNoteSchema = z.object({
  note: z.string().min(1),
  isImportant: z.boolean().optional(),
  sourceApp: z.enum(['EMPLOYEE_REGISTER', 'OFFICE_DASHBOARD']).optional(),
});

const IdTypeSchema = z.enum(['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']);

const CreateFromScanSchema = z
  .object({
    idScanValue: z.string().min(1).optional(),
    idScanHash: z.string().min(16).optional(),
    rawScanText: z.string().min(1).optional(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.string().min(1),
    idExpirationDate: z.string().optional(),
    idNumber: z.string().optional(),
    state: z.string().optional(),
    idType: IdTypeSchema.optional(),
    idTypeOther: z.string().optional(),
    fullName: z.string().optional(),
    addressLine1: z.string().optional(),
    city: z.string().optional(),
    addressState: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .refine((v) => Boolean(v.idScanValue || v.rawScanText), { message: 'idScanValue or rawScanText is required' })
  .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), { message: 'idTypeOther is required when idType is OTHER' });

const MatchIdentitySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().min(1),
  idNumber: z.string().optional(),
});

const CreateManualSchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.string().min(1),
    idExpirationDate: z.string().min(1),
    idType: IdTypeSchema,
    idTypeOther: z.string().optional(),
    idNumber: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), { message: 'idTypeOther is required when idType is OTHER' });

/**
 * Customer routes — thin wrappers around customerService.
 */
export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/customers/search
  fastify.get<{ Querystring: z.infer<typeof SearchQuerySchema> }>(
    '/v1/customers/search', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      let parsed;
      try { parsed = SearchQuerySchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

      try {
        const suggestions = await searchCustomers(parsed.q, parsed.limit);
        return reply.send({ suggestions });
      } catch (error) {
        fastify.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // GET /v1/customers/:customerId/notes
  fastify.get<{ Params: { customerId: string }; Querystring: z.infer<typeof CustomerNotesListSchema> }>(
    '/v1/customers/:customerId/notes', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      let parsed: z.infer<typeof CustomerNotesListSchema>;
      try { parsed = CustomerNotesListSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

      try {
        const result = await listCustomerNotes(request.params.customerId, { limit: parsed.limit, cursor: parsed.cursor });
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch customer notes');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // POST /v1/customers/:customerId/notes
  fastify.post<{ Params: { customerId: string }; Body: z.infer<typeof CreateCustomerNoteSchema> }>(
    '/v1/customers/:customerId/notes', { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      let parsed: z.infer<typeof CreateCustomerNoteSchema>;
      try { parsed = CreateCustomerNoteSchema.parse(request.body); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

      try {
        const result = await createCustomerNote(
          request.params.customerId, parsed.note,
          { staffId: request.staff.staffId, staffName: request.staff.name },
          { isImportant: parsed.isImportant, sourceApp: parsed.sourceApp }
        );
        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create customer note');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // GET /v1/customers/:id
  fastify.get<{ Params: { id: string } }>(
    '/v1/customers/:id', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      try {
        const customer = await getCustomerProfile(request.params.id);
        if (!customer) return reply.status(404).send({ error: 'Customer not found' });
        return reply.send({ customer });
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch customer profile');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // POST /v1/customers/create-from-scan
  fastify.post('/v1/customers/create-from-scan', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    let body: z.infer<typeof CreateFromScanSchema>;
    try { body = CreateFromScanSchema.parse(request.body); }
    catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

    try {
      const result = await createFromScan(body);
      return reply.send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string; code?: string };
        return reply.status(err.statusCode).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      }
      fastify.log.error(error, 'Failed to create customer from scan');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /v1/customers/match-identity
  fastify.post('/v1/customers/match-identity', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    let body: z.infer<typeof MatchIdentitySchema>;
    try { body = MatchIdentitySchema.parse(request.body); }
    catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

    try {
      const result = await matchIdentity(body);
      return reply.send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
        return reply.status(err.statusCode).send({ error: err.message });
      }
      fastify.log.error(error, 'Failed to match customer identity');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /v1/customers/create-manual
  fastify.post('/v1/customers/create-manual', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    let body: z.infer<typeof CreateManualSchema>;
    try { body = CreateManualSchema.parse(request.body); }
    catch (error) { return reply.status(400).send({ error: 'Validation failed', details: error instanceof z.ZodError ? error.errors : 'Invalid input' }); }

    try {
      const result = await createManual(body);
      return reply.send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string; code?: string };
        return reply.status(err.statusCode).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      }
      fastify.log.error(error, 'Failed to create customer (manual)');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
