"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinScanRoutes = registerCheckinScanRoutes;
const shared_1 = require("@the-clubs/shared");
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const payload_1 = require("../../checkin/payload");
const schemas_1 = require("../../checkin/schemas");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const scanService_1 = require("../../services/checkin/scanService");
const scanIdService_1 = require("../../services/checkin/scanIdService");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by scanIdService.processScanId.
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
function registerCheckinScanRoutes(fastify) {
    /**
     * POST /v1/checkin/scan — Server-side scan normalization and customer matching.
     */
    fastify.post('/v1/checkin/scan', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const parsed = schemas_1.CheckinScanBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
        }
        const body = parsed.data;
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
    fastify.post('/v1/checkin/lane/:laneId/scan-id', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const parsed = shared_1.IdScanPayloadSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
        }
        const body = parsed.data;
        try {
            const result = await db_1.db.transaction(async (tx) => (0, scanIdService_1.processScanId)(toQueryable(tx), {
                laneId: request.params.laneId,
                staffId: request.staff.staffId,
                body,
            }));
            // buildFullSessionUpdatedPayload is already Drizzle-native — no transaction wrapper needed
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
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
