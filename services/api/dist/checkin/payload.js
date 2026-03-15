"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllowedRentals = getAllowedRentals;
exports.buildFullSessionUpdatedPayload = buildFullSessionUpdatedPayload;
const identity_1 = require("./identity");
const types_1 = require("./types");
const utils_1 = require("./utils");
const engine_1 = require("../pricing/engine");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function extractWaitlistDesiredTypes(raw) {
    if (raw == null)
        return undefined;
    let parsed = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return undefined;
        }
    }
    if (!Array.isArray(parsed))
        return undefined;
    const values = parsed.filter((item) => typeof item === 'string' && item.length > 0);
    return values.length > 0 ? values : undefined;
}
function extractPaymentLineItems(raw) {
    if (raw === null || raw === undefined)
        return undefined;
    let parsed = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return undefined;
        }
    }
    if (!isRecord(parsed))
        return undefined;
    const items = parsed['lineItems'];
    if (!Array.isArray(items))
        return undefined;
    const normalized = [];
    for (const it of items) {
        if (!isRecord(it))
            continue;
        const description = it['description'];
        const amount = (0, utils_1.toNumber)(it['amount']);
        if (typeof description !== 'string' || amount === undefined)
            continue;
        normalized.push({ description, amount });
    }
    return normalized.length > 0 ? normalized : undefined;
}
function formatChargeDescription(type) {
    switch (type) {
        case 'UPGRADE_FEE':
            return 'Upgrade Fee';
        case 'LATE_FEE':
            return 'Late Fee';
        default:
            return type.replaceAll('_', ' ');
    }
}
function normalizeCustomerIdType(value) {
    if (value === 'STATE_ID' || value === 'DRIVERS_LICENSE' || value === 'PASSPORT') {
        return value;
    }
    if (value === 'OTHER')
        return 'OTHER';
    return undefined;
}
function isGymLockerEligible(membershipNumber) {
    if (!membershipNumber) {
        return false;
    }
    const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
    if (!rangesEnv.trim()) {
        return false;
    }
    const membershipNum = Number.parseInt(membershipNumber, 10);
    if (Number.isNaN(membershipNum)) {
        return false;
    }
    const ranges = rangesEnv
        .split(',')
        .map((range) => range.trim())
        .filter(Boolean);
    for (const range of ranges) {
        const [startStr, endStr] = range.split('-').map((s) => s.trim());
        const start = Number.parseInt(startStr || '', 10);
        const end = Number.parseInt(endStr || '', 10);
        if (!Number.isNaN(start) && !Number.isNaN(end) && membershipNum >= start && membershipNum <= end) {
            return true;
        }
    }
    return false;
}
function getAllowedRentals(membershipNumber) {
    const allowed = ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'];
    if (isGymLockerEligible(membershipNumber)) {
        allowed.push('GYM_LOCKER');
    }
    return allowed;
}
/**
 * Build the full session snapshot payload for broadcasting.
 *
 * Standalone — uses db.execute(sql) internally (no PoolClient needed).
 */
