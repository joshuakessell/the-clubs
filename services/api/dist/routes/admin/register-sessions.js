"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminRegisterSessionRoutes = registerAdminRegisterSessionRoutes;
const db_1 = require("../../db");
const middleware_1 = require("../../auth/middleware");
const auditLog_1 = require("../../audit/auditLog");
function registerAdminRegisterSessionRoutes(fastify) {
    /**
     * GET /v1/admin/register-sessions
     *
     * Returns array with exactly three entries (Register 1-3).
     * Shows current status, employee info, device, and heartbeat data.
     */
    fastify.get('/v1/admin/register-sessions', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            // Get active sessions for all registers
            const activeSessions = await (0, db_1.query)(`SELECT 
          rs.id,
          rs.employee_id,
          rs.device_id,
          rs.register_number,
          rs.created_at,
          rs.last_heartbeat,
          s.name as employee_name,
          s.role as employee_role
        FROM register_sessions rs
        JOIN staff s ON s.id = rs.employee_id
        WHERE rs.signed_out_at IS NULL
        ORDER BY rs.register_number`);
            // Build result array with exactly 3 entries
            const result = [];
            for (let regNum = 1; regNum <= 3; regNum++) {
                const session = activeSessions.rows.find((s) => s.register_number === regNum);
                if (session) {
                    const now = new Date();
                    const heartbeatTime = new Date(session.last_heartbeat);
                    const secondsSinceHeartbeat = Math.floor((now.getTime() - heartbeatTime.getTime()) / 1000);
                    result.push({
                        registerNumber: regNum,
                        active: true,
                        sessionId: session.id,
                        employee: {
                            id: session.employee_id,
                            displayName: session.employee_name,
                            role: session.employee_role,
                        },
                        deviceId: session.device_id,
                        createdAt: session.created_at.toISOString(),
                        lastHeartbeatAt: session.last_heartbeat.toISOString(),
                        secondsSinceHeartbeat,
                    });
                }
                else {
                    result.push({
                        registerNumber: regNum,
                        active: false,
                        sessionId: null,
                        employee: null,
                        deviceId: null,
                        createdAt: null,
                        lastHeartbeatAt: null,
                        secondsSinceHeartbeat: null,
                    });
                }
            }
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch register sessions');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/register-sessions/:registerNumber/force-signout
     *
     * Forces sign-out of active session for specified register.
     * Broadcasts REGISTER_SESSION_UPDATED event.
     */
    fastify.post('/v1/admin/register-sessions/:registerNumber/force-signout', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        const registerNumber = parseInt(request.params.registerNumber, 10);
        if (registerNumber !== 1 && registerNumber !== 2 && registerNumber !== 3) {
            return reply.status(400).send({
                error: 'Invalid register number',
                message: 'Register number must be 1, 2, or 3',
            });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Find active session for this register
                const sessionResult = await client.query(`SELECT 
            rs.id,
            rs.employee_id,
            rs.device_id,
            rs.created_at,
            rs.last_heartbeat,
            s.name as employee_name,
            s.role as employee_role
          FROM register_sessions rs
          JOIN staff s ON s.id = rs.employee_id
          WHERE rs.register_number = $1
          AND rs.signed_out_at IS NULL`, [registerNumber]);
                if (sessionResult.rows.length === 0) {
                    return {
                        ok: true,
                        message: 'already signed out',
                        register: {
                            registerNumber: registerNumber,
                            active: false,
                            sessionId: null,
                            employee: null,
                            deviceId: null,
                            createdAt: null,
                            lastHeartbeatAt: null,
                        },
                    };
                }
                const session = sessionResult.rows[0];
                // Sign out
                await client.query(`UPDATE register_sessions
           SET signed_out_at = NOW()
           WHERE id = $1`, [session.id]);
                // Log audit action
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: request.staff.staffId,
                    action: 'REGISTER_FORCE_SIGN_OUT',
                    entityType: 'register_session',
                    entityId: session.id,
                });
                // Broadcast REGISTER_SESSION_UPDATED event
                const payload = {
                    registerNumber: registerNumber,
                    active: false,
                    sessionId: null,
                    employee: null,
                    deviceId: null,
                    createdAt: null,
                    lastHeartbeatAt: null,
                    reason: 'FORCED_SIGN_OUT',
                };
                fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
                return {
                    ok: true,
                    register: {
                        registerNumber: registerNumber,
                        active: false,
                        sessionId: null,
                        employee: null,
                        deviceId: null,
                        createdAt: null,
                        lastHeartbeatAt: null,
                    },
                };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to force sign out register session');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
