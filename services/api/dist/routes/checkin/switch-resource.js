"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinSwitchResourceRoutes = registerCheckinSwitchResourceRoutes;
const middleware_1 = require("../../auth/middleware");
const broadcast_1 = require("../../inventory/broadcast");
const switchResourceService_1 = require("../../services/switchResourceService");
function registerCheckinSwitchResourceRoutes(fastify) {
    fastify.post('/v1/checkin/visits/:visitId/switch-resource', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { visitId } = request.params;
        const { targetResourceType, targetResourceId, previousRoomStatus, paymentOutcome, declineReason } = request.body;
        if (!targetResourceId)
            return reply.status(400).send({ error: 'targetResourceId is required' });
        if (targetResourceType !== 'room' && targetResourceType !== 'locker')
            return reply.status(400).send({ error: 'targetResourceType must be room or locker' });
        if (previousRoomStatus && previousRoomStatus !== 'CLEAN' && previousRoomStatus !== 'CLEANING' && previousRoomStatus !== 'DIRTY')
            return reply.status(400).send({ error: 'previousRoomStatus is invalid' });
        if (paymentOutcome && paymentOutcome !== 'CASH_SUCCESS' && paymentOutcome !== 'CREDIT_SUCCESS' && paymentOutcome !== 'CREDIT_DECLINE')
            return reply.status(400).send({ error: 'paymentOutcome is invalid' });
        try {
            const result = await (0, switchResourceService_1.switchResource)({ visitId, targetResourceType, targetResourceId, previousRoomStatus, paymentOutcome, declineReason, staffId: request.staff.staffId });
            if (fastify.broadcaster)
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            await (0, switchResourceService_1.logResourceSwitch)(result, { staffId: request.staff.staffId, staffName: request.staff.name }).catch((err) => request.log.warn(err, 'Failed to log resource switch activity'));
            return reply.send({ success: true, ...result });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                if (err.code === 'PAYMENT_DECLINED') {
                    await (0, switchResourceService_1.persistDeclinedSwitchPayment)(err).catch((e) => request.log.warn(e, 'Failed to persist cancelled switch payment_intent'));
                }
                return reply.status(err.statusCode).send({ error: err.message, code: err.code, additionalFee: err.additionalFee, currentRentalType: err.currentRentalType, targetRentalType: err.targetRentalType });
            }
            request.log.error(error, 'Failed to switch assigned resource');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
