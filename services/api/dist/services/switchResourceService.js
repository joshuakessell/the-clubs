"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.switchResource = switchResource;
exports.logResourceSwitch = logResourceSwitch;
exports.persistDeclinedSwitchPayment = persistDeclinedSwitchPayment;
/**
 * Switch resource service — business logic for swapping a customer's room/locker mid-visit.
 *
 * Extracted from routes/checkin/switch-resource.ts. Zero HTTP/Fastify concepts.
 */
const shared_1 = require("@the-clubs/shared");
const auditLog_1 = require("../audit/auditLog");
const db_1 = require("../db");
const engine_1 = require("../pricing/engine");
const customerActivityLog_1 = require("../activity/customerActivityLog");
const HttpError_1 = require("../errors/HttpError");
// ── Helpers ──
function normalizeRentalTier(value) {
    if (value === 'STANDARD' || value === 'DOUBLE' || value === 'SPECIAL')
        return value;
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
// ── Service Methods ──
async function switchResource(input) {
    const previousRoomStatus = input.previousRoomStatus ?? 'DIRTY';
    return (0, db_1.serializableTransaction)(async (client) => {
        const visitResult = await client.query(`SELECT id, customer_id, ended_at FROM visits WHERE id = $1 FOR UPDATE`, [input.visitId]);
        if (visitResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Visit not found');
        const visit = visitResult.rows[0];
        if (visit.ended_at)
            throw new HttpError_1.HttpError(409, 'Visit is already completed');
        const blockResult = await client.query(`SELECT id, room_id, locker_id, rental_type::text FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`, [input.visitId]);
        if (blockResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'No active check-in block found');
        const block = blockResult.rows[0];
        const currentResourceType = block.room_id ? 'room' : block.locker_id ? 'locker' : null;
        const currentResourceId = block.room_id || block.locker_id;
        if (!currentResourceType || !currentResourceId)
            throw new HttpError_1.HttpError(400, 'Current visit has no assigned room/locker');
        if (currentResourceType === input.targetResourceType && String(currentResourceId) === String(input.targetResourceId))
            throw new HttpError_1.HttpError(400, 'Selected resource is already assigned');
        // Get current resource number
        let currentResourceNumber = '';
        if (currentResourceType === 'room') {
            const r = await client.query(`SELECT id, number FROM rooms WHERE id = $1 FOR UPDATE`, [currentResourceId]);
            if (r.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Current room not found');
            currentResourceNumber = r.rows[0].number;
        }
        else {
            const r = await client.query(`SELECT id, number FROM lockers WHERE id = $1 FOR UPDATE`, [currentResourceId]);
            if (r.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Current locker not found');
            currentResourceNumber = r.rows[0].number;
        }
        // Validate target
        let targetResourceNumber = '';
        let targetRentalType;
        if (input.targetResourceType === 'room') {
            const r = await client.query(`SELECT id, number, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [input.targetResourceId]);
            if (r.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Target room not found');
            const room = r.rows[0];
            if (room.status !== 'CLEAN' || room.assigned_to_customer_id)
                throw new HttpError_1.HttpError(409, `Room ${room.number} is not available`);
            targetResourceNumber = room.number;
            targetRentalType = getTierFromRoomNumber(room.number);
        }
        else {
            const r = await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`, [input.targetResourceId]);
            if (r.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Target locker not found');
            const locker = r.rows[0];
            if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id)
                throw new HttpError_1.HttpError(409, `Locker ${locker.number} is not available`);
            targetResourceNumber = locker.number;
            targetRentalType = 'LOCKER';
        }
        // Fee calculation
        const currentRentalType = normalizeRentalTier(block.rental_type);
        const additionalFee = computeAdditionalFee(currentRentalType, targetRentalType);
        let paymentIntentId = null;
        if (additionalFee > 0) {
            if (!input.paymentOutcome) {
                const payErr = new HttpError_1.HttpError(409, 'Additional payment required for this switch', { code: 'PAYMENT_REQUIRED' });
                Object.assign(payErr, { additionalFee, currentRentalType, targetRentalType });
                throw payErr;
            }
            if (input.paymentOutcome === 'CREDIT_DECLINE') {
                const declineErr = new HttpError_1.HttpError(402, input.declineReason ?? 'Credit declined', { code: 'PAYMENT_DECLINED' });
                Object.assign(declineErr, {
                    additionalFee, currentRentalType, targetRentalType,
                    visitId: input.visitId, checkinBlockId: block.id,
                    targetResourceType: input.targetResourceType, targetResourceId: input.targetResourceId, targetResourceNumber,
                });
                throw declineErr;
            }
            const pr = await client.query(`INSERT INTO payment_intents (amount, status, quote_json, paid_at) VALUES ($1, 'PAID', $2, NOW()) RETURNING id`, [additionalFee, JSON.stringify({ type: 'SWITCH_UPCHARGE', method: input.paymentOutcome, visitId: input.visitId, checkinBlockId: block.id, currentRentalType, targetRentalType, targetResourceType: input.targetResourceType, targetResourceId: input.targetResourceId, targetResourceNumber })]);
            paymentIntentId = pr.rows[0].id;
            await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id) VALUES ($1, $2, 'UPGRADE_FEE', $3, $4)`, [input.visitId, block.id, additionalFee, paymentIntentId]);
        }
        // Release current resource
        if (currentResourceType === 'room') {
            await client.query(`UPDATE rooms SET assigned_to_customer_id = NULL, status = $1, last_status_change = NOW(), updated_at = NOW() WHERE id = $2`, [previousRoomStatus, currentResourceId]);
        }
        else {
            await client.query(`UPDATE lockers SET assigned_to_customer_id = NULL, status = 'CLEAN', updated_at = NOW() WHERE id = $1`, [currentResourceId]);
        }
        // Assign target resource
        if (input.targetResourceType === 'room') {
            await client.query(`UPDATE rooms SET assigned_to_customer_id = $1, status = 'OCCUPIED', last_status_change = NOW(), updated_at = NOW() WHERE id = $2`, [visit.customer_id, input.targetResourceId]);
        }
        else {
            await client.query(`UPDATE lockers SET assigned_to_customer_id = $1, status = 'OCCUPIED', updated_at = NOW() WHERE id = $2`, [visit.customer_id, input.targetResourceId]);
        }
        // Update checkin block
        await client.query(`UPDATE checkin_blocks SET room_id = $1, locker_id = $2, rental_type = $3::public.rental_type, updated_at = NOW() WHERE id = $4`, [input.targetResourceType === 'room' ? input.targetResourceId : null, input.targetResourceType === 'locker' ? input.targetResourceId : null, targetRentalType, block.id]);
        await (0, auditLog_1.insertAuditLog)(client, {
            staffId: input.staffId, action: 'UPDATE', entityType: input.targetResourceType, entityId: input.targetResourceId,
            oldValue: { visitId: input.visitId, checkinBlockId: block.id, resourceType: currentResourceType, resourceId: currentResourceId, resourceNumber: currentResourceNumber, rentalType: currentRentalType, previousRoomStatus: currentResourceType === 'room' ? previousRoomStatus : null },
            newValue: { resourceType: input.targetResourceType, resourceId: input.targetResourceId, resourceNumber: targetResourceNumber, rentalType: targetRentalType, additionalFee, paymentIntentId },
        });
        return {
            visitId: input.visitId, checkinBlockId: block.id,
            previousResourceType: currentResourceType, previousResourceId: currentResourceId, previousResourceNumber: currentResourceNumber, previousRentalType: currentRentalType,
            newResourceType: input.targetResourceType, newResourceId: input.targetResourceId, newResourceNumber: targetResourceNumber, newRentalType: targetRentalType,
            additionalFee, paymentIntentId,
        };
    });
}
/** Log customer activity for a resource switch (best-effort, after successful switch). */
async function logResourceSwitch(result, staff) {
    await (0, db_1.transaction)(async (client) => {
        const visitRow = await client.query(`SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`, [result.visitId]);
        const customerId = visitRow.rows[0]?.customer_id;
        if (!customerId)
            return;
        const actionType = result.newResourceType === 'room' ? 'ROOM_CHANGED' : 'LOCKER_CHANGED';
        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
            customerId, actionType, actionCategory: 'RESOURCE_CHANGE', sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.staffName,
            summary: result.newResourceType === 'room'
                ? `Room changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`
                : `Locker changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`,
            metadata: {
                visitId: result.visitId, checkinBlockId: result.checkinBlockId,
                fromResourceType: result.previousResourceType, fromResourceId: result.previousResourceId, fromResourceNumber: result.previousResourceNumber,
                toResourceType: result.newResourceType, toResourceId: result.newResourceId, toResourceNumber: result.newResourceNumber,
                additionalFee: result.additionalFee, paymentIntentId: result.paymentIntentId,
            },
            dedupeKey: `ACT:${actionType}:${result.checkinBlockId}:${result.newResourceId}`,
            searchParts: [result.newResourceNumber, result.previousResourceNumber ?? ''],
        });
    });
}
/** Persist a cancelled payment intent after a declined switch (outside the aborted serializable txn). */
async function persistDeclinedSwitchPayment(err) {
    if (err.code !== 'PAYMENT_DECLINED' || !err.checkinBlockId || !err.visitId)
        return;
    await (0, db_1.transaction)(async (client) => {
        await client.query(`INSERT INTO payment_intents (amount, status, quote_json) VALUES ($1, 'CANCELLED', $2)`, [err.additionalFee ?? 0, JSON.stringify({
                type: 'SWITCH_UPCHARGE', visitId: err.visitId, checkinBlockId: err.checkinBlockId,
                currentRentalType: err.currentRentalType, targetRentalType: err.targetRentalType,
                targetResourceType: err.targetResourceType, targetResourceId: err.targetResourceId,
                targetResourceNumber: err.targetResourceNumber, declineReason: err.message,
            })]);
    });
}
