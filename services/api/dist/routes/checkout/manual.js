"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckoutManualRoutes = registerCheckoutManualRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const shared_1 = require("@the-clubs/shared");
const db_1 = require("../../db");
const broadcast_1 = require("../../inventory/broadcast");
const auditLog_1 = require("../../audit/auditLog");
const clubEventLog_1 = require("../../activity/clubEventLog");
const utils_1 = require("../../checkout/utils");
function registerCheckoutManualRoutes(fastify) {
    /**
     * GET /v1/checkout/manual-candidates
     *
     * Staff-only endpoint for manual checkout candidates:
     * - overdue (past scheduled checkout time) OR
     * - within 60 minutes of scheduled checkout time
     */
    fastify.get('/v1/checkout/manual-candidates', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, db_1.query)(`
          WITH room_candidates AS (
            SELECT DISTINCT ON (cb.room_id)
              cb.id as occupancy_id,
              cb.visit_id as visit_id,
              'ROOM'::text as resource_type,
              r.number as number,
              c.id as customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              (cb.ends_at < NOW()) as is_overdue
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            WHERE cb.room_id IS NOT NULL
              AND v.ended_at IS NULL
              AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
            ORDER BY cb.room_id, cb.ends_at DESC
          ),
          locker_candidates AS (
            SELECT DISTINCT ON (cb.locker_id)
              cb.id as occupancy_id,
              cb.visit_id as visit_id,
              'LOCKER'::text as resource_type,
              l.number as number,
              c.id as customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              (cb.ends_at < NOW()) as is_overdue
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.locker_id IS NOT NULL
              AND v.ended_at IS NULL
              AND cb.ends_at <= NOW() + INTERVAL '60 minutes'
            ORDER BY cb.locker_id, cb.ends_at DESC
          )
          SELECT * FROM room_candidates
          UNION ALL
          SELECT * FROM locker_candidates
          ORDER BY is_overdue DESC, scheduled_checkout_at ASC
          `);
            return reply.send({
                candidates: result.rows.map((r) => ({
                    occupancyId: r.occupancy_id,
                    visitId: r.visit_id,
                    resourceType: r.resource_type,
                    number: r.number,
                    customerId: r.customer_id,
                    customerName: r.customer_name,
                    checkinAt: r.checkin_at,
                    scheduledCheckoutAt: r.scheduled_checkout_at,
                    isOverdue: r.is_overdue,
                })),
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to list manual checkout candidates');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    const ManualResolveSchema = zod_1.z
        .object({
        number: zod_1.z.string().min(1).optional(),
        occupancyId: zod_1.z.string().uuid().optional(),
    })
        .refine((v) => Boolean(v.number || v.occupancyId), {
        message: 'Either number or occupancyId is required',
    });
    /**
     * POST /v1/checkout/manual-resolve
     *
     * Staff-only endpoint to resolve a room/locker number or occupancyId
     * into checkout timing + computed late fee/ban.
     */
    fastify.post('/v1/checkout/manual-resolve', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = ManualResolveSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const loadByOccupancyId = async (occupancyId) => {
                const res = await (0, db_1.query)(`
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.id = $1 AND v.ended_at IS NULL
            `, [occupancyId]);
                return res.rows[0] ?? null;
            };
            const loadLatestByRoomId = async (roomId) => {
                const res = await (0, db_1.query)(`
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.room_id = $1 AND v.ended_at IS NULL
            ORDER BY cb.ends_at DESC
            LIMIT 1
            `, [roomId]);
                return res.rows[0] ?? null;
            };
            const loadLatestByLockerId = async (lockerId) => {
                const res = await (0, db_1.query)(`
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            WHERE cb.locker_id = $1 AND v.ended_at IS NULL
            ORDER BY cb.ends_at DESC
            LIMIT 1
            `, [lockerId]);
                return res.rows[0] ?? null;
            };
            let row = null;
            if (body.occupancyId) {
                row = await loadByOccupancyId(body.occupancyId);
            }
            else if (body.number) {
                // Try locker first, then room.
                const lockerRes = await (0, db_1.query)(`SELECT id FROM lockers WHERE number = $1`, [body.number]);
                if (lockerRes.rows[0]?.id) {
                    row = await loadLatestByLockerId(lockerRes.rows[0].id);
                }
                else {
                    const roomRes = await (0, db_1.query)(`SELECT id FROM rooms WHERE number = $1`, [
                        body.number,
                    ]);
                    if (roomRes.rows[0]?.id) {
                        row = await loadLatestByRoomId(roomRes.rows[0].id);
                    }
                }
            }
            if (!row)
                return reply.status(404).send({ error: 'Active occupancy not found' });
            const scheduledCheckoutAt = row.scheduled_checkout_at instanceof Date
                ? row.scheduled_checkout_at
                : new Date(row.scheduled_checkout_at);
            const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
            const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
            const resourceType = row.locker_id ? 'LOCKER' : 'ROOM';
            const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;
            if (!number)
                return reply.status(404).send({ error: 'Resource not found for occupancy' });
            return reply.send({
                occupancyId: row.occupancy_id,
                resourceType,
                number,
                customerName: row.customer_name,
                checkinAt: row.checkin_at,
                scheduledCheckoutAt,
                lateMinutes,
                fee: feeAmount,
                banApplied,
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to resolve manual checkout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    const ManualCompleteSchema = zod_1.z.object({
        occupancyId: zod_1.z.string().uuid(),
        payAtCheckout: zod_1.z.boolean().optional().default(false),
        paymentMethod: zod_1.z.enum(['CREDIT', 'CASH']).optional(),
    });
    /**
     * POST /v1/checkout/manual-complete
     *
     * Staff-only endpoint to complete checkout manually (no checkout_request_id).
     * Must be idempotent using a serializable transaction + visit row lock.
     */
    fastify.post('/v1/checkout/manual-complete', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const staffId = request.staff.staffId;
        let body;
        try {
            body = ManualCompleteSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, db_1.serializableTransaction)(async (client) => {
                const occRes = await client.query(`
            SELECT
              cb.id as occupancy_id,
              cb.visit_id,
              v.customer_id,
              c.name as customer_name,
              cb.starts_at as checkin_at,
              cb.ends_at as scheduled_checkout_at,
              cb.room_id,
              r.number as room_number,
              cb.locker_id,
              l.number as locker_number,
              cb.session_id,
              v.ended_at as visit_ended_at
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            LEFT JOIN rooms r ON cb.room_id = r.id
            LEFT JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.id = $1
            FOR UPDATE OF v
            `, [body.occupancyId]);
                if (occRes.rows.length === 0) {
                    throw { statusCode: 404, message: 'Occupancy not found' };
                }
                const row = occRes.rows[0];
                if (row.visit_ended_at) {
                    return { alreadyCheckedOut: true, row };
                }
                const scheduledCheckoutAt = row.scheduled_checkout_at instanceof Date
                    ? row.scheduled_checkout_at
                    : new Date(row.scheduled_checkout_at);
                const lateMinutes = Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)));
                const { feeAmount, banApplied } = (0, utils_1.calculateLateFee)(lateMinutes);
                // Cancel active waitlist entries for this visit (system cancel on checkout)
                const waitlistResult = await client.query(`SELECT id, status
             FROM waitlist
             WHERE visit_id = $1 AND status IN ('ACTIVE','OFFERED')
             FOR UPDATE`, [row.visit_id]);
                if (waitlistResult.rows.length > 0) {
                    const waitlistIds = waitlistResult.rows.map((r) => r.id);
                    await client.query(`UPDATE waitlist
               SET status = 'CANCELLED',
                   cancelled_at = NOW(),
                   cancelled_by_staff_id = NULL,
                   updated_at = NOW()
               WHERE id = ANY($1::uuid[])`, [waitlistIds]);
                    const auditStaffId = (0, utils_1.looksLikeUuid)(staffId) ? staffId : null;
                    for (const wl of waitlistResult.rows) {
                        await (0, auditLog_1.insertAuditLog)(client, {
                            staffId: auditStaffId,
                            action: 'WAITLIST_CANCELLED',
                            entityType: 'waitlist',
                            entityId: wl.id,
                            oldValue: { status: wl.status },
                            newValue: { status: 'CANCELLED', reason: 'CHECKED_OUT' },
                        });
                    }
                }
                // Update room to DIRTY or locker to CLEAN and unassign
                if (row.room_id) {
                    await client.query(`UPDATE rooms SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [shared_1.RoomStatus.DIRTY, row.room_id]);
                }
                if (row.locker_id) {
                    await client.query(`UPDATE lockers SET status = $1, assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $2`, [shared_1.RoomStatus.CLEAN, row.locker_id]);
                }
                // End the visit
                await client.query(`UPDATE visits SET ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.visit_id]);
                // Ban is applied immediately for severe late checkouts (90+ minutes) and must be
                // reviewed by a manager to confirm or lift/adjust.
                if (banApplied) {
                    await client.query(`UPDATE customers
               SET banned_until = GREATEST(COALESCE(banned_until, NOW()), NOW() + INTERVAL '30 days'),
                   updated_at = NOW()
               WHERE id = $1`, [row.customer_id]);
                    // Create a manager alert to review the ban.
                    await client.query(`
              INSERT INTO late_checkout_ban_alerts
                (customer_id, checkout_request_id, occupancy_id, visit_id,
                 late_minutes, fee_amount_cents, recommended_ban_days,
                 status, created_by_staff_id, created_by_staff_name)
              VALUES
                ($1, NULL, $2, $3, $4, $5, 30, 'PENDING', $6, $7)
              ON CONFLICT (occupancy_id) WHERE checkout_request_id IS NULL DO NOTHING
              `, [
                        row.customer_id,
                        row.occupancy_id,
                        row.visit_id,
                        lateMinutes,
                        feeAmount,
                        staffId,
                        request.staff.name,
                    ]);
                }
                // Update past due balance + itemized charge if fee > 0
                if (feeAmount > 0) {
                    if (body.payAtCheckout) {
                        // Fee settled at checkout — record payment_intent, do NOT add to past_due_balance
                        const paymentIntent = await client.query(`INSERT INTO payment_intents
                 (amount, status, quote_json, payment_method, paid_at, paid_by_staff_id)
                 VALUES ($1, 'PAID', $2, $3, NOW(), $4)
                 RETURNING id`, [
                            feeAmount,
                            JSON.stringify({ type: 'LATE_FEE', total: feeAmount }),
                            body.paymentMethod ?? null,
                            staffId,
                        ]);
                        const paymentIntentId = paymentIntent.rows[0].id;
                        // Record as an itemized charge tied to the visit/block (idempotent per occupancy).
                        const existingLate = await client.query(`SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`, [row.occupancy_id]);
                        if (existingLate.rows.length === 0) {
                            await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
                   VALUES ($1, $2, 'LATE_FEE', $3, $4)`, [row.visit_id, row.occupancy_id, feeAmount, paymentIntentId]);
                        }
                    }
                    else {
                        // Fee NOT settled — add to past_due_balance (must pay before next check-in)
                        await client.query(`UPDATE customers
                 SET past_due_balance = past_due_balance + $1,
                     updated_at = NOW()
                 WHERE id = $2`, [feeAmount, row.customer_id]);
                        // Record as an itemized charge tied to the visit/block (idempotent per occupancy).
                        const existingLate = await client.query(`SELECT id FROM charges WHERE checkin_block_id = $1 AND type = 'LATE_FEE' LIMIT 1`, [row.occupancy_id]);
                        if (existingLate.rows.length === 0) {
                            await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
                   VALUES ($1, $2, 'LATE_FEE', $3, NULL)`, [row.visit_id, row.occupancy_id, feeAmount]);
                        }
                    }
                }
                // Log late checkout event if late >= 30 minutes
                if (lateMinutes >= 30) {
                    await client.query(`INSERT INTO late_checkout_events (customer_id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied)
               VALUES ($1, $2, NULL, $3, $4, $5)`, [row.customer_id, row.occupancy_id, lateMinutes, feeAmount, banApplied]);
                }
                // Emit unified club event for analytics
                await (0, clubEventLog_1.insertClubEvent)(client, {
                    eventType: 'CHECKOUT_COMPLETED',
                    eventDomain: 'CHECKOUT',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    staffId: (0, utils_1.looksLikeUuid)(staffId) ? staffId : null,
                    staffName: request.staff.name,
                    customerId: row.customer_id,
                    customerName: row.customer_name,
                    visitId: row.visit_id,
                    summary: `Manual checkout completed — ${row.customer_name}`,
                    metadata: {
                        occupancyId: row.occupancy_id,
                        visitId: row.visit_id,
                        roomId: row.room_id,
                        lockerId: row.locker_id,
                        lateMinutes,
                        feeAmount,
                        banApplied,
                    },
                    dedupeKey: `CLUB:CHECKOUT_COMPLETED:MANUAL:${row.occupancy_id}`,
                });
                return {
                    alreadyCheckedOut: false,
                    row,
                    lateMinutes,
                    feeAmount,
                    banApplied,
                    cancelledWaitlistIds: waitlistResult.rows.map((r) => r.id),
                    visitId: row.visit_id,
                };
            });
            const row = 'row' in result ? result.row : result.row;
            const alreadyCheckedOut = result.alreadyCheckedOut === true;
            const resourceType = row.locker_id ? 'LOCKER' : 'ROOM';
            const number = resourceType === 'LOCKER' ? row.locker_number : row.room_number;
            const scheduledCheckoutAt = row.scheduled_checkout_at instanceof Date
                ? row.scheduled_checkout_at
                : new Date(row.scheduled_checkout_at);
            if (!number)
                return reply.status(500).send({ error: 'Resource not found for occupancy' });
            // Broadcast inventory updates (same event types as existing checkout completion)
            if (fastify.broadcaster && !alreadyCheckedOut) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
                if (row.room_id) {
                    fastify.broadcaster.broadcastRoomStatusChanged({
                        roomId: row.room_id,
                        previousStatus: shared_1.RoomStatus.CLEAN,
                        newStatus: shared_1.RoomStatus.DIRTY,
                        changedBy: staffId,
                        override: false,
                    });
                }
            }
            // Broadcast WAITLIST_UPDATED for system-cancelled waitlist entries (after commit)
            if (fastify.broadcaster &&
                !alreadyCheckedOut &&
                Array.isArray(result.cancelledWaitlistIds) &&
                result.cancelledWaitlistIds.length > 0) {
                for (const waitlistId of result.cancelledWaitlistIds) {
                    fastify.broadcaster.broadcast({
                        type: 'WAITLIST_UPDATED',
                        payload: {
                            waitlistId,
                            status: 'CANCELLED',
                            visitId: result.visitId,
                        },
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            const lateMinutes = alreadyCheckedOut && typeof result.lateMinutes !== 'number'
                ? Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60)))
                : (result.lateMinutes ??
                    Math.max(0, Math.floor((Date.now() - scheduledCheckoutAt.getTime()) / (1000 * 60))));
            const fee = result.feeAmount ?? (0, utils_1.calculateLateFee)(lateMinutes).feeAmount;
            const banApplied = result.banApplied ?? (0, utils_1.calculateLateFee)(lateMinutes).banApplied;
            return reply.send({
                occupancyId: row.occupancy_id,
                resourceType,
                number,
                customerName: row.customer_name,
                checkinAt: row.checkin_at,
                scheduledCheckoutAt,
                lateMinutes,
                fee,
                banApplied,
                alreadyCheckedOut,
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            // Ensure CI logs include the underlying exception even if fastify/pino output is filtered.
            // eslint-disable-next-line no-console
            console.error('Failed to complete manual checkout', error);
            fastify.log.error({
                err: error,
                staffId: request.staff?.staffId,
                occupancyId: request.body?.occupancyId,
            }, 'Failed to complete manual checkout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
