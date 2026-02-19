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
const utils_1 = require("../../checkin/utils");
const waitlist_1 = require("../../checkin/waitlist");
const db_1 = require("../../db");
const auditLog_1 = require("../../audit/auditLog");
function registerCheckinWaitlistRoutes(fastify) {
    /**
     * GET /v1/checkin/lane/:laneId/waitlist-info
     *
     * Get waitlist position, ETA, and upgrade fee for a desired tier.
     * Called when customer selects an unavailable rental type.
     * Public endpoint (customer kiosk can call without auth).
     */
    fastify.get('/v1/checkin/lane/:laneId/waitlist-info', {
        preHandler: [middleware_1.optionalAuth],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { desiredTier, currentTier } = request.query;
        if (!desiredTier) {
            return reply.status(400).send({ error: 'desiredTier query parameter is required' });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const { position, estimatedReadyAt } = await (0, waitlist_1.computeWaitlistInfo)(client, desiredTier);
                // Compute upgrade fee if currentTier is provided
                let upgradeFee = null;
                if (currentTier) {
                    const { getUpgradeFee } = await Promise.resolve().then(() => __importStar(require('../../pricing/engine')));
                    upgradeFee = getUpgradeFee(currentTier, desiredTier) || null;
                }
                return {
                    position,
                    estimatedReadyAt: estimatedReadyAt ? estimatedReadyAt.toISOString() : null,
                    upgradeFee,
                };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to get waitlist info');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to get waitlist info',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to get waitlist info',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/assign
     *
     * Assign a resource (room or locker) to the lane session.
     * Uses transactional locking to prevent double-booking.
     */
    fastify.post('/v1/checkin/lane/:laneId/assign', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const staffId = request.staff.staffId;
        const { laneId } = request.params;
        const { resourceType, resourceId } = request.body;
        try {
            const result = await (0, db_1.serializableTransaction)(async (client) => {
                // Get active session
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                // Lock and validate resource availability
                if (resourceType === 'room') {
                    const roomResult = await client.query(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms
             WHERE id = $1 FOR UPDATE`, [resourceId]);
                    if (roomResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'Room not found' };
                    }
                    const room = roomResult.rows[0];
                    if (room.status !== 'CLEAN') {
                        throw {
                            statusCode: 400,
                            message: `Room ${room.number} is not available (status: ${room.status})`,
                        };
                    }
                    if (room.assigned_to_customer_id) {
                        throw {
                            statusCode: 409,
                            message: `Room ${room.number} is already assigned (race condition)`,
                        };
                    }
                    // Also prevent "double selection" across lane sessions (we only persist the selection on lane_sessions
                    // until agreement signing completes; treat that selection as a reservation).
                    const selectedByOther = await client.query(`SELECT id, lane_id
               FROM lane_sessions
               WHERE id <> $1
                 AND assigned_resource_type = 'room'
                 AND assigned_resource_id = $2
                 AND status = ANY (
                   ARRAY[
                     'ACTIVE'::public.lane_session_status,
                     'AWAITING_CUSTOMER'::public.lane_session_status,
                     'AWAITING_ASSIGNMENT'::public.lane_session_status,
                     'AWAITING_PAYMENT'::public.lane_session_status,
                     'AWAITING_SIGNATURE'::public.lane_session_status
                   ]
                 )
               LIMIT 1`, [session.id, resourceId]);
                    if (selectedByOther.rows.length > 0) {
                        throw {
                            statusCode: 409,
                            message: `Room ${room.number} is already selected by another lane session (race condition)`,
                        };
                    }
                    // Verify tier matches desired rental type
                    const roomTier = (0, waitlist_1.getRoomTier)(room.number);
                    const desiredType = session.desired_rental_type || session.backup_rental_type;
                    const needsConfirmation = desiredType && roomTier !== desiredType;
                    // Record selected resource on session (actual inventory assignment happens after agreement signing)
                    await client.query(`UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'room',
                 updated_at = NOW()
             WHERE id = $2`, [resourceId, session.id]);
                    // Log audit
                    await (0, auditLog_1.insertAuditLog)(client, {
                        staffId,
                        action: 'ASSIGN',
                        entityType: 'room',
                        entityId: resourceId,
                        oldValue: { assigned_to_customer_id: null },
                        newValue: { selected_for_session_id: session.id },
                    });
                    // Broadcast assignment created
                    const assignmentPayload = {
                        sessionId: session.id,
                        roomId: resourceId,
                        roomNumber: room.number,
                        rentalType: roomTier,
                    };
                    fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);
                    // If cross-type assignment, require customer confirmation
                    if (needsConfirmation && desiredType) {
                        const confirmationPayload = {
                            sessionId: session.id,
                            requestedType: desiredType,
                            selectedType: roomTier,
                            selectedNumber: room.number,
                        };
                        fastify.broadcaster.broadcastCustomerConfirmationRequired(confirmationPayload, laneId);
                    }
                    return {
                        sessionId: session.id,
                        success: true,
                        resourceType: 'room',
                        resourceId,
                        roomNumber: room.number,
                        needsConfirmation,
                    };
                }
                else {
                    // Locker assignment
                    const lockerResult = await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers
             WHERE id = $1 FOR UPDATE`, [resourceId]);
                    if (lockerResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'Locker not found' };
                    }
                    const locker = lockerResult.rows[0];
                    if (locker.assigned_to_customer_id) {
                        throw {
                            statusCode: 409,
                            message: `Locker ${locker.number} is already assigned (race condition)`,
                        };
                    }
                    // Prevent "double selection" across lane sessions (treat lane_sessions selection as reservation).
                    const selectedByOther = await client.query(`SELECT id, lane_id
               FROM lane_sessions
               WHERE id <> $1
                 AND assigned_resource_type = 'locker'
                 AND assigned_resource_id = $2
                 AND status = ANY (
                   ARRAY[
                     'ACTIVE'::public.lane_session_status,
                     'AWAITING_CUSTOMER'::public.lane_session_status,
                     'AWAITING_ASSIGNMENT'::public.lane_session_status,
                     'AWAITING_PAYMENT'::public.lane_session_status,
                     'AWAITING_SIGNATURE'::public.lane_session_status
                   ]
                 )
               LIMIT 1`, [session.id, resourceId]);
                    if (selectedByOther.rows.length > 0) {
                        throw {
                            statusCode: 409,
                            message: `Locker ${locker.number} is already selected by another lane session (race condition)`,
                        };
                    }
                    // Record selected resource on session (actual inventory assignment happens after agreement signing)
                    await client.query(`UPDATE lane_sessions
             SET assigned_resource_id = $1,
                 assigned_resource_type = 'locker',
                 updated_at = NOW()
             WHERE id = $2`, [resourceId, session.id]);
                    // Log audit
                    await (0, auditLog_1.insertAuditLog)(client, {
                        staffId,
                        action: 'ASSIGN',
                        entityType: 'locker',
                        entityId: resourceId,
                        oldValue: { assigned_to_customer_id: null },
                        newValue: { selected_for_session_id: session.id },
                    });
                    // Broadcast assignment created
                    const assignmentPayload = {
                        sessionId: session.id,
                        lockerId: resourceId,
                        lockerNumber: locker.number,
                        rentalType: 'LOCKER',
                    };
                    fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);
                    return {
                        sessionId: session.id,
                        success: true,
                        resourceType: 'locker',
                        resourceId,
                        lockerNumber: locker.number,
                    };
                }
            });
            // Broadcast full session state (stable payload)
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to assign resource');
            // Broadcast assignment failed if we have session info
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                const statusCode = httpErr.statusCode;
                if (statusCode === 409) {
                    // Race condition - try to get session to broadcast failure
                    try {
                        const sessionResult = await (0, db_1.query)(`SELECT id FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
                        if (sessionResult.rows.length > 0) {
                            const failedPayload = {
                                sessionId: sessionResult.rows[0].id,
                                reason: httpErr.message ?? 'Resource already assigned',
                                requestedRoomId: request.body.resourceType === 'room' ? request.body.resourceId : undefined,
                                requestedLockerId: request.body.resourceType === 'locker' ? request.body.resourceId : undefined,
                            };
                            fastify.broadcaster.broadcastAssignmentFailed(failedPayload, laneId);
                        }
                    }
                    catch {
                        // Ignore broadcast errors
                    }
                }
                return reply.status(statusCode).send({
                    error: httpErr.message ?? 'Failed to assign resource',
                    raceLost: statusCode === 409,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to assign resource',
            });
        }
    });
}
