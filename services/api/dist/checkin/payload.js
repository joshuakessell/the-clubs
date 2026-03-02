"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllowedRentals = getAllowedRentals;
exports.buildFullSessionUpdatedPayload = buildFullSessionUpdatedPayload;
const identity_1 = require("./identity");
const utils_1 = require("./utils");
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
            return type.replace(/_/g, ' ');
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
    const membershipNum = parseInt(membershipNumber, 10);
    if (isNaN(membershipNum)) {
        return false;
    }
    const ranges = rangesEnv
        .split(',')
        .map((range) => range.trim())
        .filter(Boolean);
    for (const range of ranges) {
        const [startStr, endStr] = range.split('-').map((s) => s.trim());
        const start = parseInt(startStr || '', 10);
        const end = parseInt(endStr || '', 10);
        if (!isNaN(start) && !isNaN(end) && membershipNum >= start && membershipNum <= end) {
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
async function buildFullSessionUpdatedPayload(client, sessionId) {
    const sessionResult = await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId]);
    if (sessionResult.rows.length === 0) {
        throw new Error(`Lane session not found: ${sessionId}`);
    }
    const session = sessionResult.rows[0];
    const laneId = session.lane_id;
    const customer = session.customer_id
        ? (await client.query(`SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, id_number, id_expiration_date, id_type, id_type_other, past_due_balance, primary_language, id_scan_hash
             FROM customers
             WHERE id = $1
             LIMIT 1`, [session.customer_id])).rows[0]
        : undefined;
    const membershipNumber = customer?.membership_number || session.membership_number || undefined;
    const allowedRentals = getAllowedRentals(membershipNumber);
    const pastDueBalance = (0, utils_1.toNumber)(customer?.past_due_balance) || 0;
    const pastDueBypassed = !!session.past_due_bypassed;
    const pastDueBlocked = pastDueBalance > 0 && !pastDueBypassed;
    let customerDobMonthDay;
    const customerDob = (0, utils_1.toDate)(customer?.dob);
    if (customerDob) {
        customerDobMonthDay = `${String(customerDob.getMonth() + 1).padStart(2, '0')}/${String(customerDob.getDate()).padStart(2, '0')}`;
    }
    let customerLastVisitAt;
    if (session.customer_id) {
        const lastVisitResult = await client.query(`SELECT cb.starts_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.customer_id = $1
       ORDER BY cb.starts_at DESC
       LIMIT 1`, [session.customer_id]);
        if (lastVisitResult.rows.length > 0) {
            customerLastVisitAt = lastVisitResult.rows[0].starts_at.toISOString();
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
        ? customer.id_expiration_date.toISOString().slice(0, 10)
        : undefined;
    const customerIdType = normalizeCustomerIdType(customer?.id_type);
    const customerIdTypeOther = customer?.id_type_other ?? undefined;
    // Prefer a check-in block created by this lane session (when completed)
    const blockForSession = (await client.query(`SELECT visit_id, ends_at, agreement_signed
       FROM checkin_blocks
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`, [session.id])).rows[0];
    // Active visit info (useful for RENEWAL mode pre-completion)
    let activeVisitId;
    let activeBlockEndsAt;
    if (session.customer_id) {
        const activeVisitResult = await client.query(`SELECT v.id as visit_id, cb.ends_at
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = $1 AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1`, [session.customer_id]);
        if (activeVisitResult.rows.length > 0) {
            activeVisitId = activeVisitResult.rows[0].visit_id;
            activeBlockEndsAt = activeVisitResult.rows[0].ends_at.toISOString();
        }
    }
    let assignedResourceType = session.assigned_resource_type;
    let assignedResourceNumber;
    if (session.assigned_resource_id && assignedResourceType) {
        if (assignedResourceType === 'room') {
            const roomResult = await client.query(`SELECT number FROM rooms WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
            assignedResourceNumber = roomResult.rows[0]?.number;
        }
        else if (assignedResourceType === 'locker') {
            const lockerResult = await client.query(`SELECT number FROM lockers WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
            assignedResourceNumber = lockerResult.rows[0]?.number;
        }
    }
    // Payment intent: prefer the one pinned on the session, otherwise latest for session
    let paymentIntent;
    if (session.payment_intent_id) {
        const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [session.payment_intent_id]);
        paymentIntent = intentResult.rows[0];
    }
    else {
        const intentResult = await client.query(`SELECT * FROM payment_intents
       WHERE lane_session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`, [session.id]);
        paymentIntent = intentResult.rows[0];
    }
    const paymentTotal = (0, utils_1.toNumber)(paymentIntent?.amount);
    const paymentLineItems = extractPaymentLineItems(session.price_quote_json) ??
        extractPaymentLineItems(paymentIntent?.quote_json);
    let ledgerLineItems;
    let ledgerTotal;
    if (session.checkin_mode === 'RENEWAL') {
        const ledgerVisitId = blockForSession?.visit_id || activeVisitId;
        if (ledgerVisitId) {
            const ledgerItems = [];
            let total = 0;
            const paidIntents = await client.query(`SELECT pi.quote_json, pi.amount
         FROM payment_intents pi
         JOIN lane_sessions ls ON ls.id = pi.lane_session_id
         JOIN checkin_blocks cb ON cb.session_id = ls.id
         WHERE cb.visit_id = $1
           AND pi.status = 'PAID'
           AND pi.paid_at >= date_trunc('day', NOW())`, [ledgerVisitId]);
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
            const charges = await client.query(`SELECT type, amount
         FROM charges
         WHERE visit_id = $1
           AND created_at >= date_trunc('day', NOW())`, [ledgerVisitId]);
            for (const charge of charges.rows) {
                const amount = (0, utils_1.toNumber)(charge.amount);
                if (amount === undefined)
                    continue;
                ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
                total += amount;
            }
            ledgerLineItems = ledgerItems;
            ledgerTotal = total;
        }
    }
    else if (session.checkin_mode === 'CHECKIN') {
        // Build ledger line items for new check-ins (all non-terminal statuses):
        //   1. Past Due Balance (if any)
        //   2. Membership Fee (for non-members)
        //   3. Rental Cost (when rental type is selected)
        //   4. DB charges (upgrade fees, late fees, etc.)
        const items = [];
        let total = 0;
        // 1. Past Due Balance (already in dollars from DB)
        if (pastDueBalance > 0) {
            items.push({ description: 'Past Due Balance', amount: pastDueBalance });
            total += pastDueBalance;
        }
        if (paymentLineItems) {
            for (const item of paymentLineItems) {
                items.push(item);
                total += item.amount;
            }
        }
        else {
            // 2. Membership Fee (non-members only)
            const membershipCardType = customer?.membership_card_type;
            const membershipValidUntilRaw = (0, utils_1.toDate)(customer?.membership_valid_until);
            const hasMembership = !!membershipNumber ||
                (membershipCardType === 'SIX_MONTH' &&
                    membershipValidUntilRaw != null &&
                    new Date() <= membershipValidUntilRaw);
            if (!hasMembership) {
                if (session.membership_choice === 'SIX_MONTH') {
                    items.push({ description: '6-Month Membership', amount: 43 });
                    total += 43;
                }
                else {
                    items.push({ description: 'Membership Fee', amount: 13 });
                    total += 13;
                }
            }
            // 3. Rental Cost (simplified preview price — exact price at payment time)
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
                // Simplified base prices in dollars (weekday non-discount defaults)
                const rentalPrice = {
                    LOCKER: 17,
                    STANDARD: 30,
                    DOUBLE: 40,
                    SPECIAL: 50,
                    GYM_LOCKER: 0,
                };
                const label = rentalLabel[rentalType] ?? rentalType;
                const price = rentalPrice[rentalType] ?? 0;
                if (price > 0) {
                    items.push({ description: label, amount: price });
                    total += price;
                }
            }
        }
        // 4. DB charges (upgrade fees, late fees, etc.) for this visit
        const checkinVisitId = blockForSession?.visit_id || activeVisitId;
        if (checkinVisitId) {
            const charges = await client.query(`SELECT type, amount
         FROM charges
         WHERE visit_id = $1
           AND created_at >= date_trunc('day', NOW())`, [checkinVisitId]);
            for (const charge of charges.rows) {
                const amount = (0, utils_1.toNumber)(charge.amount);
                if (amount === undefined)
                    continue;
                items.push({ description: formatChargeDescription(charge.type), amount });
                total += amount;
            }
        }
        if (items.length > 0) {
            ledgerLineItems = items;
            ledgerTotal = total;
        }
    }
    const membershipValidUntilRaw = customer?.membership_valid_until;
    const customerMembershipValidUntil = membershipValidUntilRaw instanceof Date
        ? membershipValidUntilRaw.toISOString().slice(0, 10)
        : typeof membershipValidUntilRaw === 'string'
            ? membershipValidUntilRaw
            : undefined;
    let waitlistPosition;
    let waitlistEstimatedReadyAt;
    if (session.waitlist_desired_type) {
        const allDesiredTypes = extractWaitlistDesiredTypes(session.waitlist_desired_types_json) || [session.waitlist_desired_type];
        const queueLengthResult = await client.query(`SELECT COUNT(*) as count 
       FROM waitlist
       WHERE status IN ('ACTIVE', 'OFFERED')
       AND desired_tier = ANY($1::text[])`, [allDesiredTypes]);
        const baseQueueLength = parseInt(queueLengthResult.rows[0]?.count || '0', 10);
        waitlistPosition = baseQueueLength + 1; // Simplistic approximation for new entries
        // Estimate: 20 mins per person in line
        const estimatedWaitMinutes = waitlistPosition * 20;
        const readyAt = new Date(Date.now() + estimatedWaitMinutes * 60000);
        waitlistEstimatedReadyAt = readyAt.toISOString();
    }
    const payload = {
        sessionId: session.id,
        customerId: session.customer_id ?? undefined,
        customerName: customer?.name || session.customer_display_name || '',
        membershipNumber,
        customerMembershipValidUntil,
        membershipChoice: session.membership_choice ?? null,
        membershipPurchaseIntent: session.membership_purchase_intent || undefined,
        kioskAcknowledgedAt: session.kiosk_acknowledged_at
            ? session.kiosk_acknowledged_at.toISOString()
            : undefined,
        allowedRentals,
        mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
        status: session.status,
        proposedRentalType: session.proposed_rental_type || undefined,
        proposedBy: session.proposed_by || undefined,
        selectionConfirmed: !!session.selection_confirmed,
        selectionConfirmedBy: session.selection_confirmed_by || undefined,
        customerPrimaryLanguage: customer?.primary_language || undefined,
        customerDob: customer?.dob ? customer.dob.toISOString().slice(0, 10) : undefined,
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
        paymentIntentId: paymentIntent?.id,
        paymentStatus: paymentIntent?.status || undefined,
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
            ? blockForSession.ends_at.toISOString()
            : activeBlockEndsAt,
        checkoutAt: blockForSession?.ends_at ? blockForSession.ends_at.toISOString() : undefined,
        renewalHours: session.renewal_hours === 2 || session.renewal_hours === 6
            ? session.renewal_hours
            : undefined,
        ledgerLineItems,
        ledgerTotal,
        flowStep: session.flow_step === 'LANGUAGE' ||
            session.flow_step === 'RENTAL' ||
            session.flow_step === 'WAITLIST_PREFERENCES' ||
            session.flow_step === 'WAITLIST_BACKUP' ||
            session.flow_step === 'PAYMENT' ||
            session.flow_step === 'AGREEMENT' ||
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
