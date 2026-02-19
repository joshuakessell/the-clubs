import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db';
import { requireAuth } from '../auth/middleware';
import crypto from 'crypto';
import {
  computeIdScanIdentityHash,
  getIdScanIssue,
  getIdScanIssueMessage,
} from '../checkin/identity';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';

const SearchQuerySchema = z.object({
  q: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

const IdTypeSchema = z.enum(['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']);

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  dob: string | Date | null;
}

interface CustomerProfileRow {
  id: string;
  name: string;
  dob: string | Date | null;
  membership_number: string | null;
  membership_valid_until: string | Date | null;
  id_number: string | null;
  id_type: string | null;
  id_type_other: string | null;
  id_expiration_date: string | Date | null;
  primary_language: string | null;
  id_scan_hash: string | null;
}

function normalizeScanText(raw: string): string {
  const lf = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = lf.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  return lines.join('\n').trim();
}

function computeSha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toDateOnly(dob: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  // Validate it parses to a real date.
  const d = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return dob;
}

function toDateOnlyString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  return null;
}

function toIsoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null;
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function toDobMonthDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parts = value.split('-');
    if (parts.length >= 3) {
      const mm = parts[1];
      const dd = parts[2];
      if (mm && dd) return `${mm}/${dd}`;
    }
    return null;
  }
  if (value instanceof Date) {
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(value.getUTCDate()).padStart(2, '0');
    return `${mm}/${dd}`;
  }
  return null;
}

const CustomerNotesListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
});

const CreateCustomerNoteSchema = z.object({
  note: z.string().min(1),
  isImportant: z.boolean().optional(),
  sourceApp: z.enum(['EMPLOYEE_REGISTER', 'OFFICE_DASHBOARD']).optional(),
});

type NotesCursor = { createdAt: string; id: string };

function parseNotesCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as NotesCursor;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    const d = new Date(parsed.createdAt);
    if (!Number.isFinite(d.getTime())) return null;
    return { createdAt: d, id: parsed.id };
  } catch {
    return null;
  }
}

function buildNotesCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }),
    'utf8'
  ).toString('base64');
}

type NormalizedNameParts = {
  normalizedFull: string;
  firstToken: string;
  lastToken: string;
};

