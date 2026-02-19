"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminDeviceRoutes = registerAdminDeviceRoutes;
const db_1 = require("../../db");
const middleware_1 = require("../../auth/middleware");
const auditLog_1 = require("../../audit/auditLog");
function registerAdminDeviceRoutes(fastify) {
    /**
     * GET /v1/admin/devices
     *
     * Returns all devices (enabled and disabled).
     */
    fastify.get('/v1/admin/devices', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            const result = await (0, db_1.query)(`SELECT device_id, display_name, enabled
         FROM devices
         ORDER BY created_at DESC`);
            return reply.send(result.rows.map((row) => ({
                deviceId: row.device_id,
                displayName: row.display_name,
                enabled: row.enabled,
            })));
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch devices');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/devices
     *
     * Adds a new device.
     * Rejects if 2 enabled devices already exist.
     */
    fastify.post('/v1/admin/devices', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        const { deviceId, displayName } = request.body;
        if (!deviceId || !displayName) {
            return reply.status(400).send({
                error: 'Validation failed',
                message: 'deviceId and displayName are required',
            });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Check if device already exists
                const existing = await client.query(`SELECT device_id FROM devices WHERE device_id = $1`, [deviceId]);
                if (existing.rows.length > 0) {
                    throw new Error('Device already exists');
                }
                // Insert new device (enabled by default)
                await client.query(`INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`, [deviceId, displayName]);
                return {
                    deviceId,
                    displayName,
                    enabled: true,
                };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to add device');
            const message = error instanceof Error ? error.message : 'Failed to add device';
            return reply.status(400).send({
                error: 'Failed to add device',
                message,
            });
        }
    });
    /**
     * PATCH /v1/admin/devices/:deviceId
     *
     * Enables or disables a device.
     * If disabling an active device, force sign out its register session.
     */
    fastify.patch('/v1/admin/devices/:deviceId', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        const { deviceId } = request.params;
        const { enabled } = request.body;
        if (typeof enabled !== 'boolean') {
            return reply.status(400).send({
                error: 'Validation failed',
                message: 'enabled must be a boolean',
            });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Check if device exists
                const deviceResult = await client.query(`SELECT device_id, enabled FROM devices WHERE device_id = $1`, [deviceId]);
                if (deviceResult.rows.length === 0) {
                    throw new Error('Device not found');
                }
                // Devices may be auto-registered by register clients; admins can disable as needed.
                // If disabling, check for active register session and force sign out
                if (!enabled) {
                    const activeSession = await client.query(`SELECT id, register_number
             FROM register_sessions
             WHERE device_id = $1
             AND signed_out_at IS NULL`, [deviceId]);
                    if (activeSession.rows.length > 0) {
                        const session = activeSession.rows[0];
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
                // Update device
                await client.query(`UPDATE devices SET enabled = $1 WHERE device_id = $2`, [
                    enabled,
                    deviceId,
                ]);
                return {
                    deviceId,
                    enabled,
                };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to update device');
            const message = error instanceof Error ? error.message : 'Failed to update device';
            return reply.status(400).send({
                error: 'Failed to update device',
                message,
            });
        }
    });
}
