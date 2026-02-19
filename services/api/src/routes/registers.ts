import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db';
import { verifyPin } from '../auth/utils';
import { requireAuth } from '../auth/middleware';
import { insertAuditLog } from '../audit/auditLog';
import { insertClubEvent } from '../activity/clubEventLog';
import { buildTenderSummaryFromPayments } from '../money/tenderSummary';
import { buildCloseoutSnapshot, type CashDrawerSessionRow } from '../money/closeout';

/**
 * Schema for PIN verification request.
 */
const VerifyPinSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  deviceId: z.string().min(1),
});

type VerifyPinInput = z.infer<typeof VerifyPinSchema>;

/**
 * Schema for register assignment request.
 */
const AssignRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(3).optional(),
});

type AssignRegisterInput = z.infer<typeof AssignRegisterSchema>;

/**
 * Schema for register confirmation request.
 */
const ConfirmRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(3),
});

type ConfirmRegisterInput = z.infer<typeof ConfirmRegisterSchema>;

/**
 * Schema for heartbeat request.
 */
const HeartbeatSchema = z.object({
  deviceId: z.string().min(1),
});

type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

const CloseoutStartSchema = z.object({
  registerSessionId: z.string().uuid(),
});

const CloseoutFinalizeSchema = z.object({
  registerSessionId: z.string().uuid(),
  countedCashCents: z.number().int().nonnegative(),
  notes: z.string().optional().nullable(),
});

interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  pin_hash: string | null;
  active: boolean;
}

interface RegisterSessionRow {
  id: string;
  employee_id: string;
  device_id: string;
  register_number: number;
  last_heartbeat: Date;
  last_activity_at?: Date;
  created_at: Date;
  signed_out_at: Date | null;
}

interface CloseoutPaymentRow {
  id: string;
  amount: number | string | null;
  tip_cents?: number | null;
  payment_method?: string | null;
  quote_json?: unknown;
}

type CashDrawerSessionFullRow = CashDrawerSessionRow & {
  status: 'OPEN' | 'CLOSED';
  closed_at: Date | null;
  closeout_snapshot_json?: unknown | null;
};

