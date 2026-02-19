"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinSelectionRoutes = registerCheckinSelectionRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
async function checkPastDueBlocked(client, customerId, sessionBypassed) {
    if (!customerId) {
        return { blocked: false, balance: 0 };
    }
    const customerResult = await client.query(`SELECT past_due_balance FROM customers WHERE id = $1`, [customerId]);
    if (customerResult.rows.length === 0) {
        return { blocked: false, balance: 0 };
    }
    const balance = parseFloat(String(customerResult.rows[0].past_due_balance || 0));
    const blocked = balance > 0 && !sessionBypassed;
    return { blocked, balance };
}
function registerCheckinSelectionRoutes(fastify) {
    const normalizeDesiredTypes = (desiredTypes) => {
        if (!Array.isArray(desiredTypes))
            return [];
        return desiredTypes
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    };
    /**
     * POST /v1/checkin/lane/:laneId/select-rental
     *
     * Customer selects rental type (with optional waitlist).
     * Input: { rentalType, waitlistDesiredType?, backupRentalType? }
     */
    fastify.post('/v1/checkin/lane/:laneId/select-rental', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const { rentalType, waitlistDesiredType, waitlistDesiredTypes, backupRentalType, waitlistRequestedResourceNumber, waitlistRequestedResourceType, } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Get active session
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status = 'ACTIVE'
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                if (isFlowCommandsEnabled()) {
                    const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                        ? crypto.randomUUID()
                        : `sel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                    await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (session_id, command_id) DO NOTHING`, [
                        session.id,
                        commandId,
                        'EMPLOYEE',
                        'SET_STEP',
                        {
                            step: 'RENTAL',
                            rentalType,
                            waitlistDesiredType: waitlistDesiredType || null,
                            waitlistDesiredTypes: normalizeDesiredTypes(waitlistDesiredTypes),
                            backupRentalType: backupRentalType || null,
                            waitlistRequestedResourceNumber: waitlistRequestedResourceNumber || null,
                            waitlistRequestedResourceType: waitlistRequestedResourceType || null,
                        },
                    ]);
                    await client.query(`UPDATE lane_sessions
               SET flow_step = 'RENTAL',
                   flow_version = COALESCE(flow_version, 0) + 1,
                   flow_last_command_id = $1,
                   flow_last_actor = 'EMPLOYEE',
                   updated_at = NOW()
               WHERE id = $2`, [commandId, session.id]);
                }
                const normalizedDesiredTypes = normalizeDesiredTypes(waitlistDesiredTypes);
                // Update session with rental selection
                const updateResult = await client.query(`UPDATE lane_sessions
           SET desired_rental_type = $1,
               waitlist_desired_type = $2,
               waitlist_desired_types_json = $3,
               backup_rental_type = $4,
               waitlist_requested_resource_number = $5,
               waitlist_requested_resource_type = $6,
               status = 'AWAITING_ASSIGNMENT',
               updated_at = NOW()
           WHERE id = $7
           RETURNING *`, [
                    rentalType,
                    waitlistDesiredType || normalizedDesiredTypes[0] || null,
                    normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null,
                    backupRentalType || null,
                    waitlistRequestedResourceNumber || null,
                    waitlistRequestedResourceType || null,
                    session.id,
                ]);
                return {
                    sessionId: updateResult.rows[0].id,
                    desiredRentalType: rentalType,
                    waitlistDesiredType: waitlistDesiredType || null,
                    waitlistDesiredTypes: normalizedDesiredTypes,
                    backupRentalType: backupRentalType || null,
                    waitlistRequestedResourceNumber: waitlistRequestedResourceNumber || null,
                    waitlistRequestedResourceType: waitlistRequestedResourceType || null,
                };
            });
            // Broadcast full session update (stable payload)
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to select rental');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to select rental',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to select rental',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/propose-selection
     *
     * Propose a rental type selection (customer or employee can propose).
     * Does not lock the selection; requires confirmation.
     * Public endpoint (customer kiosk can call without auth).
     */
    fastify.post('/v1/checkin/lane/:laneId/propose-selection', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { rentalType, proposedBy, waitlistDesiredType, waitlistDesiredTypes, backupRentalType, waitlistRequestedResourceNumber, waitlistRequestedResourceType, } = request.body;
        // Validate proposedBy
        if (proposedBy !== 'CUSTOMER' && proposedBy !== 'EMPLOYEE') {
            return reply.status(400).send({ error: 'proposedBy must be CUSTOMER or EMPLOYEE' });
        }
        // If employee, require auth
        if (proposedBy === 'EMPLOYEE' && !request.staff) {
            return reply
                .status(401)
                .send({ error: 'Unauthorized - employee proposals require authentication' });
        }
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const sessionResult = await client.query(`SELECT * FROM lane_sessions
               WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
               ORDER BY created_at DESC
               LIMIT 1`, [laneId]);
                    if (sessionResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'No active session found' };
                    }
                    return sessionResult.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `prop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST',
                    url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: {
                        ...(request.headers.authorization
                            ? { authorization: String(request.headers.authorization) }
                            : {}),
                        ...(request.headers['x-kiosk-token']
                            ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) }
                            : {}),
                    },
                    payload: {
                        sessionId: session.id,
                        commandId,
                        actor: proposedBy,
                        expectedFlowVersion: session.flow_version ?? 0,
                        type: 'PROPOSE_SELECTION',
                        payload: { rentalType },
                    },
                });
                if (response.statusCode !== 200) {
                    return reply.status(response.statusCode).send(response.json());
                }
                return reply.send({ sessionId: session.id, proposedRentalType: rentalType, proposedBy });
            }
            catch (error) {
                request.log.error(error, 'Failed to propose selection (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr) {
                    return reply.status(httpErr.statusCode).send({
                        error: httpErr.message ?? 'Failed to propose selection',
                        code: httpErr.code,
                    });
                }
                return reply.status(500).send({
                    error: 'Internal Server Error',
                    message: 'Failed to propose selection',
                });
            }
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
                const session = sessionResult.rows[0];
                // Check past-due blocking
                const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
                if (blocked && proposedBy === 'CUSTOMER') {
                    throw { statusCode: 403, message: 'Past due balance must be cleared before selection' };
                }
                // If already locked, cannot propose new selection
                if (session.selection_confirmed) {
                    throw { statusCode: 400, message: 'Selection is already locked' };
                }
                const normalizedDesiredTypes = normalizeDesiredTypes(waitlistDesiredTypes);
                const updateResult = await client.query(`UPDATE lane_sessions
           SET proposed_rental_type = $1,
               proposed_by = $2,
               waitlist_desired_type = COALESCE($3, waitlist_desired_type),
               waitlist_desired_types_json = COALESCE($4, waitlist_desired_types_json),
               backup_rental_type = COALESCE($5, backup_rental_type),
               waitlist_requested_resource_number = COALESCE($6, waitlist_requested_resource_number),
               waitlist_requested_resource_type = COALESCE($7, waitlist_requested_resource_type),
               updated_at = NOW()
           WHERE id = $8
           RETURNING *`, [
                    rentalType,
                    proposedBy,
                    waitlistDesiredType || normalizedDesiredTypes[0] || null,
                    normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null,
                    backupRentalType || null,
                    waitlistRequestedResourceNumber || null,
                    waitlistRequestedResourceType || null,
                    session.id,
                ]);
                const updated = updateResult.rows[0];
                // Broadcast selection proposed
                const proposePayload = {
                    sessionId: updated.id,
                    rentalType,
                    proposedBy,
                };
                fastify.broadcaster.broadcastToLane({
                    type: 'SELECTION_PROPOSED',
                    payload: proposePayload,
                    timestamp: new Date().toISOString(),
                }, laneId);
                return {
                    sessionId: updated.id,
                    proposedRentalType: rentalType,
                    proposedBy,
                };
            });
            // Broadcast full session update (stable payload)
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to propose selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to propose selection',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to propose selection',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/waitlist-desired
     *
     * Record waitlist draft state (desired types / specific request / backup) without confirming selection.
     * Public endpoint (kiosk token required).
     */
    fastify.post('/v1/checkin/lane/:laneId/waitlist-desired', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { waitlistDesiredType, waitlistDesiredTypes, waitlistRequestedResourceNumber, waitlistRequestedResourceType, backupRentalType, sessionId, } = request.body || {};
        const hasDesiredType = request.body && Object.prototype.hasOwnProperty.call(request.body, 'waitlistDesiredType');
        if (!hasDesiredType) {
            return reply.status(400).send({ error: 'waitlistDesiredType is required' });
        }
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const sessionResult = sessionId
                        ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2 LIMIT 1`, [sessionId, laneId])
                        : await client.query(`SELECT * FROM lane_sessions
                   WHERE lane_id = $1
                     AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                   ORDER BY created_at DESC
                   LIMIT 1`, [laneId]);
                    if (sessionResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'No active session found' };
                    }
                    return sessionResult.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `wl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST',
                    url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: {
                        ...(request.headers.authorization
                            ? { authorization: String(request.headers.authorization) }
                            : {}),
                        ...(request.headers['x-kiosk-token']
                            ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) }
                            : {}),
                    },
                    payload: {
                        sessionId: session.id,
                        commandId,
                        actor: request.staff ? 'EMPLOYEE' : 'CUSTOMER',
                        expectedFlowVersion: session.flow_version ?? 0,
                        type: 'WAITLIST_UPDATE',
                        payload: {
                            waitlistDesiredType,
                            waitlistDesiredTypes: waitlistDesiredTypes ?? [],
                            waitlistRequestedResourceNumber,
                            waitlistRequestedResourceType,
                            backupRentalType,
                        },
                    },
                });
                if (response.statusCode !== 200) {
                    return reply.status(response.statusCode).send(response.json());
                }
                return reply.send({ success: true });
            }
            catch (error) {
                request.log.error(error, 'Failed to set waitlist desired type (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr) {
                    return reply.status(httpErr.statusCode).send({
                        error: httpErr.message ?? 'Failed to set waitlist desired type',
                        code: httpErr.code,
                    });
                }
                return reply.status(500).send({
                    error: 'Internal Server Error',
                    message: 'Failed to set waitlist desired type',
                });
            }
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2 LIMIT 1`, [sessionId, laneId])
                    : await client.query(`SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                const desired = waitlistDesiredType === null ||
                    (typeof waitlistDesiredType === 'string' && !waitlistDesiredType.trim())
                    ? null
                    : waitlistDesiredType;
                const normalizedDesiredTypes = normalizeDesiredTypes(waitlistDesiredTypes);
                const effectiveDesiredTypes = normalizedDesiredTypes.length > 0
                    ? normalizedDesiredTypes
                    : desired
                        ? [desired]
                        : [];
                const normalizedDesiredType = desired ?? effectiveDesiredTypes[0] ?? null;
                const normalizedRequestedNumber = waitlistRequestedResourceNumber && waitlistRequestedResourceNumber.trim()
                    ? waitlistRequestedResourceNumber.trim()
                    : null;
                const normalizedRequestedType = waitlistRequestedResourceType === 'room' || waitlistRequestedResourceType === 'locker'
                    ? waitlistRequestedResourceType
                    : null;
                const normalizedBackupRentalType = backupRentalType && backupRentalType.trim() ? backupRentalType.trim() : null;
                await client.query(`UPDATE lane_sessions
             SET waitlist_desired_type = $1,
                 waitlist_desired_types_json = $2,
                 backup_rental_type = $3,
                 waitlist_requested_resource_number = $4,
                 waitlist_requested_resource_type = $5,
                 updated_at = NOW()
             WHERE id = $6`, [
                    normalizedDesiredType,
                    effectiveDesiredTypes.length > 0 ? JSON.stringify(effectiveDesiredTypes) : null,
                    normalizedBackupRentalType,
                    normalizedRequestedNumber,
                    normalizedRequestedType,
                    session.id,
                ]);
                return { sessionId: session.id, laneId: session.lane_id || laneId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set waitlist desired type');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to set waitlist desired type',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to set waitlist desired type',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/confirm-selection
     *
     * Confirm the proposed selection (first confirmation locks it).
     * Public endpoint (customer kiosk can call without auth).
     */
    fastify.post('/v1/checkin/lane/:laneId/confirm-selection', {
        preHandler: [middleware_1.optionalAuth],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { confirmedBy } = request.body;
        // Validate confirmedBy
        if (confirmedBy !== 'CUSTOMER' && confirmedBy !== 'EMPLOYEE') {
            return reply.status(400).send({ error: 'confirmedBy must be CUSTOMER or EMPLOYEE' });
        }
        // If employee, require auth
        if (confirmedBy === 'EMPLOYEE' && !request.staff) {
            return reply
                .status(401)
                .send({ error: 'Unauthorized - employee confirmations require authentication' });
        }
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const sessionResult = await client.query(`SELECT * FROM lane_sessions
               WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
               ORDER BY created_at DESC
               LIMIT 1`, [laneId]);
                    if (sessionResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'No active session found' };
                    }
                    return sessionResult.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `conf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST',
                    url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: {
                        ...(request.headers.authorization
                            ? { authorization: String(request.headers.authorization) }
                            : {}),
                        ...(request.headers['x-kiosk-token']
                            ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) }
                            : {}),
                    },
                    payload: {
                        sessionId: session.id,
                        commandId,
                        actor: confirmedBy,
                        expectedFlowVersion: session.flow_version ?? 0,
                        type: 'CONFIRM_SELECTION',
                    },
                });
                if (response.statusCode !== 200) {
                    return reply.status(response.statusCode).send(response.json());
                }
                return reply.send({
                    sessionId: session.id,
                    rentalType: session.proposed_rental_type,
                    confirmedBy,
                    alreadyConfirmed: Boolean(session.selection_confirmed),
                });
            }
            catch (error) {
                request.log.error(error, 'Failed to confirm selection (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr) {
                    return reply.status(httpErr.statusCode).send({
                        error: httpErr.message ?? 'Failed to confirm selection',
                        code: httpErr.code,
                    });
                }
                return reply.status(500).send({
                    error: 'Internal Server Error',
                    message: 'Failed to confirm selection',
                });
            }
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
                const session = sessionResult.rows[0];
                // Check past-due blocking
                const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
                if (blocked && confirmedBy === 'CUSTOMER') {
                    throw {
                        statusCode: 403,
                        message: 'Past due balance must be cleared before confirmation',
                    };
                }
                if (!session.proposed_rental_type) {
                    throw { statusCode: 400, message: 'No selection proposed yet' };
                }
                // If already locked, return current state (idempotent)
                if (session.selection_confirmed) {
                    return {
                        sessionId: session.id,
                        rentalType: session.proposed_rental_type,
                        confirmedBy: session.selection_confirmed_by,
                        alreadyConfirmed: true,
                    };
                }
                // Lock the selection
                const updateResult = await client.query(`UPDATE lane_sessions
           SET selection_confirmed = true,
               selection_confirmed_by = $1,
               selection_locked_at = NOW(),
               desired_rental_type = proposed_rental_type,
               updated_at = NOW()
           WHERE id = $2
           RETURNING *`, [confirmedBy, session.id]);
                const updated = updateResult.rows[0];
                // Broadcast selection locked
                const lockedPayload = {
                    sessionId: updated.id,
                    rentalType: updated.proposed_rental_type,
                    confirmedBy: confirmedBy,
                    lockedAt: updated.selection_locked_at.toISOString(),
                };
                fastify.broadcaster.broadcastToLane({
                    type: 'SELECTION_LOCKED',
                    payload: lockedPayload,
                    timestamp: new Date().toISOString(),
                }, laneId);
                if (confirmedBy === 'EMPLOYEE') {
                    fastify.broadcaster.broadcastSelectionForced({
                        sessionId: updated.id,
                        rentalType: updated.proposed_rental_type,
                        forcedBy: 'EMPLOYEE',
                    }, laneId);
                }
                return {
                    sessionId: updated.id,
                    rentalType: updated.proposed_rental_type,
                    confirmedBy,
                };
            });
            // Broadcast full session update (stable payload)
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to confirm selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to confirm selection',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to confirm selection',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/acknowledge-selection
     *
     * Acknowledge a locked selection (required for the other side to proceed).
     * Public endpoint (customer kiosk can call without auth).
     */
    fastify.post('/v1/checkin/lane/:laneId/acknowledge-selection', {
        preHandler: [middleware_1.optionalAuth],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { acknowledgedBy } = request.body;
        // Validate acknowledgedBy
        if (acknowledgedBy !== 'CUSTOMER' && acknowledgedBy !== 'EMPLOYEE') {
            return reply.status(400).send({ error: 'acknowledgedBy must be CUSTOMER or EMPLOYEE' });
        }
        // If employee, require auth
        if (acknowledgedBy === 'EMPLOYEE' && !request.staff) {
            return reply
                .status(401)
                .send({ error: 'Unauthorized - employee acknowledgements require authentication' });
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
                const session = sessionResult.rows[0];
                if (!session.selection_confirmed) {
                    throw { statusCode: 400, message: 'Selection is not locked yet' };
                }
                // Broadcast acknowledgement
                const ackPayload = {
                    sessionId: session.id,
                    acknowledgedBy,
                };
                fastify.broadcaster.broadcastToLane({
                    type: 'SELECTION_ACKNOWLEDGED',
                    payload: ackPayload,
                    timestamp: new Date().toISOString(),
                }, laneId);
                return {
                    sessionId: session.id,
                    acknowledgedBy,
                };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to acknowledge selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to acknowledge selection',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to acknowledge selection',
            });
        }
    });
}
