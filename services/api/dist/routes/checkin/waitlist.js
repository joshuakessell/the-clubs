"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinWaitlistRoutes = registerCheckinWaitlistRoutes;
const middleware_1 = require("../../auth/middleware");
const payload_1 = require("../../checkin/payload");
const sessionHelpers_1 = require("../../checkin/sessionHelpers");
const utils_1 = require("../../checkin/utils");
const waitlist_1 = require("../../checkin/waitlist");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const auditLog_1 = require("../../audit/auditLog");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by session helpers, audit log, and waitlist helpers.
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
function registerCheckinWaitlistRoutes(fastify) {
    /**
     * GET /v1/checkin/lane/:laneId/waitlist-info — Waitlist position, ETA, and upgrade fee.
     */
    fastify.get('/v1/checkin/lane/:laneId/waitlist-info', { preHandler: [middleware_1.optionalAuth] }, async (request, reply) => {
        const { laneId } = request.params;
        const { desiredTier, currentTier } = request.query;
        if (!desiredTier) {
            return reply.status(400).send({ error: 'desiredTier query parameter is required' });
        }
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const qClient = toQueryable(tx);
                // Validate there's an active session
                await (0, sessionHelpers_1.resolveActiveSession)(qClient, laneId, {
                    statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT'`,
                });
                const { position, estimatedReadyAt } = await (0, waitlist_1.computeWaitlistInfo)(qClient, desiredTier);
                let upgradeFee = null;
                if (currentTier) {
                    const { getUpgradeFee } = await Promise.resolve().then(() => __importStar(require('../../pricing/engine')));
                    upgradeFee = getUpgradeFee(currentTier, desiredTier) || null;
                }
                return { position, estimatedReadyAt: estimatedReadyAt ? estimatedReadyAt.toISOString() : null, upgradeFee };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to get waitlist info');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to get waitlist info' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get waitlist info' });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/assign — Assign a room or locker to the lane session.
     * Uses transactional locking to prevent double-booking.
     */
    fastify.post('/v1/checkin/lane/:laneId/assign', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const staffId = request.staff.staffId;
        const { laneId } = request.params;
        const { resourceType, resourceId } = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const qClient = toQueryable(tx);
                // Get active session
                const session = await (0, sessionHelpers_1.resolveActiveSession)(qClient, laneId, {
                    statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE'`,
                });
                // Validate and lock the resource (room or locker)
                const { resourceRow } = await (0, sessionHelpers_1.validateAndLockResource)(qClient, {
                    resourceType,
                    resourceId,
                    sessionId: session.id,
                });
                // Tier check for rooms (cross-type assignment detection)
                let needsConfirmation = false;
                let roomTier;
                if (resourceType === 'room') {
                    roomTier = (0, waitlist_1.getRoomTier)(resourceRow.number);
                    const desiredType = session.desired_rental_type || session.backup_rental_type;
                    needsConfirmation = !!(desiredType && roomTier !== desiredType);
                }
                // Record selection on session
                await (0, sessionHelpers_1.recordResourceSelection)(qClient, { sessionId: session.id, resourceType, resourceId });
                // Audit log
                await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                    staffId,
                    action: 'ASSIGN',
                    entityType: resourceType,
                    entityId: resourceId,
                    oldValue: { assigned_to_customer_id: null },
                    newValue: { selected_for_session_id: session.id },
                });
                // Broadcast assignment created
                const assignmentPayload = {
                    sessionId: session.id,
                    resourceId,
                    resourceNumber: resourceRow.number,
                    rentalType: resourceType === 'locker' ? 'LOCKER' : roomTier,
                };
                fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);
                // Cross-type assignment → require customer confirmation
                if (needsConfirmation && resourceType === 'room') {
                    const desiredType = session.desired_rental_type || session.backup_rental_type;
                    if (desiredType) {
                        const confirmationPayload = {
                            sessionId: session.id,
                            requestedType: desiredType,
                            selectedType: roomTier,
                            selectedNumber: resourceRow.number,
                        };
                        fastify.broadcaster.broadcastCustomerConfirmationRequired(confirmationPayload, laneId);
                    }
                }
                return {
                    sessionId: session.id,
                    success: true,
                    resourceType,
                    resourceId,
                    ...(resourceType === 'room'
                        ? { roomNumber: resourceRow.number, needsConfirmation }
                        : { lockerNumber: resourceRow.number }),
                };
            }, { isolationLevel: 'serializable' });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to assign resource');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                // Race condition → broadcast assignment failure
                if (httpErr.statusCode === 409) {
                    try {
                        const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`);
                        if (sessionResult.rows.length > 0) {
                            const failedPayload = {
                                sessionId: sessionResult.rows[0].id,
                                reason: httpErr.message ?? 'Resource already assigned',
                                requestedResourceId: resourceId,
                            };
                            fastify.broadcaster.broadcastAssignmentFailed(failedPayload, laneId);
                        }
                    }
                    catch { /* ignore broadcast errors */ }
                }
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to assign resource',
                    raceLost: httpErr.statusCode === 409,
                });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to assign resource' });
        }
    });
}
