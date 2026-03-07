"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPastDueBlocked = checkPastDueBlocked;
exports.selectRental = selectRental;
exports.proposeSelection = proposeSelection;
exports.setWaitlistDesired = setWaitlistDesired;
exports.confirmSelection = confirmSelection;
exports.acknowledgeSelection = acknowledgeSelection;
exports.buildSessionPayload = buildSessionPayload;
/**
 * Selection service — business logic for rental-type selection during checkin flow.
 *
 * Extracted from routes/checkin/selection.ts. Zero HTTP/Fastify concepts.
 *
 * NOTE: Broadcasting (SELECTION_PROPOSED, SELECTION_LOCKED, SELECTION_ACKNOWLEDGED,
 * SESSION_UPDATED) and flow-command bridging (fastify.inject) stay in the route layer.
 * This service handles only DB mutations and validation.
 */
const db_1 = require("../db");
const payload_1 = require("../checkin/payload");
const types_1 = require("../checkin/types");
// ── Shared helpers ──
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
async function checkPastDueBlocked(client, customerId, sessionBypassed) {
    if (!customerId)
        return { blocked: false, balance: 0 };
    const customerResult = await client.query(`SELECT past_due_balance FROM customers WHERE id = $1`, [customerId]);
    if (customerResult.rows.length === 0)
        return { blocked: false, balance: 0 };
    const balance = parseFloat(String(customerResult.rows[0].past_due_balance || 0));
    return { blocked: balance > 0 && !sessionBypassed, balance };
}
function normalizeDesiredTypes(desiredTypes) {
    if (!Array.isArray(desiredTypes))
        return [];
    return desiredTypes
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
async function selectRental(input) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`, [input.laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        if (isFlowCommandsEnabled()) {
            const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `sel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, command_id) DO NOTHING`, [session.id, commandId, 'EMPLOYEE', 'SET_STEP', {
                    step: 'RENTAL', rentalType: input.rentalType,
                    waitlistDesiredType: input.waitlistDesiredType || null,
                    waitlistDesiredTypes: normalizeDesiredTypes(input.waitlistDesiredTypes),
                    backupRentalType: input.backupRentalType || null,
                    waitlistRequestedResourceNumber: input.waitlistRequestedResourceNumber || null,
                    waitlistRequestedResourceType: input.waitlistRequestedResourceType || null,
                }]);
            await client.query(`UPDATE lane_sessions SET flow_step = 'RENTAL', flow_version = COALESCE(flow_version, 0) + 1,
         flow_last_command_id = $1, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = $2`, [commandId, session.id]);
        }
        const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
        const updateResult = await client.query(`UPDATE lane_sessions SET desired_rental_type = $1, waitlist_desired_type = $2,
       waitlist_desired_types_json = $3, backup_rental_type = $4,
       waitlist_requested_resource_number = $5, waitlist_requested_resource_type = $6,
       status = 'AWAITING_ASSIGNMENT', updated_at = NOW() WHERE id = $7 RETURNING *`, [input.rentalType, input.waitlistDesiredType || normalizedDesiredTypes[0] || null,
            normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null,
            input.backupRentalType || null, input.waitlistRequestedResourceNumber || null,
            input.waitlistRequestedResourceType || null, session.id]);
        return {
            sessionId: updateResult.rows[0].id,
            desiredRentalType: input.rentalType,
            waitlistDesiredType: input.waitlistDesiredType || null,
            waitlistDesiredTypes: normalizedDesiredTypes,
            backupRentalType: input.backupRentalType || null,
            waitlistRequestedResourceNumber: input.waitlistRequestedResourceNumber || null,
            waitlistRequestedResourceType: input.waitlistRequestedResourceType || null,
        };
    });
}
/** Non-flow-command propose path: validates + updates DB. Returns session info + payload for broadcasting. */
async function proposeSelection(input) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [input.laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
        if (blocked && input.proposedBy === 'CUSTOMER')
            throw { statusCode: 403, message: 'Past due balance must be cleared before selection' };
        if (session.selection_confirmed)
            throw { statusCode: 400, message: 'Selection is already locked' };
        const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
        await client.query(`UPDATE lane_sessions SET proposed_rental_type = $1, proposed_by = $2,
       waitlist_desired_type = COALESCE($3, waitlist_desired_type),
       waitlist_desired_types_json = COALESCE($4, waitlist_desired_types_json),
       backup_rental_type = COALESCE($5, backup_rental_type),
       waitlist_requested_resource_number = COALESCE($6, waitlist_requested_resource_number),
       waitlist_requested_resource_type = COALESCE($7, waitlist_requested_resource_type),
       updated_at = NOW() WHERE id = $8 RETURNING *`, [input.rentalType, input.proposedBy,
            input.waitlistDesiredType || normalizedDesiredTypes[0] || null,
            normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null,
            input.backupRentalType || null, input.waitlistRequestedResourceNumber || null,
            input.waitlistRequestedResourceType || null, session.id]);
        return { sessionId: session.id, proposedRentalType: input.rentalType, proposedBy: input.proposedBy };
    });
}
/** Non-flow-command waitlist-desired path: saves draft waitlist state. */
async function setWaitlistDesired(input) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = input.sessionId
            ? await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE id = $1 AND lane_id = $2 LIMIT 1`, [input.sessionId, input.laneId])
            : await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1
           AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC LIMIT 1`, [input.laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        const desired = input.waitlistDesiredType === null || (typeof input.waitlistDesiredType === 'string' && !input.waitlistDesiredType.trim()) ? null : input.waitlistDesiredType;
        const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
        const effectiveDesiredTypes = normalizedDesiredTypes.length > 0 ? normalizedDesiredTypes : desired ? [desired] : [];
        const normalizedDesiredType = desired ?? effectiveDesiredTypes[0] ?? null;
        const normalizedRequestedNumber = input.waitlistRequestedResourceNumber?.trim() || null;
        const normalizedRequestedType = input.waitlistRequestedResourceType === 'room' || input.waitlistRequestedResourceType === 'locker' ? input.waitlistRequestedResourceType : null;
        const normalizedBackupRentalType = input.backupRentalType?.trim() || null;
        await client.query(`UPDATE lane_sessions SET waitlist_desired_type = $1, waitlist_desired_types_json = $2,
       backup_rental_type = $3, waitlist_requested_resource_number = $4,
       waitlist_requested_resource_type = $5, updated_at = NOW() WHERE id = $6`, [normalizedDesiredType, effectiveDesiredTypes.length > 0 ? JSON.stringify(effectiveDesiredTypes) : null,
            normalizedBackupRentalType, normalizedRequestedNumber, normalizedRequestedType, session.id]);
        return { sessionId: session.id, laneId: session.lane_id || input.laneId };
    });
}
/** Non-flow-command confirm path: locks selection + returns payload for broadcasting. */
async function confirmSelection(laneId, confirmedBy) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        const { blocked } = await checkPastDueBlocked(client, session.customer_id, session.past_due_bypassed || false);
        if (blocked && confirmedBy === 'CUSTOMER')
            throw { statusCode: 403, message: 'Past due balance must be cleared before confirmation' };
        if (!session.proposed_rental_type)
            throw { statusCode: 400, message: 'No selection proposed yet' };
        // Idempotent: if already locked, return current state
        if (session.selection_confirmed) {
            return {
                sessionId: session.id, rentalType: session.proposed_rental_type,
                confirmedBy: session.selection_confirmed_by, alreadyConfirmed: true,
                lockedPayload: null, isEmployeeForced: false,
            };
        }
        const updateResult = await client.query(`UPDATE lane_sessions SET selection_confirmed = true, selection_confirmed_by = $1,
       selection_locked_at = NOW(), desired_rental_type = proposed_rental_type, updated_at = NOW()
       WHERE id = $2 RETURNING *`, [confirmedBy, session.id]);
        const updated = updateResult.rows[0];
        return {
            sessionId: updated.id,
            rentalType: updated.proposed_rental_type,
            confirmedBy,
            alreadyConfirmed: false,
            lockedPayload: {
                sessionId: updated.id,
                rentalType: updated.proposed_rental_type,
                confirmedBy: confirmedBy,
                lockedAt: updated.selection_locked_at.toISOString(),
            },
            isEmployeeForced: confirmedBy === 'EMPLOYEE',
        };
    });
}
/** Validate and return session for acknowledge-selection. */
async function acknowledgeSelection(laneId, acknowledgedBy) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        if (!session.selection_confirmed)
            throw { statusCode: 400, message: 'Selection is not locked yet' };
        return { sessionId: session.id, acknowledgedBy };
    });
}
/** Helper to build session update payload (reusable by routes needing broadcast). */
async function buildSessionPayload(sessionId) {
    return (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, sessionId));
}
