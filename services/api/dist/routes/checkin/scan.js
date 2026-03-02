"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinScanRoutes = registerCheckinScanRoutes;
const zod_1 = require("zod");
const shared_1 = require("@the-clubs/shared");
const middleware_1 = require("../../auth/middleware");
const payload_1 = require("../../checkin/payload");
const schemas_1 = require("../../checkin/schemas");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const scanService_1 = require("../../services/checkin/scanService");
const scanIdService_1 = require("../../services/checkin/scanIdService");
function registerCheckinScanRoutes(fastify) {
    /**
     * POST /v1/checkin/scan — Server-side scan normalization and customer matching.
     */
    fastify.post('/v1/checkin/scan', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = schemas_1.CheckinScanBodySchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            const result = await (0, scanService_1.processCheckinScan)({
                rawScanText: body.rawScanText,
                selectedCustomerId: body.selectedCustomerId,
            });
            if (result.result === 'ERROR') {
                const code = result.error.code;
                if (code === 'INVALID_SCAN' || code === 'INVALID_SELECTION')
                    return reply.status(400).send(result);
                return reply.send(result);
            }
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to process checkin scan');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const e = error;
                return reply.status(e.statusCode).send({ result: 'ERROR', error: { code: e.code || 'ERROR', message: e.message || 'Failed to process scan' } });
            }
            return reply.status(500).send({ result: 'ERROR', error: { code: 'INTERNAL', message: 'Failed to process scan' } });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/scan-id — ID scan (PDF417) to identify customer and start/update lane session.
     */
    fastify.post('/v1/checkin/lane/:laneId/scan-id', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = shared_1.IdScanPayloadSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => (0, scanIdService_1.processScanId)(client, {
                laneId: request.params.laneId,
                staffId: request.staff.staffId,
                body,
            }));
            // Broadcast full session update
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to scan ID');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                const { statusCode, message, code } = httpErr;
                const activeCheckin = error.activeCheckin;
                if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
                    return reply.status(200).send({
                        code: 'ALREADY_CHECKED_IN',
                        alreadyCheckedIn: true,
                        activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
                    });
                }
                return reply.status(statusCode).send({
                    error: message ?? 'Failed to scan ID',
                    code,
                    activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
                });
            }
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
