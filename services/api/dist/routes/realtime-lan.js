"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeLanRoutes = realtimeLanRoutes;
const kioskToken_1 = require("../auth/kioskToken");
const middleware_1 = require("../auth/middleware");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const laneFeatureFlags_1 = require("../checkin/laneFeatureFlags");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by getLaneFeatureFlags.
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
function isLanFallbackEnabled() {
    return process.env.LAN_FALLBACK === 'true';
}
async function isLanFallbackEnabledForLane(laneId) {
    try {
        const flags = await db_1.db.transaction(async (tx) => (0, laneFeatureFlags_1.getLaneFeatureFlags)(toQueryable(tx), laneId));
        return flags.lanFallbackEnabled;
    }
    catch {
        return false;
    }
}
async function realtimeLanRoutes(fastify) {
    if (!isLanFallbackEnabled()) {
        return;
    }
    if (!fastify.websocketServer) {
        throw new Error('LAN realtime websocket routes require @fastify/websocket to be registered');
    }
    fastify.get('/v1/realtime/lan/lane/:laneId', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
        websocket: true,
    }, async (connection, request) => {
        const laneId = request.params.laneId;
        const socket = connection.socket;
        if (!(await isLanFallbackEnabledForLane(laneId))) {
            socket.close();
            return;
        }
        const sockets = fastify.localLaneSockets;
        if (!sockets) {
            socket.close();
            return;
        }
        sockets.add(laneId, socket);
        socket.on('error', (error) => {
            request.log.error({ error }, 'LAN realtime socket error');
        });
        socket.send(JSON.stringify({
            type: 'LAN_SOCKET_READY',
            payload: { laneId },
            timestamp: new Date().toISOString(),
        }));
    });
}
