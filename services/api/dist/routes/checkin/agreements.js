"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinAgreementRoutes = registerCheckinAgreementRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const utils_1 = require("../../checkin/utils");
const broadcast_1 = require("../../inventory/broadcast");
const agreementService_1 = require("../../services/agreementService");
function buildCtx(request) {
    return {
        staffId: request.staff?.staffId,
        staffName: request.staff?.name,
        sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
        actorType: request.staff ? 'STAFF' : 'CUSTOMER',
        userAgent: request.headers['user-agent'] || undefined,
        ipAddress: request.ip || undefined,
    };
}
function registerCheckinAgreementRoutes(fastify) {
    fastify.post('/v1/checkin/lane/:laneId/sign-agreement', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        try {
            const result = await (0, agreementService_1.processAgreementSigning)({
                laneId: request.params.laneId,
                sessionId: request.body.sessionId,
                signaturePayload: request.body.signaturePayload,
                ctx: buildCtx(request),
            });
            if (result.waitlist) {
                fastify.broadcaster.broadcast({
                    type: 'WAITLIST_UPDATED',
                    payload: result.waitlist,
                    timestamp: new Date().toISOString(),
                });
            }
            const assignmentPayload = {
                sessionId: result.sessionId,
                resourceId: result.checkinBlockId,
                resourceNumber: result.assignedResourceNumber || '',
                rentalType: result.rentalType,
            };
            fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, request.params.laneId);
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
            await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to sign agreement');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to sign agreement' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to sign agreement' });
        }
    });
    fastify.post('/v1/checkin/lane/:laneId/manual-signature-override', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        try {
            const result = await (0, agreementService_1.processAgreementSigning)({
                laneId: request.params.laneId,
                sessionId: request.body.sessionId,
                signaturePayload: 'MANUAL_OVERRIDE',
                ctx: buildCtx(request),
            });
            if (result.waitlist) {
                fastify.broadcaster.broadcast({
                    type: 'WAITLIST_UPDATED',
                    payload: result.waitlist,
                    timestamp: new Date().toISOString(),
                });
            }
            const assignmentPayload = {
                sessionId: result.sessionId,
                resourceId: result.checkinBlockId,
                resourceNumber: result.assignedResourceNumber || '',
                rentalType: result.rentalType,
            };
            fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, request.params.laneId);
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
            await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed manual signature override');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed manual override' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed manual signature override' });
        }
    });
    fastify.post('/v1/checkin/lane/:laneId/agreement-bypass', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, agreementService_1.requestAgreementBypass)({
                laneId: request.params.laneId,
                sessionId: request.body.sessionId,
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to bypass agreement');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to bypass agreement', code: httpErr.code });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to bypass agreement' });
        }
    });
    fastify.post('/v1/checkin/lane/:laneId/customer-confirm', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        try {
            const result = await (0, agreementService_1.processCustomerConfirm)({
                laneId: request.params.laneId,
                sessionId: request.body.sessionId,
                confirmed: request.body.confirmed,
            });
            if (result.confirmedPayload) {
                fastify.broadcaster.broadcastCustomerConfirmed(result.confirmedPayload, request.params.laneId);
            }
            if (result.declinedPayload) {
                fastify.broadcaster.broadcastCustomerDeclined(result.declinedPayload, request.params.laneId);
            }
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to process customer confirmation');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to process confirmation' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to process customer confirmation' });
        }
    });
    fastify.post('/v1/checkin/lane/:laneId/kiosk-sign', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { signaturePayload, sessionId } = request.body;
        if (!signaturePayload || signaturePayload.length < 16) {
            return reply.status(400).send({ error: 'Signature payload is required' });
        }
        try {
            const updatedSessionId = await (0, agreementService_1.recordKioskSignature)({
                laneId: request.params.laneId,
                sessionId,
                signaturePayload,
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(updatedSessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to record kiosk signature');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            }
            return reply.status(500).send({ error: 'Failed to record signature' });
        }
    });
}
