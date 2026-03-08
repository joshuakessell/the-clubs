"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startLaneSession = startLaneSession;
exports.logCheckinStarted = logCheckinStarted;
exports.getSessionSnapshot = getSessionSnapshot;
exports.getLaneSessionSnapshot = getLaneSessionSnapshot;
/**
 * Lane session service — business logic for starting/managing checkin lane sessions.
 *
 * Extracted from routes/checkin/lane-session.ts. Zero HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const identity_1 = require("../checkin/identity");
const payload_1 = require("../checkin/payload");
const utils_1 = require("../checkin/utils");
const customerActivityLog_1 = require("../activity/customerActivityLog");
const clubEventLog_1 = require("../activity/clubEventLog");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function startLaneSession(input, staff) {
    const { laneId, customerId: requestedCustomerId, idScanValue, membershipScanValue, visitId, renewalHours } = input;
    return (0, db_1.transaction)(async (client) => {
        let membershipNumber = membershipScanValue ? (0, identity_1.parseMembershipNumber)(membershipScanValue) : null;
        let customerId = null;
        let customerName = 'Customer';
        let customerHasEncryptedLookupMarker = false;
        let idScanIssue;
        if (requestedCustomerId) {
            const customerResult = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
         FROM customers WHERE id = $1 LIMIT 1`, [requestedCustomerId]);
            if (customerResult.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Customer not found');
            const customer = customerResult.rows[0];
            customerId = customer.id;
            customerName = customer.name;
            membershipNumber = customer.membership_number || null;
            customerHasEncryptedLookupMarker = Boolean(customer.id_scan_hash);
            idScanIssue = (0, identity_1.getIdScanIssue)({ dob: customer.dob, idExpirationDate: customer.id_expiration_date ?? null });
            const bannedUntil = (0, utils_1.toDate)(customer.banned_until);
            if (bannedUntil && new Date() < bannedUntil)
                throw new HttpError_1.HttpError(403, 'Customer is banned until ' + bannedUntil.toISOString());
        }
        else {
            if (membershipNumber) {
                const customerResult = await client.query(`SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
           FROM customers WHERE membership_number = $1 LIMIT 1`, [membershipNumber]);
                if (customerResult.rows.length > 0) {
                    const customer = customerResult.rows[0];
                    customerId = customer.id;
                    customerName = customer.name;
                    customerHasEncryptedLookupMarker = Boolean(customer.id_scan_hash);
                    idScanIssue = (0, identity_1.getIdScanIssue)({ dob: customer.dob, idExpirationDate: customer.id_expiration_date ?? null });
                    const bannedUntil = (0, utils_1.toDate)(customer.banned_until);
                    if (bannedUntil && new Date() < bannedUntil)
                        throw new HttpError_1.HttpError(403, 'Customer is banned until ' + bannedUntil.toISOString());
                }
            }
            if (!customerId) {
                const newCustomer = await client.query(`INSERT INTO customers (name, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING id`, [idScanValue || 'Customer']);
                customerId = newCustomer.rows[0].id;
                customerName = idScanValue || 'Customer';
            }
        }
        // Determine mode
        let computedMode = 'CHECKIN';
        let visitIdForSession = null;
        let blockEndsAtDate = null;
        let currentTotalHours = 0;
        let renewalHoursForSession = null;
        let activeAssignedResourceType = null;
        let activeAssignedResourceNumber = null;
        let activeRentalType = null;
        const resolveVisitBlocks = async (activeVisitId) => {
            const blocksResult = await client.query(`SELECT starts_at, ends_at FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`, [activeVisitId]);
            if (blocksResult.rows.length > 0) {
                blockEndsAtDate = blocksResult.rows[0].ends_at;
                for (const block of blocksResult.rows) {
                    currentTotalHours += (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
                }
            }
        };
        const resolveActiveAssignment = async (activeVisitId) => {
            const activeBlock = await client.query(`SELECT cb.rental_type, cb.room_id, cb.locker_id, r.number as room_number, l.number as locker_number
         FROM checkin_blocks cb LEFT JOIN rooms r ON cb.room_id = r.id LEFT JOIN lockers l ON cb.locker_id = l.id
         WHERE cb.visit_id = $1 ORDER BY cb.ends_at DESC LIMIT 1`, [activeVisitId]);
            const row = activeBlock.rows[0];
            if (!row)
                return;
            activeRentalType = row.rental_type;
            if (row.room_id && row.room_number) {
                activeAssignedResourceType = 'room';
                activeAssignedResourceNumber = row.room_number;
            }
            else if (row.locker_id && row.locker_number) {
                activeAssignedResourceType = 'locker';
                activeAssignedResourceNumber = row.locker_number;
            }
        };
        if (renewalHours && !visitId)
            throw new HttpError_1.HttpError(400, 'renewalHours requires an explicit visitId');
        if (visitId) {
            const visitResult = await client.query(`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1`, [visitId]);
            if (visitResult.rows.length === 0)
                throw new HttpError_1.HttpError(404, 'Visit not found');
            const visit = visitResult.rows[0];
            if (customerId && visit.customer_id !== customerId)
                throw new HttpError_1.HttpError(403, 'Visit does not belong to this customer');
            visitIdForSession = visit.id;
            computedMode = 'RENEWAL';
            await resolveVisitBlocks(visit.id);
            await resolveActiveAssignment(visit.id);
            const requestedRenewalHours = renewalHours ?? 6;
            if (!blockEndsAtDate)
                throw new HttpError_1.HttpError(400, 'Cannot determine checkout time for renewal');
            const diffMs = Math.abs(blockEndsAtDate.getTime() - Date.now());
            if (diffMs > 60 * 60 * 1000)
                throw new HttpError_1.HttpError(400, 'Renewal is only available within 1 hour of checkout');
            if (currentTotalHours + requestedRenewalHours > 14)
                throw new HttpError_1.HttpError(400, `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${requestedRenewalHours} hours.`);
            renewalHoursForSession = requestedRenewalHours;
        }
        else if (customerId) {
            const activeVisit = await client.query(`SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [customerId]);
            if (activeVisit.rows.length > 0) {
                const activeVisitId = activeVisit.rows[0].id;
                await resolveVisitBlocks(activeVisitId);
                const activeBlock = await client.query(`SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as room_number, l.number as locker_number
           FROM checkin_blocks cb LEFT JOIN rooms r ON cb.room_id = r.id LEFT JOIN lockers l ON cb.locker_id = l.id
           WHERE cb.visit_id = $1 ORDER BY cb.ends_at DESC LIMIT 1`, [activeVisitId]);
                const block = activeBlock.rows[0];
                const assignedResourceType = block?.room_number ? 'room' : block?.locker_number ? 'locker' : null;
                const assignedResourceNumber = block?.room_number ?? block?.locker_number ?? null;
                const waitlistResult = await client.query(`SELECT id, desired_tier, backup_tier, status FROM waitlist WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED') ORDER BY created_at DESC LIMIT 1`, [activeVisitId]);
                const wl = waitlistResult.rows[0];
                const err = new HttpError_1.HttpError(409, 'Customer is currently checked in', { code: 'ALREADY_CHECKED_IN' });
                err.activeCheckin = {
                    visitId: activeVisitId,
                    rentalType: block?.rental_type ?? null,
                    assignedResourceType, assignedResourceNumber,
                    checkinAt: block?.starts_at ? block.starts_at.toISOString() : null,
                    checkoutAt: block?.ends_at ? block.ends_at.toISOString() : null,
                    overdue: block?.ends_at ? block.ends_at.getTime() < Date.now() : null,
                    currentTotalHours,
                    waitlist: wl ? { id: wl.id, desiredTier: wl.desired_tier, backupTier: wl.backup_tier, status: wl.status } : null,
                };
                throw err;
            }
        }
        // Create or update lane session
        const existingSession = await client.query(`SELECT id, status FROM lane_sessions WHERE lane_id = $1 AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER') ORDER BY created_at DESC LIMIT 1`, [laneId]);
        let session;
        if (computedMode === 'RENEWAL' && !activeRentalType)
            throw new HttpError_1.HttpError(400, 'Unable to determine rental type for renewal');
        const desiredRentalTypeForSession = computedMode === 'RENEWAL' && activeRentalType ? activeRentalType : null;
        const selectionConfirmedForSession = computedMode === 'RENEWAL';
        const selectionConfirmedByForSession = computedMode === 'RENEWAL' ? 'EMPLOYEE' : null;
        const selectionLockedAtForSession = computedMode === 'RENEWAL' ? new Date() : null;
        const flowStepForSession = computedMode === 'RENEWAL' ? 'PAYMENT' : 'RENTAL';
        if (existingSession.rows.length > 0 && existingSession.rows[0].status !== 'COMPLETED') {
            const updateResult = await client.query(`UPDATE lane_sessions SET customer_display_name = $1, membership_number = $2, customer_id = $3, status = 'ACTIVE',
         staff_id = $4, checkin_mode = $5, renewal_hours = $6, desired_rental_type = $8,
         waitlist_desired_type = NULL, waitlist_desired_types_json = NULL, backup_rental_type = NULL,
         waitlist_requested_resource_number = NULL, waitlist_requested_resource_type = NULL,
         assigned_resource_id = NULL, assigned_resource_type = NULL, membership_choice = NULL,
         membership_purchase_intent = NULL, membership_purchase_requested_at = NULL,
         payment_intent_id = NULL, price_quote_json = NULL, disclaimers_ack_json = NULL,
         kiosk_acknowledged_at = NULL, proposed_rental_type = NULL, proposed_by = NULL,
         selection_confirmed = $9, selection_confirmed_by = $10, selection_locked_at = $11,
         flow_step = $12, flow_version = 0, updated_at = NOW()
         WHERE id = $7 RETURNING *`, [customerName, membershipNumber, customerId, staff.staffId, computedMode, renewalHoursForSession,
                existingSession.rows[0].id, desiredRentalTypeForSession,
                selectionConfirmedForSession, selectionConfirmedByForSession, selectionLockedAtForSession, flowStepForSession]);
            session = updateResult.rows[0];
        }
        else {
            const newSessionResult = await client.query(`INSERT INTO lane_sessions (lane_id, status, staff_id, customer_id, customer_display_name, membership_number,
         checkin_mode, renewal_hours, desired_rental_type, assigned_resource_id, assigned_resource_type,
         membership_choice, selection_confirmed, selection_confirmed_by, selection_locked_at, flow_step, flow_version)
         VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NULL, $9, $10, $11, $12, 0) RETURNING *`, [laneId, staff.staffId, customerId, customerName, membershipNumber, computedMode, renewalHoursForSession,
                desiredRentalTypeForSession, selectionConfirmedForSession, selectionConfirmedByForSession, selectionLockedAtForSession, flowStepForSession]);
            session = newSessionResult.rows[0];
        }
        const allowedRentals = (0, payload_1.getAllowedRentals)(membershipNumber);
        // Customer past-due + membership info
        let pastDueBalance = 0;
        let pastDueBlocked = false;
        let customerMembershipValidUntil;
        let ledgerLineItems;
        let ledgerTotal;
        if (session.customer_id) {
            const customerInfo = await client.query(`SELECT past_due_balance, membership_card_type, membership_valid_until FROM customers WHERE id = $1`, [session.customer_id]);
            if (customerInfo.rows.length > 0) {
                const cust = customerInfo.rows[0];
                pastDueBalance = Number.parseFloat(String(cust.past_due_balance || 0));
                pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
                const mCardType = cust.membership_card_type;
                const mValidUntil = (0, utils_1.toDate)(cust.membership_valid_until);
                const hasMembership = !!membershipNumber || (mCardType === 'SIX_MONTH' && mValidUntil != null && new Date() <= mValidUntil);
                if (mValidUntil)
                    customerMembershipValidUntil = mValidUntil.toISOString().slice(0, 10);
                if (!hasMembership && computedMode === 'CHECKIN') {
                    ledgerLineItems = [{ description: 'Membership Fee', amount: 13 }];
                    ledgerTotal = 13;
                }
            }
        }
        return {
            sessionId: session.id,
            customerId,
            customerName: session.customer_display_name ?? customerName,
            membershipNumber: session.membership_number,
            allowedRentals,
            mode: computedMode,
            blockEndsAt: (0, utils_1.toDate)(blockEndsAtDate)?.toISOString(),
            visitId: visitIdForSession || undefined,
            currentTotalHours: computedMode === 'RENEWAL' ? currentTotalHours : undefined,
            renewalHours: renewalHoursForSession ?? undefined,
            pastDueBalance,
            pastDueBlocked,
            activeAssignedResourceType: activeAssignedResourceType || undefined,
            activeAssignedResourceNumber: activeAssignedResourceNumber || undefined,
            activeRentalType: activeRentalType || undefined,
            customerHasEncryptedLookupMarker,
            idScanIssue,
            customerMembershipValidUntil,
            ledgerLineItems,
            ledgerTotal,
        };
    });
}
/**
 * Log the CHECKIN_STARTED activity + club event (best-effort, called after successful start).
 */
