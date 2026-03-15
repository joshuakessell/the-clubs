"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKioskHeartbeatRoutes = registerKioskHeartbeatRoutes;
const kioskToken_1 = require("../../auth/kioskToken");
const middleware_1 = require("../../auth/middleware");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Kiosk heartbeat routes.
 *
 * The customer kiosk sends a heartbeat every 30 seconds so the server
 * can track which kiosk devices are online and which lane they serve.
 */
function registerKioskHeartbeatRoutes(fastify) {
    fastify.post('/v1/kiosk/heartbeat', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { deviceId, laneId } = request.body ?? {};
        if (!deviceId || !laneId) {
            return reply.status(400).send({ error: 'deviceId and laneId are required' });
        }
        try {
            await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO devices (device_id, display_name, enabled, last_heartbeat, last_lane_id)
           VALUES (${deviceId}, ${'Kiosk ' + laneId}, true, NOW(), ${laneId})
           ON CONFLICT (device_id) DO UPDATE
             SET last_heartbeat = NOW(),
                 last_lane_id = EXCLUDED.last_lane_id,
                 enabled = true`);
            return reply.send({ ok: true });
        }
        catch (error) {
            request.log.error(error, 'Kiosk heartbeat failed');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/kiosks/status', {
        preHandler: [middleware_1.optionalAuth],
    }, async (_request, reply) => {
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT device_id, display_name, enabled, last_heartbeat, last_lane_id, created_at
           FROM devices
           WHERE last_heartbeat IS NOT NULL
           ORDER BY last_heartbeat DESC`);
            const now = Date.now();
            const ONLINE_THRESHOLD_MS = 90_000;
            return reply.send({
                kiosks: result.rows.map((d) => {
                    const lastHeartbeat = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
                    const isOnline = now - lastHeartbeat < ONLINE_THRESHOLD_MS;
                    return {
                        deviceId: d.device_id,
                        displayName: d.display_name,
                        enabled: d.enabled,
                        laneId: d.last_lane_id,
                        lastHeartbeatAt: d.last_heartbeat ? new Date(d.last_heartbeat).toISOString() : null,
                        secondsSinceHeartbeat: d.last_heartbeat
                            ? Math.floor((now - lastHeartbeat) / 1000)
                            : null,
                        isOnline,
                        createdAt: d.created_at.toISOString(),
                    };
                }),
            });
        }
        catch (error) {
            _request.log.error(error, 'Failed to fetch kiosk status');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
