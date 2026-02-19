import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { transaction } from '../db';

const CashDrawerOpenSchema = z.object({
  registerSessionId: z.string().uuid(),
  openingFloatCents: z.number().int().nonnegative(),
  notes: z.string().optional().nullable(),
});

const CashDrawerEventSchema = z
  .object({
    type: z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT']),
    amountCents: z.number().int().optional().nullable(),
    reason: z.string().optional().nullable(),
    metadataJson: z.record(z.unknown()).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'NO_SALE_OPEN') {
      if (value.amountCents !== null && value.amountCents !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'amountCents must be null for NO_SALE_OPEN',
          path: ['amountCents'],
        });
      }
      return;
    }
    if (value.amountCents === null || value.amountCents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amountCents is required for money-moving events',
        path: ['amountCents'],
      });
      return;
    }
    if (value.type !== 'ADJUSTMENT' && value.amountCents < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amountCents must be >= 0 for this event type',
        path: ['amountCents'],
      });
    }
  });

const CashDrawerCloseSchema = z.object({
  countedCashCents: z.number().int().nonnegative(),
  notes: z.string().optional().nullable(),
});

type CashDrawerSessionRow = {
  id: string;
  register_session_id: string;
  opened_by_staff_id: string;
  opened_at: Date;
  opening_float_cents: number;
  closed_by_staff_id: string | null;
  closed_at: Date | null;
  counted_cash_cents: number | null;
  expected_cash_cents: number | null;
  over_short_cents: number | null;
  notes: string | null;
  status: 'OPEN' | 'CLOSED';
};

type CashDrawerEventSumRow = { type: string; amount_cents: number | null };

export async function cashDrawerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/cash-drawers/open
   *
   * Open a cash drawer session for a register session.
   */
  fastify.post('/v1/cash-drawers/open', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    let body: z.infer<typeof CashDrawerOpenSchema>;
    try {
      body = CashDrawerOpenSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const session = await transaction(async (client) => {
        const registerResult = await client.query<{ id: string; signed_out_at: Date | null }>(
          `SELECT id, signed_out_at
             FROM register_sessions
             WHERE id = $1`,
          [body.registerSessionId]
        );
        if (registerResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Register session not found' };
        }

        const activeDrawer = await client.query<{ id: string }>(
          `SELECT id FROM cash_drawer_sessions
             WHERE register_session_id = $1 AND status = 'OPEN'
             LIMIT 1`,
          [body.registerSessionId]
        );
        if (activeDrawer.rows.length > 0) {
          throw { statusCode: 409, message: 'Cash drawer session already open' };
        }

        const insertResult = await client.query<CashDrawerSessionRow>(
          `INSERT INTO cash_drawer_sessions
             (register_session_id, opened_by_staff_id, opening_float_cents, notes, status)
             VALUES ($1, $2, $3, $4, 'OPEN')
             RETURNING *`,
          [
            body.registerSessionId,
            request.staff!.staffId,
            body.openingFloatCents,
            body.notes || null,
          ]
        );

        return insertResult.rows[0]!;
      });

      return reply.send({
        sessionId: session.id,
        registerSessionId: session.register_session_id,
        openedByStaffId: session.opened_by_staff_id,
        openedAt: session.opened_at.toISOString(),
        openingFloatCents: session.opening_float_cents,
        status: session.status,
        notes: session.notes,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
      }
      request.log.error(error, 'Failed to open cash drawer session');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/cash-drawers/:sessionId/events
   *
   * Record a cash drawer event.
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/v1/cash-drawers/:sessionId/events',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CashDrawerEventSchema>;
      try {
        body = CashDrawerEventSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`,
            [request.params.sessionId]
          );
          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Cash drawer session not found' };
          }
          if (sessionResult.rows[0]!.status !== 'OPEN') {
            throw { statusCode: 409, message: 'Cash drawer session is closed' };
          }

          const insertResult = await client.query<{
            id: string;
            occurred_at: Date;
            type: string;
            amount_cents: number | null;
          }>(
            `INSERT INTO cash_drawer_events
             (cash_drawer_session_id, type, amount_cents, reason, created_by_staff_id, metadata_json)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, occurred_at, type, amount_cents`,
            [
              request.params.sessionId,
              body.type,
              body.amountCents ?? null,
              body.reason || null,
              request.staff!.staffId,
              body.metadataJson ?? null,
            ]
          );

          return insertResult.rows[0]!;
        });

        return reply.send({
          eventId: result.id,
          occurredAt: result.occurred_at.toISOString(),
          type: result.type,
          amountCents: result.amount_cents,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to record cash drawer event');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/cash-drawers/:sessionId/close
   *
   * Close a cash drawer session and compute expected cash.
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/v1/cash-drawers/:sessionId/close',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CashDrawerCloseSchema>;
      try {
        body = CashDrawerCloseSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<CashDrawerSessionRow>(
            `SELECT * FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`,
            [request.params.sessionId]
          );
          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Cash drawer session not found' };
          }
          const session = sessionResult.rows[0]!;
          if (session.status !== 'OPEN') {
            throw { statusCode: 409, message: 'Cash drawer session is already closed' };
          }

          const sums = await client.query<CashDrawerEventSumRow>(
            `SELECT type, SUM(amount_cents) as amount_cents
             FROM cash_drawer_events
             WHERE cash_drawer_session_id = $1
             GROUP BY type`,
            [session.id]
          );

          const sumByType = new Map<string, number>();
          for (const row of sums.rows) {
            const amount =
              typeof row.amount_cents === 'number'
                ? row.amount_cents
                : Number(row.amount_cents ?? 0);
            sumByType.set(row.type, amount);
          }

          const paidIn = sumByType.get('PAID_IN') ?? 0;
          const paidOut = sumByType.get('PAID_OUT') ?? 0;
          const drops = sumByType.get('DROP') ?? 0;
          const adjustments = sumByType.get('ADJUSTMENT') ?? 0;

          // TODO: add cash payments from orders once tender tracking is implemented.
          const cashPaymentsAppliedToOrders = 0;

          const expectedCash =
            session.opening_float_cents +
            paidIn -
            paidOut -
            drops +
            adjustments +
            cashPaymentsAppliedToOrders;
          const overShort = body.countedCashCents - expectedCash;

          const updated = await client.query<CashDrawerSessionRow>(
            `UPDATE cash_drawer_sessions
             SET status = 'CLOSED',
                 closed_by_staff_id = $1,
                 closed_at = NOW(),
                 counted_cash_cents = $2,
                 expected_cash_cents = $3,
                 over_short_cents = $4,
                 notes = COALESCE($5, notes)
             WHERE id = $6
             RETURNING *`,
            [
              request.staff!.staffId,
              body.countedCashCents,
              expectedCash,
              overShort,
              body.notes ?? null,
              session.id,
            ]
          );

          return updated.rows[0]!;
        });

        return reply.send({
          sessionId: result.id,
          status: result.status,
          closedAt: result.closed_at?.toISOString() || null,
          countedCashCents: result.counted_cash_cents,
          expectedCashCents: result.expected_cash_cents,
          overShortCents: result.over_short_cents,
          notes: result.notes,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to close cash drawer session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