type Queryable = {
  query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

async function buildRegisterCloseoutSummary(
  client: Queryable,
  session: RegisterSessionRow,
  closeoutAt: Date
) {
  const payments = await client.query<CloseoutPaymentRow>(
    `SELECT id, amount, tip_cents, payment_method, quote_json
     FROM payment_intents
     WHERE status = 'PAID'
       AND register_number = $1
       AND paid_at >= $2
       AND paid_at <= $3`,
    [session.register_number, session.created_at, closeoutAt]
  );

  return buildTenderSummaryFromPayments(payments.rows);
}

/**
 * Helper function to ensure a device is registered and enabled for register use.
 *
 * Behavior:
 * - If device does not exist in `devices`, auto-register it as enabled.
 * - If device exists but is disabled, throw DEVICE_DISABLED.
 */
async function ensureDeviceEnabled(deviceId: string): Promise<void> {
  const result = await query<{ enabled: boolean }>(
    `SELECT enabled FROM devices WHERE device_id = $1`,
    [deviceId]
  );

  // Auto-register unknown devices (enabled by default)
  if (result.rows.length === 0) {
    const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
    const displayName = `Auto-registered (${safeSuffix})`;

    await query(
      `INSERT INTO devices (device_id, display_name, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, displayName]
    );
    return;
  }

  if (!result.rows[0]!.enabled) {
    throw new Error('DEVICE_DISABLED');
  }
}

/**
 * Register management routes.
 * Handles employee sign-in, register assignment, heartbeat, and sign-out.
 */
export async function registerRoutes(
  fastify: FastifyInstance & { broadcaster: any }
): Promise<void> {
  /**
   * GET /v1/employees/available
   *
   * Returns list of employees for register sign-in, including signed-in status.
   */
  fastify.get('/v1/employees/available', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all active employees
      const allEmployees = await query<EmployeeRow>(
        `SELECT id, name, role, active
         FROM staff
         WHERE active = true
         ORDER BY name`
      );

      // Get employees currently signed into registers
      const activeSessions = await query<{ employee_id: string; register_number: number }>(
        `SELECT employee_id, register_number
         FROM register_sessions
         WHERE signed_out_at IS NULL`
      );

      const registersByEmployee = new Map<string, number[]>();
      for (const row of activeSessions.rows) {
        const current = registersByEmployee.get(row.employee_id) ?? [];
        current.push(row.register_number);
        registersByEmployee.set(row.employee_id, current);
      }

      const employees = allEmployees.rows.map((emp) => {
        const registerNumbers = registersByEmployee.get(emp.id) ?? [];
        registerNumbers.sort((a, b) => a - b);
        return {
          id: emp.id,
          name: emp.name,
          role: emp.role,
          signedIn: registerNumbers.length > 0,
          registerNumbers,
        };
      });

      return reply.send({ employees });
    } catch (error) {
      request.log.error(error, 'Failed to fetch employees');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch employees',
      });
    }
  });

  /**
   * GET /v1/registers/availability
   *
   * Returns which register numbers (1-3) are currently occupied.
   * Used by the employee-kiosk UI so the user can choose a register.
   */
  fastify.get(
    '/v1/registers/availability',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const active = await query<{
          register_number: number;
          device_id: string;
          employee_id: string;
          employee_name: string;
          employee_role: string;
        }>(
          `SELECT
           rs.register_number,
           rs.device_id,
           rs.employee_id,
           s.name as employee_name,
           s.role as employee_role
         FROM register_sessions rs
         JOIN staff s ON s.id = rs.employee_id
         WHERE rs.signed_out_at IS NULL`
        );

        const byRegister = new Map<number, (typeof active.rows)[number]>();
        for (const row of active.rows) {
          byRegister.set(row.register_number, row);
        }

        const registers = [1, 2, 3].map((num) => {
          const row = byRegister.get(num);
          if (!row) {
            return { registerNumber: num as 1 | 2 | 3, occupied: false };
          }
          return {
            registerNumber: num as 1 | 2 | 3,
            occupied: true,
            deviceId: row.device_id,
            employee: {
              id: row.employee_id,
              name: row.employee_name,
              role: row.employee_role,
            },
          };
        });

        return reply.send({ registers });
      } catch (error) {
        request.log.error(error, 'Failed to fetch register availability');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch register availability',
        });
      }
    }
  );

  /**
   * POST /v1/registers/closeout/start
   *
   * Compute expected totals snapshot for the open cash drawer session.
   */
  fastify.post<{ Body: z.infer<typeof CloseoutStartSchema> }>(
    '/v1/registers/closeout/start',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let body: z.infer<typeof CloseoutStartSchema>;
      try {
        body = CloseoutStartSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const registerResult = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`,
            [body.registerSessionId]
          );
          if (registerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Active register session not found' };
          }

          const registerSession = registerResult.rows[0]!;
          if (registerSession.employee_id !== request.staff!.staffId) {
            throw { statusCode: 403, message: 'Not authorized to close out this register' };
          }

          const drawerResult = await client.query<CashDrawerSessionFullRow>(
            `SELECT id, register_session_id, opened_at, opening_float_cents, status, closed_at, closeout_snapshot_json
             FROM cash_drawer_sessions
             WHERE register_session_id = $1 AND status = 'OPEN'
             ORDER BY opened_at DESC
             LIMIT 1`,
            [registerSession.id]
          );
          if (drawerResult.rows.length === 0) {
            throw { statusCode: 409, message: 'No open cash drawer session for this register' };
          }

          const drawerSession = drawerResult.rows[0]!;
          const closeoutAt = new Date();
          const snapshot = await buildCloseoutSnapshot(client, drawerSession, closeoutAt);

          return {
            registerSessionId: registerSession.id,
            drawerSessionId: drawerSession.id,
            snapshot,
          };
        });

        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to start register closeout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/registers/closeout/finalize
   *
   * Finalize a cash drawer closeout and persist the snapshot.
   */
  fastify.post<{ Body: z.infer<typeof CloseoutFinalizeSchema> }>(
    '/v1/registers/closeout/finalize',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let body: z.infer<typeof CloseoutFinalizeSchema>;
      try {
        body = CloseoutFinalizeSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const registerResult = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`,
            [body.registerSessionId]
          );
          if (registerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Active register session not found' };
          }

          const registerSession = registerResult.rows[0]!;
          if (registerSession.employee_id !== request.staff!.staffId) {
            throw { statusCode: 403, message: 'Not authorized to close out this register' };
          }

          const drawerResult = await client.query<CashDrawerSessionFullRow>(
            `SELECT id, register_session_id, opened_at, opening_float_cents, status, closed_at, closeout_snapshot_json
             FROM cash_drawer_sessions
             WHERE register_session_id = $1
             ORDER BY opened_at DESC
             LIMIT 1
             FOR UPDATE`,
            [registerSession.id]
          );

          if (drawerResult.rows.length === 0) {
            throw { statusCode: 409, message: 'No cash drawer session for this register' };
          }

          const drawerSession = drawerResult.rows[0]!;
          if (drawerSession.status !== 'OPEN') {
            if (drawerSession.closeout_snapshot_json) {
              return {
                registerSessionId: registerSession.id,
                drawerSessionId: drawerSession.id,
                alreadyClosed: true,
                snapshot: drawerSession.closeout_snapshot_json,
              };
            }
            throw { statusCode: 409, message: 'Cash drawer session already closed' };
          }

          const closeoutAt = new Date();
          const snapshot = await buildCloseoutSnapshot(client, drawerSession, closeoutAt);
          const overShortCents = body.countedCashCents - snapshot.expectedCashCents;
          const closeoutSnapshot = {
            ...snapshot,
            countedCashCents: body.countedCashCents,
            overShortCents,
            closedByStaffId: request.staff!.staffId,
            notes: body.notes ?? null,
          };

          await client.query(
            `UPDATE cash_drawer_sessions
             SET status = 'CLOSED',
                 closed_by_staff_id = $1,
                 closed_at = $2,
                 counted_cash_cents = $3,
                 expected_cash_cents = $4,
                 over_short_cents = $5,
                 notes = COALESCE($6, notes),
                 closeout_snapshot_json = $7
             WHERE id = $8`,
            [
              request.staff!.staffId,
              closeoutAt,
              body.countedCashCents,
              snapshot.expectedCashCents,
              overShortCents,
              body.notes ?? null,
              closeoutSnapshot,
              drawerSession.id,
            ]
          );

          await client.query(
            `UPDATE register_sessions
             SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb)
             WHERE id = $2`,
            [closeoutSnapshot, registerSession.id]
          );

          return {
            registerSessionId: registerSession.id,
            drawerSessionId: drawerSession.id,
            alreadyClosed: false,
            snapshot: closeoutSnapshot,
          };
        });

        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to finalize register closeout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/auth/verify-pin
   *
   * Verifies employee PIN without creating a session.
   * Used in the sign-in flow before register assignment.
   */
  fastify.post(
    '/v1/auth/verify-pin',
    async (request: FastifyRequest<{ Body: VerifyPinInput }>, reply: FastifyReply) => {
      let body: VerifyPinInput;

      try {
        body = VerifyPinSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Check device is enabled
        try {
          await ensureDeviceEnabled(body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }
        const result = await query<EmployeeRow>(
          `SELECT id, name, role, pin_hash, active
         FROM staff
         WHERE id = $1
         AND pin_hash IS NOT NULL
         AND active = true
         LIMIT 1`,
          [body.employeeId]
        );

        if (result.rows.length === 0) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Employee not found or inactive',
          });
        }

        const employee = result.rows[0]!;

        // Verify PIN
        if (!employee.pin_hash || !(await verifyPin(body.pin, employee.pin_hash))) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Wrong PIN',
          });
        }

        return reply.send({
          verified: true,
          employee: {
            id: employee.id,
            name: employee.name,
            role: employee.role,
          },
        });
      } catch (error) {
        request.log.error(error, 'PIN verification error');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to verify PIN',
        });
      }
    }
  );

  /**
   * POST /v1/registers/assign
   *
   * Assigns a register to an employee.
   * If registerNumber is not provided, automatically assigns the next available register.
   * Returns the assigned register number and requires confirmation.
   */
  fastify.post(
    '/v1/registers/assign',
    async (request: FastifyRequest<{ Body: AssignRegisterInput }>, reply: FastifyReply) => {
      let body: AssignRegisterInput;

      try {
        body = AssignRegisterSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Check device is enabled
        try {
          await ensureDeviceEnabled(body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }

        const result = await transaction(async (client) => {
          // Check if device is already signed in
          const existingDevice = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
            [body.deviceId]
          );

          if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0]!;
            const ageMinutes =
              session.last_activity_at instanceof Date
                ? (Date.now() - session.last_activity_at.getTime()) / 60000
                : 0;

            // Safety valve: if the client got signed out / lost state, but the
            // server session is clearly abandoned, release it immediately.
            if (ageMinutes >= 2) {
              await client.query(
                `UPDATE register_sessions
                 SET signed_out_at = NOW()
                 WHERE id = $1
                   AND signed_out_at IS NULL`,
                [session.id]
              );
            } else {
              throw new Error('Device already signed into a register');
            }
          }

          // Get currently occupied registers
          const occupiedRegisters = await client.query<{ register_number: number }>(
            `SELECT register_number FROM register_sessions
           WHERE signed_out_at IS NULL`
          );

          const occupiedNumbers = new Set(occupiedRegisters.rows.map((r) => r.register_number));

          let registerNumber: number;

          if (body.registerNumber) {
            // Check if requested register is available
            if (occupiedNumbers.has(body.registerNumber)) {
              const existingRegister = await client.query<RegisterSessionRow>(
                `SELECT * FROM register_sessions
                 WHERE register_number = $1
                   AND signed_out_at IS NULL`,
                [body.registerNumber]
              );
              const existing = existingRegister.rows[0];
              if (existing && existing.employee_id === body.employeeId) {
                return {
                  registerNumber: body.registerNumber,
                  requiresConfirmation: true,
                };
              }
              throw new Error(`Register ${body.registerNumber} is already occupied`);
            }
            registerNumber = body.registerNumber;
          } else {
            // Auto-assign remaining register
            const available = [1, 2, 3].find((num) => !occupiedNumbers.has(num));
            if (!available) {
              throw new Error('All registers are occupied');
            }
            registerNumber = available;
          }

          return {
            registerNumber,
            requiresConfirmation: true,
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Register assignment error');
        const message = error instanceof Error ? error.message : 'Failed to assign register';
        return reply.status(400).send({
          error: 'Assignment failed',
          message,
        });
      }
    }
  );

  /**
   * POST /v1/registers/confirm
   *
   * Confirms and locks register assignment.
   * Creates the register session and enforces uniqueness constraints.
   */
  fastify.post(
    '/v1/registers/confirm',
    async (request: FastifyRequest<{ Body: ConfirmRegisterInput }>, reply: FastifyReply) => {
      let body: ConfirmRegisterInput;

      try {
        body = ConfirmRegisterSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Check device is enabled
        try {
          await ensureDeviceEnabled(body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }

        const result = await transaction(async (client) => {
          // Double-check constraints before inserting
          const existingDevice = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
            [body.deviceId]
          );

          if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0]!;
            const ageMinutes =
              session.last_activity_at instanceof Date
                ? (Date.now() - session.last_activity_at.getTime()) / 60000
                : 0;

            if (ageMinutes >= 2) {
              await client.query(
                `UPDATE register_sessions
                 SET signed_out_at = NOW()
                 WHERE id = $1
                   AND signed_out_at IS NULL`,
                [session.id]
              );
            } else {
              throw new Error('Device already signed into a register');
            }
          }

          const existingRegister = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions
           WHERE register_number = $1
           AND signed_out_at IS NULL`,
            [body.registerNumber]
          );

          let session: RegisterSessionRow;
          if (existingRegister.rows.length > 0) {
            const existing = existingRegister.rows[0]!;
            if (existing.employee_id === body.employeeId) {
              const sessionResult = await client.query<RegisterSessionRow>(
                `UPDATE register_sessions
                 SET device_id = $1,
                     last_heartbeat = NOW(),
                     last_activity_at = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [body.deviceId, existing.id]
              );
              session = sessionResult.rows[0]!;
            } else {
              throw new Error(`Register ${body.registerNumber} is already occupied`);
            }
          } else {
            // Create register session
            const sessionResult = await client.query<RegisterSessionRow>(
              `INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat, last_activity_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING *`,
              [body.employeeId, body.deviceId, body.registerNumber]
            );

            session = sessionResult.rows[0]!;
          }

          // Create or update timeclock session for register sign-in
          const now = new Date();
          // Find nearest scheduled shift
          const shiftResult = await client.query<{
            id: string;
            starts_at: Date;
            ends_at: Date;
          }>(
            `SELECT id, starts_at, ends_at
           FROM employee_shifts
           WHERE employee_id = $1
           AND status != 'CANCELED'
           AND (
             (starts_at <= $2 AND ends_at >= $2)
             OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes')
           )
           ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp)))
           LIMIT 1`,
            [body.employeeId, now]
          );

          const shiftId = shiftResult.rows.length > 0 ? shiftResult.rows[0]!.id : null;

          // Check if employee already has an open timeclock session
          const existingTimeclock = await client.query<{ id: string }>(
            `SELECT id FROM timeclock_sessions
           WHERE employee_id = $1 AND clock_out_at IS NULL`,
            [body.employeeId]
          );

          if (existingTimeclock.rows.length === 0) {
            // Create new timeclock session
            await client.query(
              `INSERT INTO timeclock_sessions 
             (employee_id, shift_id, clock_in_at, source, notes)
             VALUES ($1, $2, $3, 'EMPLOYEE_REGISTER', NULL)`,
              [body.employeeId, shiftId, now]
            );
          } else {
            // Update existing session to attach shift if not already attached
            if (shiftId) {
              await client.query(
                `UPDATE timeclock_sessions
               SET shift_id = $1
               WHERE id = $2 AND shift_id IS NULL`,
                [shiftId, existingTimeclock.rows[0]!.id]
              );
            }
          }

          // Get employee info
          const employeeResult = await client.query<EmployeeRow>(
            `SELECT id, name, role FROM staff WHERE id = $1`,
            [body.employeeId]
          );

          const employee = employeeResult.rows[0]!;

          // Log audit action
          await insertAuditLog(client, {
            staffId: body.employeeId,
            action: 'REGISTER_SIGN_IN',
            entityType: 'register_session',
            entityId: session.id,
          });

          // Emit club events for analytics
          await insertClubEvent(client, {
            eventType: 'REGISTER_SIGN_IN',
            eventDomain: 'HR',
            sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`,
            staffId: body.employeeId,
            staffName: employee.name,
            summary: `${employee.name} signed into Register ${session.register_number}`,
            metadata: {
              registerSessionId: session.id,
              registerNumber: session.register_number,
              deviceId: body.deviceId,
            },
            dedupeKey: `CLUB:REGISTER_SIGN_IN:${session.id}`,
          });

          if (existingTimeclock.rows.length === 0) {
            // New timeclock session was created — emit clock-in event
            await insertClubEvent(client, {
              eventType: 'EMPLOYEE_CLOCK_IN',
              eventDomain: 'HR',
              sourceApp: 'EMPLOYEE_REGISTER',
              registerId: `register-${session.register_number}`,
              staffId: body.employeeId,
              staffName: employee.name,
              summary: `${employee.name} clocked in`,
              metadata: {
                registerSessionId: session.id,
                shiftId: shiftId,
              },
              dedupeKey: `CLUB:CLOCK_IN:${session.id}`,
            });
          }

          // Broadcast REGISTER_SESSION_UPDATED event
          const payload = {
            registerNumber: session.register_number as 1 | 2 | 3,
            active: true,
            sessionId: session.id,
            employee: {
              id: employee.id,
              displayName: employee.name,
              role: employee.role,
            },
            deviceId: session.device_id,
            createdAt: session.created_at.toISOString(),
            lastHeartbeatAt: session.last_heartbeat.toISOString(),
            reason: 'CONFIRMED' as const,
          };

          fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

          return {
            sessionId: session.id,
            employee: {
              id: employee.id,
              name: employee.name,
              role: employee.role,
            },
            registerNumber: session.register_number,
            deviceId: session.device_id,
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Register confirmation error');
        const message =
          error instanceof Error ? error.message : 'Failed to confirm register assignment';
        return reply.status(400).send({
          error: 'Confirmation failed',
          message,
        });
      }
    }
  );

  /**
   * POST /v1/registers/heartbeat
   *
   * Updates the last_heartbeat timestamp for a register session.
   * Used to keep device sessions alive; inactivity is tracked separately.
   */
  fastify.post(
    '/v1/registers/heartbeat',
    async (request: FastifyRequest<{ Body: HeartbeatInput }>, reply: FastifyReply) => {
      let body: HeartbeatInput;

      try {
        body = HeartbeatSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Check device is enabled
        try {
          await ensureDeviceEnabled(body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }

        const result = await query<RegisterSessionRow>(
          `UPDATE register_sessions
         SET last_heartbeat = NOW()
         WHERE device_id = $1
         AND signed_out_at IS NULL
         RETURNING *`,
          [body.deviceId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'No active register session found for this device',
          });
        }

        return reply.send({
          success: true,
          lastHeartbeat: result.rows[0]!.last_heartbeat.toISOString(),
        });
      } catch (error) {
        request.log.error(error, 'Heartbeat error');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update heartbeat',
        });
      }
    }
  );

  /**
   * POST /v1/registers/activity
   *
   * Updates the last_activity_at timestamp for a register session.
   * Used to sign out sessions after inactivity even if heartbeats continue.
   */
  fastify.post(
    '/v1/registers/activity',
    async (request: FastifyRequest<{ Body: HeartbeatInput }>, reply: FastifyReply) => {
      let body: HeartbeatInput;

      try {
        body = HeartbeatSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Check device is enabled
        try {
          await ensureDeviceEnabled(body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }

        const result = await query<RegisterSessionRow>(
          `UPDATE register_sessions
           SET last_activity_at = NOW()
           WHERE device_id = $1
           AND signed_out_at IS NULL
           RETURNING *`,
          [body.deviceId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'No active register session found for this device',
          });
        }

        return reply.send({
          success: true,
          lastActivity: result.rows[0]!.last_activity_at?.toISOString() ?? null,
        });
      } catch (error) {
        request.log.error(error, 'Register activity error');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update register activity',
        });
      }
    }
  );

  /**
   * POST /v1/registers/signout
   *
   * Signs out an employee from their register.
   * Requires authentication (session token).
   */
  fastify.post<{ Body: { deviceId: string } }>(
    '/v1/registers/signout',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({
          error: 'Unauthorized',
        });
      }

      const deviceId = request.body.deviceId;

      if (!deviceId) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'deviceId is required',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const closeoutAt = new Date();
          // Find active register session for this device
          const sessionResult = await client.query<RegisterSessionRow>(
            `SELECT * FROM register_sessions
           WHERE device_id = $1
           AND signed_out_at IS NULL`,
            [deviceId]
          );

          if (sessionResult.rows.length === 0) {
            throw new Error('No active register session found');
          }

          const session = sessionResult.rows[0]!;

          // Verify employee matches (security check)
          if (session.employee_id !== staff.staffId) {
            throw new Error('Register session does not belong to authenticated employee');
          }

          const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);

          // Sign out
          await client.query(
            `UPDATE register_sessions
                       SET signed_out_at = $1,
                           closeout_summary_json = COALESCE(closeout_summary_json, $2::jsonb)
                       WHERE id = $3`,
            [closeoutAt, closeoutSummary, session.id]
          );

          // Close timeclock session if employee is no longer signed into any register or cleaning station
          // Check if employee has any other active sessions (register or staff_sessions for cleaning)
          const otherRegisterSession = await client.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM register_sessions
                       WHERE employee_id = $1 AND signed_out_at IS NULL`,
            [session.employee_id]
          );

          const otherStaffSession = await client.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM staff_sessions
                       WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
            [session.employee_id]
          );

          // Only close timeclock if no other active sessions
          if (
            parseInt(otherRegisterSession.rows[0]?.count || '0', 10) === 0 &&
            parseInt(otherStaffSession.rows[0]?.count || '0', 10) === 0
          ) {
            await client.query(
              `UPDATE timeclock_sessions
                         SET clock_out_at = NOW()
                         WHERE employee_id = $1 AND clock_out_at IS NULL`,
              [session.employee_id]
            );
          }

          // Log audit action
          await insertAuditLog(client, {
            staffId: request.staff!.staffId,
            action: 'REGISTER_SIGN_OUT',
            entityType: 'register_session',
            entityId: session.id,
          });

          // Emit club events for analytics
          await insertClubEvent(client, {
            eventType: 'REGISTER_SIGN_OUT',
            eventDomain: 'HR',
            sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`,
            staffId: request.staff!.staffId,
            staffName: request.staff!.name,
            summary: `${request.staff!.name} signed out of Register ${session.register_number}`,
            metadata: {
              registerSessionId: session.id,
              registerNumber: session.register_number,
              deviceId,
            },
            dedupeKey: `CLUB:REGISTER_SIGN_OUT:${session.id}`,
          });

          // Emit clock-out if timeclock was closed
          if (
            parseInt(otherRegisterSession.rows[0]?.count || '0', 10) === 0 &&
            parseInt(otherStaffSession.rows[0]?.count || '0', 10) === 0
          ) {
            await insertClubEvent(client, {
              eventType: 'EMPLOYEE_CLOCK_OUT',
              eventDomain: 'HR',
              sourceApp: 'EMPLOYEE_REGISTER',
              registerId: `register-${session.register_number}`,
              staffId: request.staff!.staffId,
              staffName: request.staff!.name,
              summary: `${request.staff!.name} clocked out`,
              metadata: {
                registerSessionId: session.id,
                lastRegisterNumber: session.register_number,
              },
              dedupeKey: `CLUB:CLOCK_OUT:${session.id}`,
            });
          }

          // Broadcast REGISTER_SESSION_UPDATED event
          const payload = {
            registerNumber: session.register_number as 1 | 2 | 3,
            active: false,
            sessionId: null,
            employee: null,
            deviceId: null,
            createdAt: null,
            lastHeartbeatAt: null,
            reason: 'SIGNED_OUT' as const,
          };

          fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

          return {
            success: true,
            sessionId: session.id,
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Sign out error');
        const message = error instanceof Error ? error.message : 'Failed to sign out';
        return reply.status(400).send({
          error: 'Sign out failed',
          message,
        });
      }
    }
  );

  /**
   * POST /v1/registers/signout-all
   *
   * Signs out an employee from all active register sessions.
   * Requires authentication (session token).
   */
  fastify.post(
    '/v1/registers/signout-all',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({
          error: 'Unauthorized',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const closeoutAt = new Date();
          const sessionResult = await client.query<RegisterSessionRow>(
            `UPDATE register_sessions
             SET signed_out_at = $2
             WHERE employee_id = $1
             AND signed_out_at IS NULL
             RETURNING *`,
            [staff.staffId, closeoutAt]
          );

          if (sessionResult.rows.length === 0) {
            return { success: true, signedOutCount: 0 };
          }

          for (const session of sessionResult.rows) {
            const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);
            await client.query(
              `UPDATE register_sessions
               SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb)
               WHERE id = $2`,
              [closeoutSummary, session.id]
            );

            await insertAuditLog(client, {
              staffId: request.staff!.staffId,
              action: 'REGISTER_SIGN_OUT',
              entityType: 'register_session',
              entityId: session.id,
            });

            const payload = {
              registerNumber: session.register_number as 1 | 2 | 3,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
              reason: 'SIGNED_OUT' as const,
            };

            fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
          }

          const otherRegisterSession = await client.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM register_sessions
             WHERE employee_id = $1 AND signed_out_at IS NULL`,
            [staff.staffId]
          );

          const otherStaffSession = await client.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM staff_sessions
             WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
            [staff.staffId]
          );

          if (
            parseInt(otherRegisterSession.rows[0]?.count || '0', 10) === 0 &&
            parseInt(otherStaffSession.rows[0]?.count || '0', 10) === 0
          ) {
            await client.query(
              `UPDATE timeclock_sessions
               SET clock_out_at = NOW()
               WHERE employee_id = $1 AND clock_out_at IS NULL`,
              [staff.staffId]
            );
          }

          return { success: true, signedOutCount: sessionResult.rows.length };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Sign out all error');
        const message = error instanceof Error ? error.message : 'Failed to sign out';
        return reply.status(400).send({
          error: 'Sign out failed',
          message,
        });
      }
    }
  );

  /**
   * GET /v1/registers/status
   *
   * Returns the current register session status for a device.
   * Used to check if device is already signed in.
   */
  fastify.get(
    '/v1/registers/status',
    async (request: FastifyRequest<{ Querystring: { deviceId: string } }>, reply: FastifyReply) => {
      const deviceId = request.query.deviceId;

      if (!deviceId) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'deviceId query parameter is required',
        });
      }

      try {
        // Auto-register device on first contact; reject only if explicitly disabled
        try {
          await ensureDeviceEnabled(deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Device check failed';
          if (message === 'DEVICE_DISABLED') {
            return reply.status(403).send({
              error: 'Device not allowed',
              code: 'DEVICE_DISABLED',
              message: 'This device is not enabled for register use',
            });
          }
          throw err;
        }

        const result = await query<
          RegisterSessionRow & { employee_name: string; employee_role: string }
        >(
          `SELECT 
           rs.*,
           s.name as employee_name,
           s.role as employee_role
         FROM register_sessions rs
         JOIN staff s ON s.id = rs.employee_id
         WHERE rs.device_id = $1
         AND rs.signed_out_at IS NULL`,
          [deviceId]
        );

        if (result.rows.length === 0) {
          return reply.send({
            signedIn: false,
          });
        }

        const session = result.rows[0]!;

        return reply.send({
          signedIn: true,
          sessionId: session.id,
          employee: {
            id: session.employee_id,
            name: session.employee_name,
            role: session.employee_role,
          },
          registerNumber: session.register_number,
          lastHeartbeat: session.last_heartbeat.toISOString(),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch register status');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch register status',
        });
      }
    }
  );
}

/**
 * Clean up abandoned register sessions (no activity for > 15 minutes).
 * Should be called periodically (e.g., every 30 seconds).
 * Broadcasts REGISTER_SESSION_UPDATED events for expired sessions.
 */
export async function cleanupAbandonedRegisterSessions(
  fastify?: FastifyInstance & { broadcaster: any }
): Promise<number> {
  try {
    // Get sessions that will be expired
    const expiredSessions = await query<{
      id: string;
      register_number: number;
    }>(
      `SELECT id, register_number
       FROM register_sessions
       WHERE signed_out_at IS NULL
       AND last_activity_at < NOW() - INTERVAL '15 minutes'`
    );

    if (expiredSessions.rows.length === 0) {
      return 0;
    }

    // Sign them out
    const result = await query(
      `UPDATE register_sessions
       SET signed_out_at = NOW()
       WHERE signed_out_at IS NULL
       AND last_activity_at < NOW() - INTERVAL '15 minutes'`
    );

    // Broadcast events if broadcaster available
    if (fastify?.broadcaster) {
      for (const session of expiredSessions.rows) {
        const payload = {
          registerNumber: session.register_number as 1 | 2 | 3,
          active: false,
          sessionId: null,
          employee: null,
          deviceId: null,
          createdAt: null,
          lastHeartbeatAt: null,
          reason: 'TTL_EXPIRED' as const,
        };
        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
      }
    }

    return result.rowCount || 0;
  } catch (error) {
    console.error('Failed to cleanup abandoned register sessions:', error);
    return 0;
  }
}
