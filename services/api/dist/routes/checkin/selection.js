"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinSelectionRoutes = registerCheckinSelectionRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const selectionService_1 = require("../../services/selectionService");
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
function registerCheckinSelectionRoutes(fastify) {
    // POST /v1/checkin/lane/:laneId/select-rental
    fastify.post('/v1/checkin/lane/:laneId/select-rental', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { laneId } = request.params;
        try {
            const result = await (0, selectionService_1.selectRental)({ laneId, ...request.body });
            const { payload } = await (0, selectionService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to select rental');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to select rental' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to select rental' });
        }
    });
    // POST /v1/checkin/lane/:laneId/propose-selection
    fastify.post('/v1/checkin/lane/:laneId/propose-selection', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        const { proposedBy } = request.body;
        if (proposedBy !== 'CUSTOMER' && proposedBy !== 'EMPLOYEE')
            return reply.status(400).send({ error: 'proposedBy must be CUSTOMER or EMPLOYEE' });
        if (proposedBy === 'EMPLOYEE' && !request.staff)
            return reply.status(401).send({ error: 'Unauthorized - employee proposals require authentication' });
        // Flow commands path: delegate to flow-command endpoint
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const r = await client.query(`SELECT * FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
                    if (r.rows.length === 0)
                        throw { statusCode: 404, message: 'No active session found' };
                    return r.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `prop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
                    payload: { sessionId: session.id, commandId, actor: proposedBy, expectedFlowVersion: session.flow_version ?? 0, type: 'PROPOSE_SELECTION', payload: { rentalType: request.body.rentalType } },
                });
                if (response.statusCode !== 200)
                    return reply.status(response.statusCode).send(response.json());
                return reply.send({ sessionId: session.id, proposedRentalType: request.body.rentalType, proposedBy });
            }
            catch (error) {
                request.log.error(error, 'Failed to propose selection (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr)
                    return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to propose selection', code: httpErr.code });
                return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to propose selection' });
            }
        }
        // Non-flow-command path
        try {
            const result = await (0, selectionService_1.proposeSelection)({ laneId, ...request.body });
            const proposePayload = { sessionId: result.sessionId, rentalType: request.body.rentalType, proposedBy };
            fastify.broadcaster.broadcastToLane({ type: 'SELECTION_PROPOSED', payload: proposePayload, timestamp: new Date().toISOString() }, laneId);
            const { payload } = await (0, selectionService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to propose selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to propose selection', code: httpErr.code });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to propose selection' });
        }
    });
    // POST /v1/checkin/lane/:laneId/waitlist-desired
    fastify.post('/v1/checkin/lane/:laneId/waitlist-desired', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        const hasDesiredType = request.body && Object.prototype.hasOwnProperty.call(request.body, 'waitlistDesiredType');
        if (!hasDesiredType)
            return reply.status(400).send({ error: 'waitlistDesiredType is required' });
        // Flow commands path
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const sessionResult = request.body.sessionId
                        ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2 LIMIT 1`, [request.body.sessionId, laneId])
                        : await client.query(`SELECT * FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE') ORDER BY created_at DESC LIMIT 1`, [laneId]);
                    if (sessionResult.rows.length === 0)
                        throw { statusCode: 404, message: 'No active session found' };
                    return sessionResult.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `wl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
                    payload: {
                        sessionId: session.id, commandId, actor: request.staff ? 'EMPLOYEE' : 'CUSTOMER',
                        expectedFlowVersion: session.flow_version ?? 0, type: 'WAITLIST_UPDATE',
                        payload: { waitlistDesiredType: request.body.waitlistDesiredType, waitlistDesiredTypes: request.body.waitlistDesiredTypes ?? [], waitlistRequestedResourceNumber: request.body.waitlistRequestedResourceNumber, waitlistRequestedResourceType: request.body.waitlistRequestedResourceType, backupRentalType: request.body.backupRentalType },
                    },
                });
                if (response.statusCode !== 200)
                    return reply.status(response.statusCode).send(response.json());
                return reply.send({ success: true });
            }
            catch (error) {
                request.log.error(error, 'Failed to set waitlist desired type (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr)
                    return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set waitlist desired type', code: httpErr.code });
                return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set waitlist desired type' });
            }
        }
        // Non-flow-command path
        try {
            const result = await (0, selectionService_1.setWaitlistDesired)({ laneId, ...request.body });
            const { payload } = await (0, selectionService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set waitlist desired type');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set waitlist desired type', code: httpErr.code });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set waitlist desired type' });
        }
    });
    // POST /v1/checkin/lane/:laneId/confirm-selection
    fastify.post('/v1/checkin/lane/:laneId/confirm-selection', { preHandler: [middleware_1.optionalAuth] }, async (request, reply) => {
        const { laneId } = request.params;
        const { confirmedBy } = request.body;
        if (confirmedBy !== 'CUSTOMER' && confirmedBy !== 'EMPLOYEE')
            return reply.status(400).send({ error: 'confirmedBy must be CUSTOMER or EMPLOYEE' });
        if (confirmedBy === 'EMPLOYEE' && !request.staff)
            return reply.status(401).send({ error: 'Unauthorized - employee confirmations require authentication' });
        // Flow commands path
        if (isFlowCommandsEnabled()) {
            try {
                const session = await (0, db_1.transaction)(async (client) => {
                    const r = await client.query(`SELECT * FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
                    if (r.rows.length === 0)
                        throw { statusCode: 404, message: 'No active session found' };
                    return r.rows[0];
                });
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `conf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await fastify.inject({
                    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
                    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
                    payload: { sessionId: session.id, commandId, actor: confirmedBy, expectedFlowVersion: session.flow_version ?? 0, type: 'CONFIRM_SELECTION' },
                });
                if (response.statusCode !== 200)
                    return reply.status(response.statusCode).send(response.json());
                return reply.send({ sessionId: session.id, rentalType: session.proposed_rental_type, confirmedBy, alreadyConfirmed: Boolean(session.selection_confirmed) });
            }
            catch (error) {
                request.log.error(error, 'Failed to confirm selection (flow commands)');
                const httpErr = (0, utils_1.getHttpError)(error);
                if (httpErr)
                    return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to confirm selection', code: httpErr.code });
                return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to confirm selection' });
            }
        }
        // Non-flow-command path
        try {
            const result = await (0, selectionService_1.confirmSelection)(laneId, confirmedBy);
            if (result.lockedPayload) {
                const lockedPayload = result.lockedPayload;
                fastify.broadcaster.broadcastToLane({ type: 'SELECTION_LOCKED', payload: lockedPayload, timestamp: new Date().toISOString() }, laneId);
                if (result.isEmployeeForced) {
                    fastify.broadcaster.broadcastSelectionForced({ sessionId: result.sessionId, rentalType: result.rentalType, forcedBy: 'EMPLOYEE' }, laneId);
                }
            }
            const { payload } = await (0, selectionService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({ sessionId: result.sessionId, rentalType: result.rentalType, confirmedBy: result.confirmedBy, alreadyConfirmed: result.alreadyConfirmed });
        }
        catch (error) {
            request.log.error(error, 'Failed to confirm selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to confirm selection', code: httpErr.code });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to confirm selection' });
        }
    });
    // POST /v1/checkin/lane/:laneId/acknowledge-selection
    fastify.post('/v1/checkin/lane/:laneId/acknowledge-selection', { preHandler: [middleware_1.optionalAuth] }, async (request, reply) => {
        const { laneId } = request.params;
        const { acknowledgedBy } = request.body;
        if (acknowledgedBy !== 'CUSTOMER' && acknowledgedBy !== 'EMPLOYEE')
            return reply.status(400).send({ error: 'acknowledgedBy must be CUSTOMER or EMPLOYEE' });
        if (acknowledgedBy === 'EMPLOYEE' && !request.staff)
            return reply.status(401).send({ error: 'Unauthorized - employee acknowledgements require authentication' });
        try {
            const result = await (0, selectionService_1.acknowledgeSelection)(laneId, acknowledgedBy);
            const ackPayload = { sessionId: result.sessionId, acknowledgedBy };
            fastify.broadcaster.broadcastToLane({ type: 'SELECTION_ACKNOWLEDGED', payload: ackPayload, timestamp: new Date().toISOString() }, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to acknowledge selection');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to acknowledge selection' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to acknowledge selection' });
        }
    });
}
