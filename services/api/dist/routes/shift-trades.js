"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftTradeRoutes = shiftTradeRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const auditLog_1 = require("../audit/auditLog");
const CreateShiftTradeSchema = zod_1.z.object({
    requesterShiftId: zod_1.z.string().uuid(),
    targetShiftId: zod_1.z.string().uuid(),
});
const AdminDecisionSchema = zod_1.z.object({
    status: zod_1.z.enum(['APPROVED', 'DENIED']),
    decisionNotes: zod_1.z.string().max(2000).optional(),
});
function mapTradeRow(r) {
    return {
        id: r.id,
        requesterId: r.requester_id,
        requesterName: r.requester_name,
        requesterShiftId: r.requester_shift_id,
        targetId: r.target_id,
        targetName: r.target_name,
        targetShiftId: r.target_shift_id,
        status: r.status,
        decidedBy: r.decided_by,
        decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
        decisionNotes: r.decision_notes,
        createdAt: r.created_at.toISOString(),
    };
}
async function shiftTradeRoutes(fastify) {
    // ── Staff endpoints ─────────────────────────────────────────────
    /**
     * GET /v1/schedule/shift-trade-requests
     * Returns trades where the current user is requester or target.
     */
    fastify.get('/v1/schedule/shift-trade-requests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const staffId = request.staff.staffId;
        const from = request.query.from;
        const to = request.query.to;
        const params = [staffId];
        let i = 1;
        let sql = `
        SELECT
          t.*,
          sr.name AS requester_name,
          st.name AS target_name
        FROM shift_trade_requests t
        JOIN staff sr ON sr.id = t.requester_id
        JOIN staff st ON st.id = t.target_id
        JOIN employee_shifts es ON es.id = t.requester_shift_id
        WHERE (t.requester_id = $1 OR t.target_id = $1)
      `;
        if (from) {
            i++;
            sql += ` AND es.starts_at >= $${i}::timestamptz`;
            params.push(from);
        }
        if (to) {
            i++;
            sql += ` AND es.starts_at < $${i}::timestamptz`;
            params.push(to);
        }
        sql += ` ORDER BY t.created_at DESC`;
        const rows = await (0, db_1.query)(sql, params);
        return reply.send({ trades: rows.rows.map(mapTradeRow) });
    });
    /**
     * POST /v1/schedule/shift-trade-requests
     * Staff requests a shift trade with another employee.
     */
    fastify.post('/v1/schedule/shift-trade-requests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const body = CreateShiftTradeSchema.parse(request.body);
        const staffId = request.staff.staffId;
        try {
            const id = await (0, db_1.transaction)(async (client) => {
                // Verify requester owns the requester shift
                const reqShift = await client.query(`SELECT employee_id FROM employee_shifts WHERE id = $1 AND status <> 'CANCELED'`, [body.requesterShiftId]);
                if (reqShift.rows.length === 0 || reqShift.rows[0].employee_id !== staffId) {
                    throw { statusCode: 403, message: 'You do not own the requester shift.' };
                }
                // Verify target shift exists and belongs to someone else
                const tgtShift = await client.query(`SELECT employee_id FROM employee_shifts WHERE id = $1 AND status <> 'CANCELED'`, [body.targetShiftId]);
                if (tgtShift.rows.length === 0) {
                    throw { statusCode: 404, message: 'Target shift not found.' };
                }
                const targetId = tgtShift.rows[0].employee_id;
                if (targetId === staffId) {
                    throw { statusCode: 400, message: 'Cannot trade with yourself.' };
                }
                const res = await client.query(`INSERT INTO shift_trade_requests (requester_id, requester_shift_id, target_id, target_shift_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id`, [staffId, body.requesterShiftId, targetId, body.targetShiftId]);
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId,
                    userId: staffId,
                    userRole: request.staff.role,
                    action: 'CREATE',
                    entityType: 'shift_trade_request',
                    entityId: res.rows[0].id,
                    newValue: {
                        requesterShiftId: body.requesterShiftId,
                        targetShiftId: body.targetShiftId,
                        targetId,
                    },
                });
                return res.rows[0].id;
            });
            return reply.status(201).send({ id });
        }
        catch (err) {
            if (err?.statusCode) {
                return reply.status(err.statusCode).send({ error: err.message });
            }
            if (err?.code === '23505') {
                return reply.status(409).send({ error: 'A trade request already exists for these shifts.' });
            }
            request.log.error(err, 'Failed to create shift trade request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // ── Admin endpoints ─────────────────────────────────────────────
    /**
     * GET /v1/admin/shift-trade-requests
     * Admin views all pending (or filtered) trade requests.
     */
    fastify.get('/v1/admin/shift-trade-requests', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const status = request.query.status
            ? zod_1.z.enum(['PENDING', 'APPROVED', 'DENIED']).parse(request.query.status)
            : undefined;
        const params = [];
        let i = 0;
        let sql = `
        SELECT
          t.*,
          sr.name AS requester_name,
          st.name AS target_name
        FROM shift_trade_requests t
        JOIN staff sr ON sr.id = t.requester_id
        JOIN staff st ON st.id = t.target_id
        WHERE 1=1
      `;
        if (status) {
            i++;
            sql += ` AND t.status = $${i}`;
            params.push(status);
        }
        sql += ` ORDER BY t.created_at DESC`;
        const rows = await (0, db_1.query)(sql, params);
        return reply.send({ trades: rows.rows.map(mapTradeRow) });
    });
    /**
     * PATCH /v1/admin/shift-trade-requests/:id
     * Admin approves or denies a trade. On APPROVED, swaps the employee_id on both shifts.
     */
    fastify.patch('/v1/admin/shift-trade-requests/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { id } = request.params;
        const body = AdminDecisionSchema.parse(request.body);
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const current = await client.query(`SELECT status, requester_id, requester_shift_id, target_id, target_shift_id
             FROM shift_trade_requests WHERE id = $1 FOR UPDATE`, [id]);
                if (current.rows.length === 0)
                    return null;
                const trade = current.rows[0];
                if (trade.status !== 'PENDING') {
                    throw { statusCode: 409, message: `Trade already ${trade.status.toLowerCase()}.` };
                }
                // Update the trade request
                await client.query(`UPDATE shift_trade_requests
             SET status = $1, decided_by = $2, decided_at = NOW(), decision_notes = $3, updated_at = NOW()
             WHERE id = $4`, [body.status, request.staff.staffId, body.decisionNotes ?? null, id]);
                // On approval, swap the employee_id on both shifts
                if (body.status === 'APPROVED') {
                    await client.query(`UPDATE employee_shifts SET employee_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [trade.target_id, request.staff.staffId, trade.requester_shift_id]);
                    await client.query(`UPDATE employee_shifts SET employee_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [trade.requester_id, request.staff.staffId, trade.target_shift_id]);
                }
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: request.staff.staffId,
                    userId: request.staff.staffId,
                    userRole: request.staff.role,
                    action: body.status === 'APPROVED' ? 'UPDATE' : 'UPDATE',
                    entityType: 'shift_trade_request',
                    entityId: id,
                    newValue: { status: body.status, decisionNotes: body.decisionNotes ?? null },
                });
                return trade;
            });
            if (!result) {
                return reply.status(404).send({ error: 'Not found' });
            }
            return reply.send({ success: true });
        }
        catch (err) {
            if (err?.statusCode) {
                return reply.status(err.statusCode).send({ error: err.message });
            }
            request.log.error(err, 'Failed to decide shift trade request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
