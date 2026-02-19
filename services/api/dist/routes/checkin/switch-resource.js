"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinSwitchResourceRoutes = registerCheckinSwitchResourceRoutes;
const shared_1 = require("@club-ops/shared");
const middleware_1 = require("../../auth/middleware");
const auditLog_1 = require("../../audit/auditLog");
const db_1 = require("../../db");
const broadcast_1 = require("../../inventory/broadcast");
const engine_1 = require("../../pricing/engine");
const db_2 = require("../../db");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
function normalizeRentalTier(value) {
    if (value === 'STANDARD' || value === 'DOUBLE' || value === 'SPECIAL') {
        return value;
    }
    return 'LOCKER';
}
function computeAdditionalFee(from, to) {
    if (from === to)
        return 0;
    const fee = (0, engine_1.getUpgradeFee)(from, to);
    return typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? fee : 0;
}
function getTierFromRoomNumber(roomNumber) {
    const parsed = Number.parseInt(roomNumber, 10);
    if (!Number.isFinite(parsed))
        return 'STANDARD';
    return (0, shared_1.getRoomTierFromNumber)(parsed);
}
function registerCheckinSwitchResourceRoutes(fastify) {
    fastify.post('/v1/checkin/visits/:visitId/switch-resource', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const staffId = request.staff.staffId;
        const { visitId } = request.params;
        const { targetResourceType, targetResourceId, previousRoomStatus = 'DIRTY', paymentOutcome, declineReason, } = request.body;
        if (!targetResourceId) {
            return reply.status(400).send({ error: 'targetResourceId is required' });
        }
        if (targetResourceType !== 'room' && targetResourceType !== 'locker') {
            return reply.status(400).send({ error: 'targetResourceType must be room or locker' });
        }
        if (previousRoomStatus !== 'CLEAN' &&
            previousRoomStatus !== 'CLEANING' &&
            previousRoomStatus !== 'DIRTY') {
            return reply.status(400).send({ error: 'previousRoomStatus is invalid' });
        }
        if (paymentOutcome &&
            paymentOutcome !== 'CASH_SUCCESS' &&
            paymentOutcome !== 'CREDIT_SUCCESS' &&
            paymentOutcome !== 'CREDIT_DECLINE') {
            return reply.status(400).send({ error: 'paymentOutcome is invalid' });
        }
        try {
            const result = await (0, db_1.serializableTransaction)(async (client) => {
                const visitResult = await client.query(`SELECT id, customer_id, ended_at
             FROM visits
             WHERE id = $1
             FOR UPDATE`, [visitId]);
                if (visitResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Visit not found' };
                }
                const visit = visitResult.rows[0];
                if (visit.ended_at) {
                    throw {
                        statusCode: 409,
                        message: 'Visit is already completed',
                    };
                }
                const blockResult = await client.query(`SELECT id, room_id, locker_id, rental_type::text
             FROM checkin_blocks
             WHERE visit_id = $1
             ORDER BY ends_at DESC
             LIMIT 1
             FOR UPDATE`, [visitId]);
                if (blockResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active check-in block found' };
                }
                const block = blockResult.rows[0];
                const currentResourceType = block.room_id
                    ? 'room'
                    : block.locker_id
                        ? 'locker'
                        : null;
                const currentResourceId = block.room_id || block.locker_id;
                if (!currentResourceType || !currentResourceId) {
                    throw {
                        statusCode: 400,
                        message: 'Current visit has no assigned room/locker',
                    };
                }
                if (currentResourceType === targetResourceType &&
                    String(currentResourceId) === String(targetResourceId)) {
                    throw {
                        statusCode: 400,
                        message: 'Selected resource is already assigned',
                    };
                }
                let currentResourceNumber = '';
                if (currentResourceType === 'room') {
                    const currentRoomResult = await client.query(`SELECT id, number FROM rooms WHERE id = $1 FOR UPDATE`, [currentResourceId]);
                    if (currentRoomResult.rows.length === 0) {
                        throw {
                            statusCode: 404,
                            message: 'Current room not found',
                        };
                    }
                    currentResourceNumber = currentRoomResult.rows[0].number;
                }
                else {
                    const currentLockerResult = await client.query(`SELECT id, number FROM lockers WHERE id = $1 FOR UPDATE`, [currentResourceId]);
                    if (currentLockerResult.rows.length === 0) {
                        throw {
                            statusCode: 404,
                            message: 'Current locker not found',
                        };
                    }
                    currentResourceNumber = currentLockerResult.rows[0].number;
                }
                let targetResourceNumber = '';
                let targetRentalType;
                if (targetResourceType === 'room') {
                    const targetRoomResult = await client.query(`SELECT id, number, status, assigned_to_customer_id
               FROM rooms
               WHERE id = $1
               FOR UPDATE`, [targetResourceId]);
                    if (targetRoomResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'Target room not found' };
                    }
                    const targetRoom = targetRoomResult.rows[0];
                    if (targetRoom.status !== 'CLEAN' || targetRoom.assigned_to_customer_id) {
                        throw {
                            statusCode: 409,
                            message: `Room ${targetRoom.number} is not available`,
                        };
                    }
                    targetResourceNumber = targetRoom.number;
                    targetRentalType = getTierFromRoomNumber(targetRoom.number);
                }
                else {
                    const targetLockerResult = await client.query(`SELECT id, number, status, assigned_to_customer_id
               FROM lockers
               WHERE id = $1
               FOR UPDATE`, [targetResourceId]);
                    if (targetLockerResult.rows.length === 0) {
                        throw { statusCode: 404, message: 'Target locker not found' };
                    }
                    const targetLocker = targetLockerResult.rows[0];
                    if (targetLocker.status !== 'CLEAN' || targetLocker.assigned_to_customer_id) {
                        throw {
                            statusCode: 409,
                            message: `Locker ${targetLocker.number} is not available`,
                        };
                    }
                    targetResourceNumber = targetLocker.number;
                    targetRentalType = 'LOCKER';
                }
                const currentRentalType = normalizeRentalTier(block.rental_type);
                const additionalFee = computeAdditionalFee(currentRentalType, targetRentalType);
                let paymentIntentId = null;
                if (additionalFee > 0) {
                    if (!paymentOutcome) {
                        throw {
                            statusCode: 409,
                            code: 'PAYMENT_REQUIRED',
                            message: 'Additional payment required for this switch',
                            additionalFee,
                            currentRentalType,
                            targetRentalType,
                        };
                    }
                    if (paymentOutcome === 'CREDIT_DECLINE') {
                        throw {
                            statusCode: 402,
                            code: 'PAYMENT_DECLINED',
                            message: declineReason ?? 'Credit declined',
                            additionalFee,
                            currentRentalType,
                            targetRentalType,
                            // Pass through context so we can persist a cancelled intent outside this transaction.
                            // (The serializableTransaction will roll back all writes when we throw.)
                            visitId,
                            checkinBlockId: block.id,
                            targetResourceType,
                            targetResourceId,
                            targetResourceNumber,
                        };
                    }
                    const paymentResult = await client.query(`INSERT INTO payment_intents (amount, status, quote_json, paid_at)
               VALUES ($1, 'PAID', $2, NOW())
               RETURNING id`, [
                        additionalFee,
                        JSON.stringify({
                            type: 'SWITCH_UPCHARGE',
                            method: paymentOutcome,
                            visitId,
                            checkinBlockId: block.id,
                            currentRentalType,
                            targetRentalType,
                            targetResourceType,
                            targetResourceId,
                            targetResourceNumber,
                        }),
                    ]);
                    paymentIntentId = paymentResult.rows[0].id;
                    await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id)
               VALUES ($1, $2, 'UPGRADE_FEE', $3, $4)`, [visitId, block.id, additionalFee, paymentIntentId]);
                }
                if (currentResourceType === 'room') {
                    await client.query(`UPDATE rooms
               SET assigned_to_customer_id = NULL,
                   status = $1,
                   last_status_change = NOW(),
                   updated_at = NOW()
               WHERE id = $2`, [previousRoomStatus, currentResourceId]);
                }
                else {
                    await client.query(`UPDATE lockers
               SET assigned_to_customer_id = NULL,
                   status = 'CLEAN',
                   updated_at = NOW()
               WHERE id = $1`, [currentResourceId]);
                }
                if (targetResourceType === 'room') {
                    await client.query(`UPDATE rooms
               SET assigned_to_customer_id = $1,
                   status = 'OCCUPIED',
                   last_status_change = NOW(),
                   updated_at = NOW()
               WHERE id = $2`, [visit.customer_id, targetResourceId]);
                }
                else {
                    await client.query(`UPDATE lockers
               SET assigned_to_customer_id = $1,
                   status = 'OCCUPIED',
                   updated_at = NOW()
               WHERE id = $2`, [visit.customer_id, targetResourceId]);
                }
                await client.query(`UPDATE checkin_blocks
             SET room_id = $1,
                 locker_id = $2,
                 rental_type = $3::public.rental_type,
                 updated_at = NOW()
             WHERE id = $4`, [
                    targetResourceType === 'room' ? targetResourceId : null,
                    targetResourceType === 'locker' ? targetResourceId : null,
                    targetRentalType,
                    block.id,
                ]);
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId,
                    action: 'UPDATE',
                    entityType: targetResourceType,
                    entityId: targetResourceId,
                    oldValue: {
                        visitId,
                        checkinBlockId: block.id,
                        resourceType: currentResourceType,
                        resourceId: currentResourceId,
                        resourceNumber: currentResourceNumber,
                        rentalType: currentRentalType,
                        previousRoomStatus: currentResourceType === 'room' ? previousRoomStatus : null,
                    },
                    newValue: {
                        resourceType: targetResourceType,
                        resourceId: targetResourceId,
                        resourceNumber: targetResourceNumber,
                        rentalType: targetRentalType,
                        additionalFee,
                        paymentIntentId,
                    },
                });
                return {
                    visitId,
                    checkinBlockId: block.id,
                    previousResourceType: currentResourceType,
                    previousResourceId: currentResourceId,
                    previousResourceNumber: currentResourceNumber,
                    previousRentalType: currentRentalType,
                    newResourceType: targetResourceType,
                    newResourceId: targetResourceId,
                    newResourceNumber: targetResourceNumber,
                    newRentalType: targetRentalType,
                    additionalFee,
                    paymentIntentId,
                };
            });
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            // Customer activity log
            await (0, db_2.transaction)(async (client) => {
                // Derive customerId from visit
                const visitRow = await client.query(`SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`, [result.visitId]);
                const customerId = visitRow.rows[0]?.customer_id;
                if (!customerId)
                    return;
                const actionType = result.newResourceType === 'room' ? 'ROOM_CHANGED' : 'LOCKER_CHANGED';
                const event = await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                    customerId,
                    actionType,
                    actionCategory: 'RESOURCE_CHANGE',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    actorType: 'STAFF',
                    actorStaffId: staffId,
                    actorStaffName: request.staff.name,
                    summary: result.newResourceType === 'room'
                        ? `Room changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`
                        : `Locker changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`,
                    metadata: {
                        visitId: result.visitId,
                        checkinBlockId: result.checkinBlockId,
                        fromResourceType: result.previousResourceType,
                        fromResourceId: result.previousResourceId,
                        fromResourceNumber: result.previousResourceNumber,
                        toResourceType: result.newResourceType,
                        toResourceId: result.newResourceId,
                        toResourceNumber: result.newResourceNumber,
                        additionalFee: result.additionalFee,
                        paymentIntentId: result.paymentIntentId,
                    },
                    dedupeKey: `ACT:${actionType}:${result.checkinBlockId}:${result.newResourceId}`,
                    searchParts: [result.newResourceNumber, result.previousResourceNumber ?? ''],
                });
                request.log.info({
                    customerActivityEventId: event.id,
                    customerId,
                    actionType,
                    actionCategory: 'RESOURCE_CHANGE',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    actorType: 'STAFF',
                    actorStaffId: staffId,
                }, 'customer_activity_event');
            });
            return reply.send({ success: true, ...result });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                // If a card was declined, record a cancelled payment_intent for auditability.
                // This must happen outside the aborted serializable transaction.
                if (err.code === 'PAYMENT_DECLINED' && 'checkinBlockId' in err && 'visitId' in err) {
                    const checkinBlockId = err.checkinBlockId;
                    const declinedVisitId = err.visitId;
                    if (checkinBlockId && declinedVisitId) {
                        try {
                            await (0, db_2.transaction)(async (client) => {
                                await client.query(`INSERT INTO payment_intents (amount, status, quote_json)
                     VALUES ($1, 'CANCELLED', $2)`, [
                                    err.additionalFee ?? 0,
                                    JSON.stringify({
                                        type: 'SWITCH_UPCHARGE',
                                        visitId: declinedVisitId,
                                        checkinBlockId,
                                        currentRentalType: err.currentRentalType,
                                        targetRentalType: err.targetRentalType,
                                        targetResourceType: err
                                            .targetResourceType,
                                        targetResourceId: err
                                            .targetResourceId,
                                        targetResourceNumber: err
                                            .targetResourceNumber,
                                        declineReason: err.message,
                                    }),
                                ]);
                            });
                        }
                        catch (persistError) {
                            request.log.warn(persistError, 'Failed to persist cancelled switch payment_intent');
                        }
                    }
                }
                return reply.status(err.statusCode).send({
                    error: err.message,
                    code: err.code,
                    additionalFee: err.additionalFee,
                    currentRentalType: err.currentRentalType,
                    targetRentalType: err.targetRentalType,
                });
            }
            request.log.error(error, 'Failed to switch assigned resource');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
