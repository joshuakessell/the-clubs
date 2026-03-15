"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminDeviceRoutes = registerAdminDeviceRoutes;
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
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
function registerAdminDeviceRoutes(fastify) {
    fastify.get('/v1/admin/devices', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT device_id, display_name, enabled, last_heartbeat, last_lane_id, created_at
             FROM devices
             ORDER BY created_at DESC`);
            const now = Date.now();
            const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds without heartbeat = offline
            return reply.send(result.rows.map((row) => {
                const lastHeartbeat = row.last_heartbeat ? new Date(row.last_heartbeat).getTime() : 0;
                const secondsSinceHeartbeat = lastHeartbeat > 0 ? Math.round((now - lastHeartbeat) / 1000) : null;
                const online = lastHeartbeat > 0 && (now - lastHeartbeat) < OFFLINE_THRESHOLD_MS;
                return {
                    deviceId: row.device_id,
                    displayName: row.display_name,
                    enabled: row.enabled,
                    lastHeartbeatAt: lastHeartbeat > 0 ? new Date(lastHeartbeat).toISOString() : null,
                    secondsSinceHeartbeat,
                    online,
                    lastLaneId: row.last_lane_id ?? null,
                };
            }));
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch devices');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/devices', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { deviceId, displayName } = request.body;
        if (!deviceId || !displayName) {
            return reply.status(400).send({
                error: 'Validation failed',
                message: 'deviceId and displayName are required',
            });
        }
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const existing = await tx.execute((0, drizzle_orm_1.sql) `SELECT device_id FROM devices WHERE device_id = ${deviceId}`);
                if (existing.rows.length > 0) {
                    throw new Error('Device already exists');
                }
                await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO devices (device_id, display_name, enabled)
           VALUES (${deviceId}, ${displayName}, true)`);
                return { deviceId, displayName, enabled: true };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to add device');
            const message = error instanceof Error ? error.message : 'Failed to add device';
            return reply.status(400).send({ error: 'Failed to add device', message });
        }
    });
    fastify.patch('/v1/admin/devices/:deviceId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { deviceId } = request.params;
        const { enabled } = request.body;
        if (typeof enabled !== 'boolean') {
            return reply.status(400).send({
                error: 'Validation failed',
                message: 'enabled must be a boolean',
            });
        }
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const deviceResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT device_id, enabled FROM devices WHERE device_id = ${deviceId}`);
                if (deviceResult.rows.length === 0) {
                    throw new Error('Device not found');
                }
                if (!enabled) {
                    const activeSession = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, register_number
                 FROM register_sessions
                 WHERE device_id = ${deviceId}
                 AND signed_out_at IS NULL`);
                    if (activeSession.rows.length > 0) {
                        const session = activeSession.rows[0];
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
                            registerNumber: session.register_number,
                            active: false,
                            sessionId: null,
                            employee: null,
                            deviceId: null,
                            createdAt: null,
                            lastHeartbeatAt: null,
                            reason: 'FORCED_SIGN_OUT',
                        };
                        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
                    }
                }
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE devices SET enabled = ${enabled} WHERE device_id = ${deviceId}`);
                return { deviceId, enabled };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to update device');
            const message = error instanceof Error ? error.message : 'Failed to update device';
            return reply.status(400).send({ error: 'Failed to update device', message });
        }
    });
}