function normalizePersonNameForMatch(input: string): string {
  const lowered = input.toLowerCase().trim();
  const noPunct = lowered.replace(/[^a-z0-9 ]+/g, ' ');
  const collapsed = noPunct.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const tokens = collapsed.split(' ').filter(Boolean);
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function splitNamePartsForMatch(input: string): NormalizedNameParts | null {
  const normalizedFull = normalizePersonNameForMatch(input);
  if (!normalizedFull) return null;
  const tokens = normalizedFull.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const firstToken = tokens[0]!;
  const lastToken = tokens[tokens.length - 1]!;
  return { normalizedFull, firstToken, lastToken };
}

function scoreNameSimilarity(input: NormalizedNameParts, stored: NormalizedNameParts): number {
  let score = 0;
  const inputFirst = input.firstToken;
  const inputLast = input.lastToken;
  const storedFirst = stored.firstToken;
  const storedLast = stored.lastToken;

  if (input.normalizedFull === stored.normalizedFull) score += 3;

  const direct = inputFirst === storedFirst && inputLast === storedLast;
  const swapped = inputFirst === storedLast && inputLast === storedFirst;
  if (direct) score += 2;
  else if (swapped) score += 1;

  if (inputLast === storedLast) score += 1;
  if (inputFirst === storedFirst) score += 1;

  if (inputFirst[0] && storedFirst[0] && inputFirst[0] === storedFirst[0]) score += 0.5;
  if (inputLast[0] && storedLast[0] && inputLast[0] === storedLast[0]) score += 0.5;

  if (storedFirst.startsWith(inputFirst) || inputFirst.startsWith(storedFirst)) score += 0.5;
  if (storedLast.startsWith(inputLast) || inputLast.startsWith(storedLast)) score += 0.5;

  return score;
}

export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/customers/search - Prefix search by first or last name (case-insensitive).
   * Requires staff auth; returns limited identity fields only.
   */
  fastify.get<{
    Querystring: z.infer<typeof SearchQuerySchema>;
  }>(
    '/v1/customers/search',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let parsed;
      try {
        parsed = SearchQuerySchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const { q, limit } = parsed;
      const like = `${q}%`;

      try {
        const result = await query<CustomerRow>(
          `
        SELECT id, name, membership_number, dob
        FROM customers
        WHERE
          name ILIKE $1
          OR split_part(name, ' ', 2) ILIKE $1
        ORDER BY name
        LIMIT $2
        `,
          [like, limit]
        );

        const toMonthDay = (dob: CustomerRow['dob']): string | undefined => {
          if (!dob) return undefined;
          // pg typically returns DATE as "YYYY-MM-DD" string; handle Date defensively.
          if (typeof dob === 'string') {
            const parts = dob.split('-');
            if (parts.length >= 3) {
              const mm = parts[1]!;
              const dd = parts[2]!;
              if (mm && dd) return `${mm}/${dd}`;
            }
            return undefined;
          }
          if (dob instanceof Date) {
            const mm = String(dob.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(dob.getUTCDate()).padStart(2, '0');
            return `${mm}/${dd}`;
          }
          return undefined;
        };

        const suggestions = result.rows.map((row) => {
          const nameParts = row.name.split(' ');
          const firstName = nameParts[0] || row.name;
          const lastName = nameParts.slice(1).join(' ') || '';
          const disambiguator =
            (row.membership_number && row.membership_number.slice(-4)) || row.id.slice(0, 8);

          return {
            id: row.id,
            name: row.name,
            firstName,
            lastName,
            membershipNumber: row.membership_number || undefined,
            dobMonthDay: toMonthDay(row.dob),
            disambiguator,
          };
        });

        return reply.send({ suggestions });
      } catch (error) {
        request.log.error(error, 'Failed to search customers');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/customers/:customerId/notes
   *
   * Structured customer notes (staff-auth), newest first.
   */
  fastify.get<{
    Params: { customerId: string };
    Querystring: z.infer<typeof CustomerNotesListSchema>;
  }>(
    '/v1/customers/:customerId/notes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let parsed: z.infer<typeof CustomerNotesListSchema>;
      try {
        parsed = CustomerNotesListSchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const cursor = parseNotesCursor(parsed.cursor);

      try {
        const rows = await query<{
          id: string;
          customer_id: string;
          created_at: Date;
          created_by_staff_id: string | null;
          created_by_staff_name: string;
          source_app: string;
          note: string;
          is_important: boolean;
        }>(
          `
          SELECT id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important
          FROM customer_notes
          WHERE customer_id = $1
            AND deleted_at IS NULL
            AND (
              $2::timestamptz IS NULL
              OR (created_at < $2 OR (created_at = $2 AND id < $3::uuid))
            )
          ORDER BY created_at DESC, id DESC
          LIMIT $4
          `,
          [
            request.params.customerId,
            cursor?.createdAt ?? null,
            cursor?.id ?? '00000000-0000-0000-0000-000000000000',
            parsed.limit,
          ]
        );

        const notes = rows.rows.map((r) => ({
          id: r.id,
          customerId: r.customer_id,
          createdAt: r.created_at.toISOString(),
          createdByStaffId: r.created_by_staff_id,
          createdByStaffName: r.created_by_staff_name,
          sourceApp: r.source_app,
          note: r.note,
          isImportant: r.is_important,
          cursor: buildNotesCursor({ createdAt: r.created_at, id: r.id }),
        }));

        const nextCursor = notes.length === parsed.limit ? notes[notes.length - 1]!.cursor : null;
        return reply.send({ notes, nextCursor });
      } catch (error) {
        request.log.error(error, 'Failed to fetch customer notes');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/:customerId/notes
   *
   * Add a structured note for the customer.
   */
  fastify.post<{
    Params: { customerId: string };
    Body: z.infer<typeof CreateCustomerNoteSchema>;
  }>(
    '/v1/customers/:customerId/notes',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let parsed: z.infer<typeof CreateCustomerNoteSchema>;
      try {
        parsed = CreateCustomerNoteSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const noteText = parsed.note.trim();
      if (!noteText) return reply.status(400).send({ error: 'note is required' });

      try {
        const created = await transaction(async (client) => {
          const inserted = await client.query<{
            id: string;
            created_at: Date;
          }>(
            `
            INSERT INTO customer_notes
              (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
            VALUES
              ($1::uuid, $2::uuid, $3, $4, $5, $6)
            RETURNING id, created_at
            `,
            [
              request.params.customerId,
              request.staff!.staffId,
              request.staff!.name,
              parsed.sourceApp ?? 'EMPLOYEE_REGISTER',
              noteText,
              parsed.isImportant ?? false,
            ]
          );

          const row = inserted.rows[0]!;

          const preview = noteText.length > 80 ? `${noteText.slice(0, 77)}…` : noteText;
          const event = await insertCustomerActivityEvent(client, {
            customerId: request.params.customerId,
            actionType: 'NOTE_ADDED',
            actionCategory: 'NOTE',
            sourceApp: parsed.sourceApp ?? 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: request.staff!.staffId,
            actorStaffName: request.staff!.name,
            summary: `Note added: ${preview}`,
            metadata: {
              noteId: row.id,
              isImportant: parsed.isImportant ?? false,
            },
            dedupeKey: null,
          });

          request.log.info(
            {
              customerActivityEventId: event.id,
              customerId: request.params.customerId,
              actionType: 'NOTE_ADDED',
              actionCategory: 'NOTE',
              sourceApp: parsed.sourceApp ?? 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: request.staff!.staffId,
            },
            'customer_activity_event'
          );

          return row;
        });

        return reply.send({
          id: created.id,
          createdAt: created.created_at.toISOString(),
        });
      } catch (error) {
        request.log.error(error, 'Failed to create customer note');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/customers/:id - Fetch full customer profile fields.
   * Requires staff auth.
   */
  fastify.get<{
    Params: { id: string };
  }>(
    '/v1/customers/:id',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const customerId = request.params.id;
      const normalizedId = customerId?.trim();
      if (!normalizedId) {
        return reply.status(400).send({ error: 'Invalid customer id' });
      }

      try {
        const looksLikeUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            normalizedId
          );

        const result = await query<CustomerProfileRow>(
          `
          SELECT
            id,
            name,
            dob,
            membership_number,
            membership_valid_until,
            id_number,
            id_type,
            id_type_other,
            id_expiration_date,
            primary_language,
            id_scan_hash
          FROM customers
          WHERE ${looksLikeUuid ? 'id = $1' : 'membership_number = $1'}
          LIMIT 1
          `,
          [normalizedId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Customer not found' });
        }

        const row = result.rows[0]!;

        const nameParts = row.name.split(' ');
        const firstName = nameParts[0] || row.name;
        const lastName = nameParts.slice(1).join(' ') || '';

        const idTypeParsed = row.id_type ? IdTypeSchema.safeParse(row.id_type) : null;
        const idType = idTypeParsed?.success ? idTypeParsed.data : null;

        const lastVisitResult = await query<{ starts_at: Date }>(
          `
          SELECT cb.starts_at
          FROM checkin_blocks cb
          JOIN visits v ON v.id = cb.visit_id
          WHERE v.customer_id = $1
          ORDER BY cb.starts_at DESC
          LIMIT 1
          `,
          [row.id]
        );
        const lastVisitAt =
          lastVisitResult.rows.length > 0
            ? toIsoTimestamp(lastVisitResult.rows[0]!.starts_at)
            : null;

        return reply.send({
          customer: {
            id: row.id,
            name: row.name,
            firstName,
            lastName,
            dob: toDateOnlyString(row.dob),
            dobMonthDay: toDobMonthDay(row.dob),
            membershipNumber: row.membership_number,
            membershipValidUntil: toDateOnlyString(row.membership_valid_until),
            idNumber: row.id_number,
            idType,
            idTypeOther: row.id_type_other,
            idExpirationDate: toDateOnlyString(row.id_expiration_date),
            primaryLanguage: row.primary_language === 'EN' || row.primary_language === 'ES'
              ? (row.primary_language as 'EN' | 'ES')
              : null,
            lastVisitAt,
            hasEncryptedLookupMarker: Boolean(row.id_scan_hash),
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch customer profile');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/create-from-scan
   *
   * Creates (or returns existing) customer record derived from an ID scan that produced NO_MATCH.
   * Persists id_scan_hash + id_scan_value so subsequent scans match instantly.
   *
   * Auth required.
   */
  const CreateFromScanSchema = z
    .object({
      // Preferred: send normalized value + hash from /v1/checkin/scan response.
      idScanValue: z.string().min(1).optional(),
      idScanHash: z.string().min(16).optional(),
      // Fallback: raw scan text; server will normalize + hash.
      rawScanText: z.string().min(1).optional(),
      // Identity fields (minimum)
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      dob: z.string().min(1),
      idExpirationDate: z.string().optional(),
      idNumber: z.string().optional(),
      state: z.string().optional(),
      idType: IdTypeSchema.optional(),
      idTypeOther: z.string().optional(),
      fullName: z.string().optional(),
      // Optional prefill fields (not currently persisted in DB schema)
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      addressState: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .refine((v) => Boolean(v.idScanValue || v.rawScanText), {
      message: 'idScanValue or rawScanText is required',
    })
    .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), {
      message: 'idTypeOther is required when idType is OTHER',
    });

  fastify.post(
    '/v1/customers/create-from-scan',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CreateFromScanSchema>;
      try {
        body = CreateFromScanSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const idScanValue = normalizeScanText(body.idScanValue || body.rawScanText || '');
      if (!idScanValue) {
        return reply.status(400).send({ error: 'Invalid scan input' });
      }

      const idScanHash =
        computeIdScanIdentityHash({
          firstName: body.firstName,
          lastName: body.lastName,
          fullName: body.fullName,
          dob: body.dob,
        }) ||
        body.idScanHash ||
        computeSha256Hex(idScanValue);
      const dob = toDateOnly(body.dob);
      if (!dob) {
        return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });
      }
      const idExpirationDate = body.idExpirationDate ? toDateOnly(body.idExpirationDate) : null;
      if (body.idExpirationDate && !idExpirationDate) {
        return reply.status(400).send({ error: 'Invalid idExpirationDate; expected YYYY-MM-DD' });
      }
      const idType = body.idType ?? null;
      const idTypeOther =
        idType === 'OTHER' ? (body.idTypeOther?.trim() || null) : null;
      const idScanIssue = getIdScanIssue({ dob, idExpirationDate });
      if (idScanIssue) {
        return reply.status(403).send({
          error: getIdScanIssueMessage(idScanIssue),
          code: idScanIssue,
        });
      }

      const name = (body.fullName?.trim() || `${body.firstName} ${body.lastName}`.trim()).slice(
        0,
        255
      );
      if (!name) {
        return reply.status(400).send({ error: 'Invalid name' });
      }

      try {
        // Idempotent behavior: if another lane already created this customer, return it.
        const existing = await query<{
          id: string;
          name: string;
          dob: string | Date | null;
          membership_number: string | null;
          banned_until: Date | null;
          id_scan_hash: string | null;
          id_scan_value: string | null;
        }>(
          `SELECT id, name, dob, membership_number, banned_until, id_scan_hash, id_scan_value
         FROM customers
         WHERE id_scan_hash = $1 OR id_scan_value = $2
         LIMIT 1`,
          [idScanHash, idScanValue]
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0]!;
          if (row.banned_until && row.banned_until > new Date()) {
            return reply.status(403).send({ error: 'Customer is banned' });
          }

          // Backfill missing identifiers if needed.
          const needsScanUpdate =
            !row.id_scan_hash ||
            !row.id_scan_value ||
            row.id_scan_hash !== idScanHash ||
            row.id_scan_value !== idScanValue;
          if (needsScanUpdate || body.idNumber || body.state || idType || idTypeOther) {
            await query(
              `UPDATE customers
             SET id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> $1 THEN $1 ELSE id_scan_hash END,
                 id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> $2 THEN $2 ELSE id_scan_value END,
                 id_expiration_date = COALESCE(id_expiration_date, $4::date),
                 id_number = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_number END,
                 id_state = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE id_state END,
                 id_type = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE id_type END,
                 id_type_other = CASE WHEN $7::text IS NOT NULL THEN $8 ELSE id_type_other END,
                 updated_at = NOW()
             WHERE id = $3`,
              [
                idScanHash,
                idScanValue,
                row.id,
                idExpirationDate,
                body.idNumber || null,
                body.state || null,
                idType,
                idTypeOther,
              ]
            );
          } else if (idExpirationDate) {
            await query(
              `UPDATE customers
               SET id_expiration_date = $1::date,
                   updated_at = NOW()
               WHERE id = $2`,
              [idExpirationDate, row.id]
            );
          }

          return reply.send({
            created: false,
            customer: {
              id: row.id,
              name: row.name,
              dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
              membershipNumber: row.membership_number,
            },
          });
        }

        const inserted = await query<{
          id: string;
          name: string;
          dob: Date | null;
          membership_number: string | null;
        }>(
          `INSERT INTO customers
           (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_hash, id_scan_value, created_at, updated_at)
         VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING id, name, dob, membership_number`,
          [
            name,
            dob,
            idExpirationDate,
            body.idNumber || null,
            body.state || null,
            idType,
            idTypeOther,
            idScanHash,
            idScanValue,
          ]
        );

        const row = inserted.rows[0]!;
        return reply.send({
          created: true,
          customer: {
            id: row.id,
            name: row.name,
            dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
            membershipNumber: row.membership_number,
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to create customer from scan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/match-identity
   *
   * Staff-only endpoint for exact-ish identity match by (firstName,lastName,dob).
   * Used by manual "First Time Customer / Alternate ID" to avoid accidental duplicates.
   */
  const MatchIdentitySchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.string().min(1), // YYYY-MM-DD
  });

  fastify.post(
    '/v1/customers/match-identity',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof MatchIdentitySchema>;
      try {
        body = MatchIdentitySchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const dob = toDateOnly(body.dob);
      if (!dob) return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });

      const inputParts = splitNamePartsForMatch(`${body.firstName} ${body.lastName}`);
      if (!inputParts) return reply.status(400).send({ error: 'Invalid name' });

      try {
        const res = await query<{
          id: string;
          name: string;
          dob: string | Date | null;
          membership_number: string | null;
          created_at: Date;
        }>(
          `SELECT id, name, dob, membership_number, created_at
           FROM customers
           WHERE dob = $1::date
           ORDER BY created_at ASC
           LIMIT 50`,
          [dob]
        );

        const matches = res.rows
          .map((row) => {
            const parts = splitNamePartsForMatch(row.name);
            if (!parts) return null;
            const score =
              scoreNameSimilarity(inputParts, parts) + (row.membership_number ? 0.5 : 0);
            if (score < 1.5) return null;
            return {
              id: row.id,
              name: row.name,
              dob: row.dob instanceof Date ? row.dob.toISOString().slice(0, 10) : row.dob,
              membershipNumber: row.membership_number,
              score,
              createdAt: row.created_at,
            };
          })
          .filter(Boolean) as Array<{
          id: string;
          name: string;
          dob: string | null;
          membershipNumber: string | null;
          score: number;
          createdAt: Date;
        }>;

        matches.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
        const best = matches[0] ?? null;

        return reply.send({
          matchCount: matches.length,
          bestMatch: best
            ? {
                id: best.id,
                name: best.name,
                dob: best.dob,
                membershipNumber: best.membershipNumber,
              }
            : null,
        });
      } catch (error) {
        request.log.error(error, 'Failed to match customer identity');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/customers/create-manual
   *
   * Staff-only endpoint to create a customer record from manual entry (firstName,lastName,dob).
   * This intentionally does NOT de-dupe; caller should use /match-identity first if desired.
   */
  const CreateManualSchema = z
    .object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      dob: z.string().min(1), // YYYY-MM-DD
      idExpirationDate: z.string().min(1), // YYYY-MM-DD
      idType: IdTypeSchema,
      idTypeOther: z.string().optional(),
      idNumber: z.string().trim().min(1).optional(),
    })
    .refine((v) => v.idType !== 'OTHER' || Boolean(v.idTypeOther?.trim()), {
      message: 'idTypeOther is required when idType is OTHER',
    });

  fastify.post(
    '/v1/customers/create-manual',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CreateManualSchema>;
      try {
        body = CreateManualSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const dob = toDateOnly(body.dob);
      if (!dob) return reply.status(400).send({ error: 'Invalid dob; expected YYYY-MM-DD' });
      const idExpirationDate = toDateOnly(body.idExpirationDate);
      if (!idExpirationDate) {
        return reply.status(400).send({ error: 'Invalid idExpirationDate; expected YYYY-MM-DD' });
      }
      const idType = body.idType;
      const idTypeOther = idType === 'OTHER' ? body.idTypeOther?.trim() || null : null;

      const name = `${body.firstName} ${body.lastName}`.trim().slice(0, 255);
      if (!name) return reply.status(400).send({ error: 'Invalid name' });
      const idScanValue = body.idNumber?.trim() || null;
      const idScanIssue = getIdScanIssue({ dob, idExpirationDate });
      if (idScanIssue) {
        return reply.status(403).send({
          error: getIdScanIssueMessage(idScanIssue),
          code: idScanIssue,
        });
      }

      try {
        const inserted = await query<{
          id: string;
          name: string;
          dob: Date | null;
          membership_number: string | null;
        }>(
          `INSERT INTO customers (name, dob, id_expiration_date, id_type, id_type_other, id_scan_value, id_number, created_at, updated_at)
           VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, NOW(), NOW())
           RETURNING id, name, dob, membership_number`,
          [name, dob, idExpirationDate, idType, idTypeOther, idScanValue, idScanValue]
        );

        const row = inserted.rows[0]!;
        return reply.send({
          created: true,
          customer: {
            id: row.id,
            name: row.name,
            dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
            membershipNumber: row.membership_number,
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to create customer (manual)');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