async function logCheckinStarted(sessionId, customerId, customerName, mode, visitId, laneId, staff) {
    await (0, db_1.transaction)(async (client) => {
        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
            customerId, actionType: 'CHECKIN_STARTED', actionCategory: 'CHECKIN',
            sourceApp: 'EMPLOYEE_REGISTER', actorType: 'STAFF',
            actorStaffId: staff.staffId, actorStaffName: staff.staffName,
            summary: 'Check-in started',
            metadata: { laneId, laneSessionId: sessionId, mode, visitId: visitId ?? null },
            dedupeKey: `ACT:CHECKIN_STARTED:${sessionId}`,
            searchParts: [sessionId, visitId ?? ''],
        });
        await (0, clubEventLog_1.insertClubEvent)(client, {
            eventType: 'CHECKIN_STARTED', eventDomain: 'CHECKIN', sourceApp: 'EMPLOYEE_REGISTER',
            staffId: staff.staffId, staffName: staff.staffName,
            customerId, customerName, visitId: visitId ?? null,
            summary: `Check-in started for ${customerName}`,
            metadata: { laneId, laneSessionId: sessionId, mode, visitId: visitId ?? null },
            dedupeKey: `CLUB:CHECKIN_STARTED:${sessionId}`,
        });
    });
}
/**
 * Build the full session snapshot payload for broadcasting.
 */
async function getSessionSnapshot(sessionId) {
    return (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, sessionId));
}
/**
 * Find the latest active-ish or completed session for a lane (for kiosk polling).
 */
async function getLaneSessionSnapshot(laneId) {
    return (0, db_1.transaction)(async (client) => {
        const row = (await client.query(`SELECT id FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE') ORDER BY created_at DESC LIMIT 1`, [laneId])).rows[0];
        const completedRow = row ?? (await client.query(`SELECT id FROM lane_sessions WHERE lane_id = $1 AND status = 'COMPLETED' AND (customer_id IS NOT NULL OR customer_display_name IS NOT NULL) ORDER BY updated_at DESC LIMIT 1`, [laneId])).rows[0];
        if (!completedRow)
            return { session: null };
        const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(client, completedRow.id);
        return { session: payload };
    });
}
