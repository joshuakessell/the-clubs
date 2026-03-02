"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinLaneSessionRoutes = registerCheckinLaneSessionRoutes;
const zod_1 = require("zod");
const kioskToken_1 = require("../../auth/kioskToken");
const middleware_1 = require("../../auth/middleware");
const identity_1 = require("../../checkin/identity");
const schemas_1 = require("../../checkin/schemas");
const idempotency_1 = require("../../middleware/idempotency");
const laneSessionService_1 = require("../../services/laneSessionService");
function registerCheckinLaneSessionRoutes(fastify) {
    // POST /v1/checkin/lane/:laneId/start
    fastify.post('/v1/checkin/lane/:laneId/start', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = schemas_1.StartLaneSessionBodySchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        const { laneId } = request.params;
        const staffId = request.staff.staffId;
        try {
            const result = await (0, laneSessionService_1.startLaneSession)({ laneId, customerId: body.customerId, idScanValue: body.idScanValue, membershipScanValue: body.membershipScanValue, visitId: body.visitId, renewalHours: body.renewalHours }, { staffId, staffName: request.staff.name });
            if (result.sessionId && result.customerId) {
                await (0, laneSessionService_1.logCheckinStarted)(result.sessionId, result.customerId, result.customerName, result.mode, result.visitId, laneId, { staffId, staffName: request.staff.name }).catch((err) => request.log.error(err, 'Failed to log checkin activity'));
            }
            // Broadcast full session update
            const { payload } = await (0, laneSessionService_1.getSessionSnapshot)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            if (result.idScanIssue) {
                return reply.status(403).send({ error: (0, identity_1.getIdScanIssueMessage)(result.idScanIssue), code: result.idScanIssue });
            }
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to start lane session');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const statusCode = error.statusCode;
                const message = error.message;
                const code = error.code;
                const activeCheckin = error.activeCheckin;
                if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
                    return reply.status(200).send({
                        code: 'ALREADY_CHECKED_IN', alreadyCheckedIn: true,
                        activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
                    });
                }
                return reply.status(statusCode).send({
                    error: message ?? 'Failed to start session',
                    code: typeof code === 'string' ? code : undefined,
                    activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
                });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to start lane session' });
        }
    });
    // GET /v1/checkin/lane/:laneId/session-snapshot
    fastify.get('/v1/checkin/lane/:laneId/session-snapshot', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const result = await (0, laneSessionService_1.getLaneSessionSnapshot)(request.params.laneId);
        return reply.send(result);
    });
}
