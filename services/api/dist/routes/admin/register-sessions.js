"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminRegisterSessionRoutes = registerAdminRegisterSessionRoutes;
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../../auth/middleware");
const auditLog_1 = require("../../audit/auditLog");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const parts = queryText.split(/\$\d+/);
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            for (let i = 0; i < parts.length; i++) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
                if (i < values.length) {
                    built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
                }
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
function registerAdminRegisterSessionRoutes(fastify) {
    fastify.get('/v1/admin/register-sessions', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const activeSessions = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT 
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
    fastify.post('/v1/admin/register-sessions/:registerNumber/force-signout', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const registerNumber = Number.parseInt(request.params.registerNumber, 10);
        if (registerNumber !== 1 && registerNumber !== 2 && registerNumber !== 3) {
            return reply.status(400).send({
                error: 'Invalid register number',
                message: 'Register number must be 1, 2, or 3',
            });
        }
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT 
            rs.id,
            rs.employee_id,
            rs.device_id,
            rs.created_at,
            rs.last_heartbeat,
            s.name as employee_name,
            s.role as employee_role
          FROM register_sessions rs
          JOIN staff s ON s.id = rs.employee_id
          WHERE rs.register_number = ${registerNumber}
          AND rs.signed_out_at IS NULL`);
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
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions
           SET signed_out_at = NOW()
           WHERE id = ${session.id}`);
                await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                    staffId: request.staff.staffId,
                    action: 'REGISTER_FORCE_SIGN_OUT',
                    entityType: 'register_session',
                    entityId: session.id,
                });
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