async function buildFullSessionUpdatedPayload(sessionId) {
    const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`);
    if (sessionResult.rows.length === 0) {
        throw new Error(`Lane session not found: ${sessionId}`);
    }
    const session = sessionResult.rows[0];
    const laneId = session.lane_id;
    let customer;
    if (session.customer_id) {
        const custResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, id_number, id_expiration_date, id_type, id_type_other, past_due_balance, primary_language, id_scan_hash
           FROM customers
           WHERE id = ${session.customer_id}
           LIMIT 1`);
        customer = custResult.rows[0];
    }
    const membershipNumber = customer?.membership_number || session.membership_number || undefined;
    const allowedRentals = getAllowedRentals(membershipNumber);
    const pastDueBalance = (0, utils_1.toNumber)(customer?.past_due_balance) || 0;
    const pastDueBypassed = !!session.past_due_bypassed;
    const pastDueBlocked = pastDueBalance > 0 && !pastDueBypassed;
    let customerDobMonthDay;
    const customerDob = (0, utils_1.toDate)(customer?.dob);
    if (customerDob) {
        customerDobMonthDay = `${String(customerDob.getUTCMonth() + 1).padStart(2, '0')}/${String(customerDob.getUTCDate()).padStart(2, '0')}`;
    }
    let customerLastVisitAt;
    if (session.customer_id) {
        const lastVisitResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT cb.starts_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.customer_id = ${session.customer_id}
       ORDER BY cb.starts_at DESC
       LIMIT 1`);
        if (lastVisitResult.rows.length > 0) {
            customerLastVisitAt = (0, utils_1.toDate)(lastVisitResult.rows[0].starts_at)?.toISOString();
        }
    }
    const customerHasEncryptedLookupMarker = Boolean(customer?.id_scan_hash);
    const idScanIssue = customer
        ? (0, identity_1.getIdScanIssue)({
            dob: customer.dob,
            idExpirationDate: customer.id_expiration_date ?? null,
        })
        : undefined;
    const customerIdExpirationDate = customer?.id_expiration_date
        ? ((0, utils_1.toDate)(customer.id_expiration_date)?.toISOString().slice(0, 10) ?? String(customer.id_expiration_date).slice(0, 10))
        : undefined;
    const customerIdType = normalizeCustomerIdType(customer?.id_type);
    const customerIdTypeOther = customer?.id_type_other ?? undefined;
    // Prefer a check-in block created by this lane session (when completed)
    const blockForSessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT visit_id, ends_at, agreement_signed
       FROM checkin_blocks
       WHERE session_id = ${session.id}
       ORDER BY created_at DESC
       LIMIT 1`);
    const blockForSession = blockForSessionResult.rows[0];
    // Active visit info (useful for RENEWAL mode pre-completion)
    let activeVisitId;
    let activeBlockEndsAt;
    if (session.customer_id) {
        const activeVisitResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT v.id as visit_id, cb.ends_at
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = ${session.customer_id} AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1`);
        if (activeVisitResult.rows.length > 0) {
            activeVisitId = activeVisitResult.rows[0].visit_id;
            activeBlockEndsAt = (0, utils_1.toDate)(activeVisitResult.rows[0].ends_at)?.toISOString() ?? String(activeVisitResult.rows[0].ends_at);
        }
    }
    const assignedResourceType = session.assigned_resource_type;
    const assignedResourceNumber = await fetchAssignedResourceNumber(assignedResourceType, session.assigned_resource_id);
    let paymentIntent;
    if (session.order_id) {
        const intentResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`);
        paymentIntent = intentResult.rows[0];
    }
    else {
        const intentResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders
       WHERE lane_session_id = ${session.id}
       ORDER BY created_at DESC
       LIMIT 1`);
        paymentIntent = intentResult.rows[0];
    }
    const paymentTotalRaw = (0, utils_1.toNumber)(paymentIntent?.total);
    const paymentTotal = paymentTotalRaw ?? undefined;
    const paymentLineItems = extractPaymentLineItems(session.price_quote_json) ??
        extractPaymentLineItems(paymentIntent?.quote_json);
    const { ledgerItems, total } = await buildLedgerLineItems(session, customer, pastDueBalance, paymentLineItems, blockForSession?.visit_id || activeVisitId);
    const ledgerLineItems = ledgerItems.length > 0 ? ledgerItems : undefined;
    const ledgerTotal = total > 0 ? total : undefined;
    const membershipValidUntilRaw = customer?.membership_valid_until;
    let customerMembershipValidUntil;
    if (membershipValidUntilRaw instanceof Date) {
        customerMembershipValidUntil = membershipValidUntilRaw.toISOString().slice(0, 10);
    }
    else if (typeof membershipValidUntilRaw === 'string') {
        customerMembershipValidUntil = membershipValidUntilRaw;
    }
    const { waitlistPosition, waitlistEstimatedReadyAt } = await fetchWaitlistEstimates(session.waitlist_desired_type, session.waitlist_desired_types_json);
    const payload = {
        sessionId: session.id,
        customerId: session.customer_id ?? undefined,
        customerName: customer?.name || session.customer_display_name || '',
        membershipNumber,
        customerMembershipValidUntil,
        membershipChoice: session.membership_choice ?? null,
        membershipPurchaseIntent: session.membership_purchase_intent || undefined,
        kioskAcknowledgedAt: session.kiosk_acknowledged_at
            ? ((0, utils_1.toDate)(session.kiosk_acknowledged_at)?.toISOString() ?? String(session.kiosk_acknowledged_at))
            : undefined,
        allowedRentals,
        mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
        status: session.status,
        proposedRentalType: session.proposed_rental_type || undefined,
        proposedBy: session.proposed_by || undefined,
        selectionConfirmed: !!session.selection_confirmed,
        selectionConfirmedBy: session.selection_confirmed_by || undefined,
        customerPrimaryLanguage: customer?.primary_language || undefined,
        customerDob: customer?.dob ? ((0, utils_1.toDate)(customer.dob)?.toISOString().slice(0, 10) ?? String(customer.dob).slice(0, 10)) : undefined,
        customerDobMonthDay,
        customerIdNumber: customer?.id_number ?? undefined,
        customerLastVisitAt,
        customerIdExpirationDate,
        customerIdType,
        customerIdTypeOther,
        customerHasEncryptedLookupMarker,
        idScanIssue,
        pastDueBalance: pastDueBalance > 0 ? pastDueBalance : undefined,
        pastDueBlocked,
        pastDueBypassed,
        orderId: paymentIntent?.id,
        orderStatus: paymentIntent?.status || undefined,
        paymentMethod: paymentIntent?.payment_method || undefined,
        paymentTotal,
        paymentLineItems,
        paymentFailureReason: paymentIntent?.failure_reason || undefined,
        agreementSigned: blockForSession ? !!blockForSession.agreement_signed : false,
        agreementBypassPending: !!session.agreement_bypass_pending,
        agreementSignedMethod: session.agreement_signed_method === 'MANUAL' || session.agreement_signed_method === 'DIGITAL'
            ? session.agreement_signed_method
            : undefined,
        assignedResourceType: assignedResourceType || undefined,
        assignedResourceNumber,
        visitId: blockForSession?.visit_id || activeVisitId,
        waitlistDesiredType: session.waitlist_desired_type || undefined,
        waitlistDesiredTypes: extractWaitlistDesiredTypes(session.waitlist_desired_types_json),
        backupRentalType: session.backup_rental_type || undefined,
        waitlistRequestedResourceNumber: session.waitlist_requested_resource_number || undefined,
        waitlistRequestedResourceType: session.waitlist_requested_resource_type || undefined,
        waitlistPosition,
        waitlistEstimatedReadyAt,
        blockEndsAt: blockForSession?.ends_at
            ? ((0, utils_1.toDate)(blockForSession.ends_at)?.toISOString() ?? String(blockForSession.ends_at))
            : activeBlockEndsAt,
        checkoutAt: blockForSession?.ends_at ? ((0, utils_1.toDate)(blockForSession.ends_at)?.toISOString() ?? String(blockForSession.ends_at)) : undefined,
        renewalHours: session.renewal_hours === 2 || session.renewal_hours === 6
            ? session.renewal_hours
            : undefined,
        ledgerLineItems,
        ledgerTotal,
        flowStep: session.flow_step === 'LANGUAGE' ||
            session.flow_step === 'RENTAL' ||
            session.flow_step === 'WAITLIST_PREFERENCES' ||
            session.flow_step === 'WAITLIST_BACKUP' ||
            session.flow_step === 'WAITLIST_DISCLAIMER' ||
            session.flow_step === 'PAYMENT' ||
            session.flow_step === 'AGREEMENT' ||
            session.flow_step === 'ASSIGNMENT' ||
            session.flow_step === 'COMPLETE'
            ? session.flow_step
            : undefined,
        flowVersion: typeof session.flow_version === 'number' ? session.flow_version : undefined,
        flowLastActor: session.flow_last_actor
            ? session.flow_last_actor
            : undefined,
        flowLastCommandId: session.flow_last_command_id ?? undefined,
    };
    return { laneId, payload };
}
async function buildLedgerLineItems(session, customer, pastDueBalance, paymentLineItems, checkinVisitId) {
    const ledgerItems = [];
    let total = 0;
    if (session.checkin_mode === 'RENEWAL') {
        if (checkinVisitId) {
            const paidIntents = await db_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT o.quote_json, o.total as amount
         FROM orders o
         JOIN lane_sessions ls ON ls.id = o.lane_session_id
         JOIN checkin_blocks cb ON cb.session_id = ls.id
         WHERE cb.visit_id = ${checkinVisitId}
           AND o.status = 'PAID'
           AND o.paid_at >= date_trunc('day', NOW())
      `);
            for (const intent of paidIntents.rows) {
                const items = extractPaymentLineItems(intent.quote_json);
                if (items && items.length > 0) {
                    for (const item of items) {
                        ledgerItems.push(item);
                        total += item.amount;
                    }
                    continue;
                }
                const amount = (0, utils_1.toNumber)(intent.amount);
                if (amount !== undefined) {
                    ledgerItems.push({ description: 'Check-in', amount });
                    total += amount;
                }
            }
            const charges = await db_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT oli.kind as type, oli.total as amount
         FROM order_line_items oli
         JOIN orders o ON o.id = oli.order_id
         JOIN lane_sessions ls ON ls.id = o.lane_session_id
         JOIN checkin_blocks cb ON cb.session_id = ls.id
         WHERE cb.visit_id = ${checkinVisitId}
           AND oli.kind IN ('CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION', 'UPGRADE', 'LATE_FEE')
           AND o.created_at >= date_trunc('day', NOW())
      `);
            for (const charge of charges.rows) {
                const amount = (0, utils_1.toNumber)(charge.amount);
                if (amount === undefined)
                    continue;
                ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
                total += amount;
            }
        }
    }
    else if (session.checkin_mode === 'CHECKIN') {
        if (pastDueBalance > 0) {
            ledgerItems.push({ description: 'Past Due Balance', amount: pastDueBalance });
            total += pastDueBalance;
        }
        if (paymentLineItems) {
            for (const item of paymentLineItems) {
                ledgerItems.push(item);
                total += item.amount;
            }
        }
        else {
            const membershipCardType = customer?.membership_card_type;
            const membershipValidUntilRaw = (0, utils_1.toDate)(customer?.membership_valid_until);
            const membershipNumber = customer?.membership_number || session.membership_number;
            const hasMembership = !!membershipNumber ||
                (membershipCardType === 'SIX_MONTH' &&
                    membershipValidUntilRaw != null &&
                    new Date() <= membershipValidUntilRaw);
            if (!hasMembership) {
                if (session.membership_choice === 'SIX_MONTH') {
                    ledgerItems.push({ description: '6-Month Membership', amount: 43 });
                    total += 43;
                }
                else {
                    ledgerItems.push({ description: 'Membership Fee', amount: 13 });
                    total += 13;
                }
            }
            const isWaitlisted = !!session.waitlist_desired_type;
            const rentalType = isWaitlisted ? session.backup_rental_type : session.proposed_rental_type;
            if (rentalType && (session.selection_confirmed || isWaitlisted)) {
                const rentalLabel = {
                    LOCKER: 'Locker',
                    STANDARD: 'Standard Room',
                    DOUBLE: 'Double Room',
                    SPECIAL: 'Special Room',
                    GYM_LOCKER: 'Gym Locker',
                };
                // Use the real pricing engine instead of hardcoded prices
                const customerAge = customer?.dob
                    ? Math.floor((Date.now() - new Date(customer.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                    : undefined;
                const estimate = (0, engine_1.calculatePriceQuote)({
                    rentalType: rentalType,
                    customerAge,
                    checkInTime: new Date(),
                    membershipCardType: customer?.membership_card_type,
                    membershipValidUntil: (0, utils_1.toDate)(customer?.membership_valid_until) || undefined,
                    includeSixMonthMembershipPurchase: session.membership_choice === 'SIX_MONTH',
                });
                const label = rentalLabel[rentalType] ?? rentalType;
                const price = estimate.rentalFee;
                if (price > 0) {
                    ledgerItems.push({ description: label, amount: price });
                    total += price;
                }
                if (isWaitlisted && session.waitlist_desired_type) {
                    const desiredLabel = rentalLabel[session.waitlist_desired_type] ?? session.waitlist_desired_type;
                    ledgerItems.push({ description: `${desiredLabel} (waitlist)`, amount: 0 });
                }
            }
        }
        if (checkinVisitId) {
            const charges = await db_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT oli.kind as type, oli.total as amount
         FROM order_line_items oli
         JOIN orders o ON o.id = oli.order_id
         JOIN lane_sessions ls ON ls.id = o.lane_session_id
         JOIN checkin_blocks cb ON cb.session_id = ls.id
         WHERE cb.visit_id = ${checkinVisitId}
           AND oli.kind IN ('CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION', 'UPGRADE', 'LATE_FEE')
           AND o.created_at >= date_trunc('day', NOW())
      `);
            for (const charge of charges.rows) {
                const amount = (0, utils_1.toNumber)(charge.amount);
                if (amount === undefined)
                    continue;
                ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
                total += amount;
            }
        }
        // Retail items added to ledger via orders linked to this session
        const retailItems = await db_1.db.execute((0, drizzle_orm_1.sql) `
      SELECT oli.name, oli.total
       FROM order_line_items oli
       JOIN orders o ON o.id = oli.order_id
       WHERE o.metadata_json->>'laneSessionId' = ${session.id}
         AND o.status = 'OPEN'
    `);
        for (const item of retailItems.rows) {
            const amount = (0, utils_1.toNumber)(item.total);
            if (amount === undefined)
                continue;
            ledgerItems.push({ description: item.name, amount });
            total += amount;
        }
    }
    return { ledgerItems, total };
}
async function fetchAssignedResourceNumber(resourceType, resourceId) {
    if (!resourceId || !resourceType)
        return undefined;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT number FROM inventory_resources WHERE id = ${resourceId} LIMIT 1`);
    return result.rows[0]?.number;
}
async function fetchWaitlistEstimates(desiredType, desiredTypesJson) {
    if (!desiredType)
        return {};
    const allDesiredTypes = extractWaitlistDesiredTypes(desiredTypesJson) || [desiredType];
    const queueLengthResult = await db_1.db.execute((0, drizzle_orm_1.sql) `
    SELECT COUNT(*) as count 
     FROM waitlist
     WHERE status IN ('ACTIVE', 'OFFERED')
     AND desired_tier IN (${drizzle_orm_1.sql.join(allDesiredTypes.map(t => (0, drizzle_orm_1.sql) `${t}::rental_type`), (0, drizzle_orm_1.sql) `, `)})
  `);
    const baseQueueLength = Number.parseInt(queueLengthResult.rows[0]?.count || '0', 10);
    const waitlistPosition = baseQueueLength + 1; // Simplistic approximation for new entries
    const estimatedWaitMinutes = waitlistPosition * 20;
    const readyAt = new Date(Date.now() + estimatedWaitMinutes * 60000);
    return {
        waitlistPosition,
        waitlistEstimatedReadyAt: readyAt.toISOString()
    };
}
