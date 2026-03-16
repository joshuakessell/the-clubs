"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinFlowCommandRoutes = registerCheckinFlowCommandRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const types_1 = require("../../checkin/types");
const payload_1 = require("../../checkin/payload");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const engine_1 = require("../../pricing/engine");
const identity_1 = require("../../checkin/identity");
const utils_1 = require("../../checkin/utils");
const laneFeatureFlags_1 = require("../../checkin/laneFeatureFlags");
const laneAuthority_1 = require("../../checkin/laneAuthority");
const offlineOutbox_1 = require("../../checkin/offlineOutbox");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by getLaneFeatureFlags, assertLaneWriteAuthority, writeOfflineOutboxRecord.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            // Use matchAll to find $N placeholders and their positions
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                // Append the literal text before this placeholder
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                // Parse the placeholder number and map to the correct param
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            // Append any trailing literal text
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
/**
 * Structured error for flow command failures.
 * Extends Error so stack traces, Sentry, and Fastify error hooks work correctly.
 */
class FlowCommandError extends Error {
    statusCode;
    error;
    constructor(statusCode, error, message) {
        super(message);
        this.name = 'FlowCommandError';
        this.statusCode = statusCode;
        this.error = error;
    }
}
const FlowActorSchema = zod_1.z.union([zod_1.z.literal('CUSTOMER'), zod_1.z.literal('EMPLOYEE'), zod_1.z.literal('SYSTEM')]);
const FlowCommandTypeSchema = zod_1.z.union([
    zod_1.z.literal('SET_STEP'),
    zod_1.z.literal('BACK_STEP'),
    zod_1.z.literal('CANCEL_STEP'),
    zod_1.z.literal('PROPOSE_SELECTION'),
    zod_1.z.literal('CONFIRM_SELECTION'),
    zod_1.z.literal('WAITLIST_UPDATE'),
]);
const FlowCommandRequestSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    commandId: zod_1.z.string().uuid(),
    actor: FlowActorSchema,
    expectedFlowVersion: zod_1.z.number().int().nonnegative().optional(),
    type: FlowCommandTypeSchema,
    payload: zod_1.z.record(zod_1.z.unknown()).optional(),
});
const SetStepCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('SET_STEP'),
    payload: zod_1.z.object({
        step: zod_1.z.string().min(1),
        paymentMethod: zod_1.z.string().optional(),
        paymentFailed: zod_1.z.boolean().optional(),
        failureReason: zod_1.z.string().optional(),
        splitCashAmount: zod_1.z.number().optional(),
        splitCreditAmount: zod_1.z.number().optional(),
    }),
});
const BackStepCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('BACK_STEP'),
    payload: zod_1.z.undefined().optional(),
});
const CancelStepCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('CANCEL_STEP'),
    payload: zod_1.z.undefined().optional(),
});
const ProposeSelectionCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('PROPOSE_SELECTION'),
    payload: zod_1.z.object({ rentalType: zod_1.z.string().min(1) }),
});
const ConfirmSelectionCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('CONFIRM_SELECTION'),
    payload: zod_1.z.undefined().optional(),
});
const WaitlistUpdateCommandSchema = FlowCommandRequestSchema.extend({
    type: zod_1.z.literal('WAITLIST_UPDATE'),
    payload: zod_1.z
        .object({
        waitlistDesiredType: zod_1.z.string().min(1).optional(),
        desiredTier: zod_1.z.string().min(1).optional(),
        waitlistDesiredTypes: zod_1.z.array(zod_1.z.string().min(1)).optional(),
        desiredTypes: zod_1.z.array(zod_1.z.string().min(1)).optional(),
        backupRentalType: zod_1.z.string().min(1).optional(),
        backupTier: zod_1.z.string().min(1).optional(),
        waitlistRequestedResourceNumber: zod_1.z.string().min(1).optional(),
        requestedResourceNumber: zod_1.z.string().min(1).optional(),
        waitlistRequestedResourceType: zod_1.z.union([zod_1.z.literal('room'), zod_1.z.literal('locker')]).optional(),
        requestedResourceType: zod_1.z.union([zod_1.z.literal('room'), zod_1.z.literal('locker')]).optional(),
    })
        .refine((p) => Object.keys(p).length > 0, 'WAITLIST_UPDATE payload must include at least one field'),
});
const FlowCommandRequestByTypeSchema = zod_1.z.discriminatedUnion('type', [
    SetStepCommandSchema,
    BackStepCommandSchema.extend({ payload: zod_1.z.record(zod_1.z.unknown()).optional() }),
    CancelStepCommandSchema.extend({ payload: zod_1.z.record(zod_1.z.unknown()).optional() }),
    ProposeSelectionCommandSchema,
    ConfirmSelectionCommandSchema.extend({ payload: zod_1.z.record(zod_1.z.unknown()).optional() }),
    WaitlistUpdateCommandSchema,
]);
const FLOW_STEPS = [
    'RENTAL',
    'WAITLIST_BACKUP',
    'WAITLIST_DISCLAIMER',
    'PAYMENT',
    'AGREEMENT',
    'ASSIGNMENT',
    'COMPLETE',
];
const FLOW_STEP_INDEX = {
    RENTAL: 0,
    WAITLIST_BACKUP: 1,
    WAITLIST_DISCLAIMER: 2,
    PAYMENT: 3,
    AGREEMENT: 4,
    ASSIGNMENT: 5,
    COMPLETE: 6,
};
const ALLOWED_STEP_TRANSITIONS = {
    RENTAL: new Set(['RENTAL', 'WAITLIST_BACKUP', 'PAYMENT']),
    WAITLIST_BACKUP: new Set(['RENTAL', 'WAITLIST_BACKUP', 'WAITLIST_DISCLAIMER', 'PAYMENT']),
    WAITLIST_DISCLAIMER: new Set(['WAITLIST_BACKUP', 'WAITLIST_DISCLAIMER', 'PAYMENT']),
    PAYMENT: new Set(['RENTAL', 'WAITLIST_BACKUP', 'PAYMENT', 'AGREEMENT']),
    AGREEMENT: new Set(['PAYMENT', 'AGREEMENT', 'ASSIGNMENT']),
    ASSIGNMENT: new Set(['AGREEMENT', 'ASSIGNMENT', 'COMPLETE']),
    COMPLETE: new Set(['ASSIGNMENT', 'COMPLETE']),
};
function assertAllowedStepTransition(params) {
    const { currentStep, nextStep, type } = params;
    const currentIndex = FLOW_STEP_INDEX[currentStep];
    const nextIndex = FLOW_STEP_INDEX[nextStep];
    if (type === 'CANCEL_STEP') {
        if (nextStep !== currentStep) {
            throw new FlowCommandError(400, 'InvalidTransition', 'CANCEL_STEP cannot change step');
        }
        return;
    }
    if (type === 'BACK_STEP') {
        const expected = getPreviousFlowStep(currentStep);
        if (nextStep !== expected) {
            throw new FlowCommandError(400, 'InvalidTransition', `BACK_STEP must move to ${expected}`);
        }
        return;
    }
    if (nextStep === currentStep)
        return;
    if (nextIndex < currentIndex)
        return;
    if (ALLOWED_STEP_TRANSITIONS[currentStep].has(nextStep))
        return;
    throw new FlowCommandError(400, 'InvalidTransition', `SET_STEP transition ${currentStep} -> ${nextStep} not allowed`);
}
function assertStepIsValidForFlow(params) {
    const { currentStep, nextStep } = params;
    const currentIndex = FLOW_STEP_INDEX[currentStep];
    const nextIndex = FLOW_STEP_INDEX[nextStep];
    if (nextIndex < currentIndex)
        return;
    const allowed = ALLOWED_STEP_TRANSITIONS[currentStep];
    if (!allowed.has(nextStep)) {
        throw new FlowCommandError(400, 'InvalidTransition', `Transition ${currentStep} -> ${nextStep} is not allowed`);
    }
}
function parseFlowStep(value) {
    if (typeof value !== 'string')
        return null;
    return FLOW_STEPS.includes(value) ? value : null;
}
function getPreviousFlowStep(step) {
    const currentIndex = FLOW_STEPS.indexOf(step);
    if (currentIndex <= 0)
        return FLOW_STEPS[0];
    return FLOW_STEPS[currentIndex - 1];
}
function computeFlowUpdate(input) {
    const { currentStep, type, payload } = input;
    if (type === 'SET_STEP') {
        const requested = parseFlowStep(payload?.['step']);
        if (!requested) {
            throw new FlowCommandError(400, 'InvalidPayload', 'payload.step is required');
        }
        const currentIndex = FLOW_STEPS.indexOf(currentStep);
        const requestedIndex = FLOW_STEPS.indexOf(requested);
        const movingBackwards = requestedIndex < currentIndex;
        const clear = {
            rental: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
            waitlistBackup: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
            paymentIntent: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
            agreement: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
        };
        assertAllowedStepTransition({ currentStep, nextStep: requested, type });
        assertStepIsValidForFlow({ currentStep, nextStep: requested });
        return { nextStep: requested, clear };
    }
    if (type === 'BACK_STEP') {
        const nextStep = getPreviousFlowStep(currentStep);
        assertAllowedStepTransition({ currentStep, nextStep, type });
        assertStepIsValidForFlow({ currentStep, nextStep });
        const requestedIndex = FLOW_STEPS.indexOf(nextStep);
        const clear = {
            rental: requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
            waitlistBackup: requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
            paymentIntent: requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
            agreement: requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
        };
        return { nextStep, clear };
    }
    const noClear = {
        rental: false,
        waitlistBackup: false,
        paymentIntent: false,
        agreement: false,
    };
    if (type === 'PROPOSE_SELECTION' || type === 'CONFIRM_SELECTION') {
        return { nextStep: currentStep, clear: noClear };
    }
    if (type === 'WAITLIST_UPDATE') {
        return { nextStep: currentStep, clear: noClear };
    }
    if (type === 'CANCEL_STEP') {
        const clear = {
            rental: currentStep === 'RENTAL',
            waitlistBackup: currentStep === 'WAITLIST_BACKUP',
            paymentIntent: currentStep === 'PAYMENT',
            agreement: currentStep === 'AGREEMENT',
        };
        return { nextStep: currentStep, clear };
    }
    return { nextStep: currentStep, clear: noClear };
}
async function isFlowCommandsEnabled(params) {
    const flags = await (0, laneFeatureFlags_1.getLaneFeatureFlags)(params.client, params.laneId);
    return flags.flowCommandsEnabled;
}
async function isLanFallbackEnabledForLane(params) {
    if (process.env.LAN_FALLBACK !== 'true')
        return false;
    const flags = await (0, laneFeatureFlags_1.getLaneFeatureFlags)(params.client, params.laneId);
    return flags.lanFallbackEnabled;
}
/**
 * Apply payment-related side effects after a flow command is processed.
 */
async function applyFlowPaymentSideEffects(client, params) {
    const { session, sessionId, type, payload } = params;
    if (session.flow_step === 'PAYMENT' && !session.order_id) {
        let rentalType = (session.desired_rental_type ?? session.proposed_rental_type ?? 'LOCKER');
        if (session.waitlist_desired_type && session.backup_rental_type) {
            rentalType = session.backup_rental_type;
        }
        let customerAge;
        let membershipCardType;
        let membershipValidUntil;
        if (session.customer_id) {
            const custResult = await client.query(`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`, [session.customer_id]);
            if (custResult.rows.length > 0) {
                const cust = custResult.rows[0];
                customerAge = (0, identity_1.calculateAge)(cust.dob);
                membershipCardType = cust.membership_card_type || undefined;
                membershipValidUntil = (0, utils_1.toDate)(cust.membership_valid_until) || undefined;
            }
        }
        const includeSixMonth = session.membership_choice === 'SIX_MONTH' || !!session.membership_purchase_intent;
        const isRenewal = session.checkin_mode === 'RENEWAL';
        const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
        const sessionWaitlistType = session.waitlist_desired_type;
        let parsedWaitlistTypesJson;
        if (session.waitlist_desired_types_json !== null) {
            if (typeof session.waitlist_desired_types_json === 'string') {
                parsedWaitlistTypesJson = session.waitlist_desired_types_json;
            }
            else {
                parsedWaitlistTypesJson = JSON.stringify(session.waitlist_desired_types_json);
            }
        }
        const pricingInput = {
            rentalType,
            customerAge,
            checkInTime: new Date(),
            membershipCardType,
            membershipValidUntil,
            includeSixMonthMembershipPurchase: includeSixMonth,
            waitlistDesiredType: sessionWaitlistType,
            waitlistDesiredTypesJson: parsedWaitlistTypesJson,
        };
        const quote = isRenewal && renewalHours
            ? (0, engine_1.calculateRenewalQuote)({ ...pricingInput, renewalHours })
            : (0, engine_1.calculatePriceQuote)(pricingInput);
        const intentResult = await client.query(`INSERT INTO orders (lane_session_id, subtotal, discount, tax, tip, total, status, quote_json) VALUES ($1, $2, 0, 0, 0, $2, 'OPEN', $3) RETURNING ${types_1.ORDER_COLS}`, [sessionId, quote.total, JSON.stringify(quote)]);
        const intent = intentResult.rows[0];
        await client.query(`UPDATE lane_sessions SET order_id = $1, price_quote_json = $2, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = $3`, [intent.id, JSON.stringify(quote), sessionId]);
    }
    if (session.flow_step === 'AGREEMENT' && session.order_id && type === 'SET_STEP') {
        const requestedMethod = payload?.['paymentMethod'];
        if (requestedMethod === 'CASH' || requestedMethod === 'CREDIT' || requestedMethod === 'SPLIT') {
            const intentStatusRes = await client.query(`SELECT status FROM orders WHERE id = $1`, [session.order_id]);
            if (intentStatusRes.rows[0]?.status !== 'PAID') {
                const splitCash = payload?.['splitCashAmount'] ? Number(payload['splitCashAmount']) : null;
                const splitCredit = payload?.['splitCreditAmount'] ? Number(payload['splitCreditAmount']) : null;
                await client.query(`UPDATE orders SET status = 'PAID', payment_method = $1, split_cash_amount = $2, split_credit_amount = $3, paid_at = NOW(), updated_at = NOW() WHERE id = $4`, [requestedMethod, splitCash, splitCredit, session.order_id]);
                await client.query(`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`, [sessionId]);
                if (session.customer_id && session.past_due_bypassed !== true) {
                    const pastDueRes = await client.query(`SELECT past_due_balance FROM customers WHERE id = $1 FOR UPDATE`, [session.customer_id]);
                    const bal = pastDueRes.rows[0]?.past_due_balance;
                    if (bal && Number(bal) > 0) {
                        await client.query(`UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = $1`, [session.customer_id]);
                        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                            customerId: session.customer_id,
                            actionType: 'PAST_DUE_PAID',
                            actionCategory: 'PAYMENT',
                            sourceApp: 'CUSTOMER_KIOSK',
                            actorType: 'SYSTEM',
                            summary: 'Past due balance paid',
                            metadata: { amount_paid: Number(bal), order_id: session.order_id },
                        });
                    }
                }
            }
        }
    }
    if (session.flow_step === 'PAYMENT' && session.order_id && type === 'SET_STEP' && payload?.['paymentFailed']) {
        const failureReason = payload['failureReason'] || 'Payment failed';
        await client.query(`UPDATE orders SET failure_reason = $1, updated_at = NOW() WHERE id = $2`, [failureReason, session.order_id]);
    }
}
function registerCheckinFlowCommandRoutes(fastify) {
    fastify.post('/v1/checkin/lane/:laneId/flow-command', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = FlowCommandRequestByTypeSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                applied: false,
                error: 'ValidationFailed',
                message: parsed.error.errors.map((e) => e.message).join(', '),
            });
        }
        const { sessionId, commandId, actor, expectedFlowVersion, type, payload } = parsed.data;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const qClient = toQueryable(tx);
                if (!(await isFlowCommandsEnabled({ client: qClient, laneId }))) {
                    throw new FlowCommandError(404, 'NotFound', 'Not Found');
                }
                const authority = await (0, laneAuthority_1.assertLaneWriteAuthority)({ client: qClient, laneId });
                if (!authority.allowed) {
                    throw new FlowCommandError(409, 'LaneNotAuthoritative', authority.reason ?? 'Lane write not allowed');
                }
                const lanMode = await isLanFallbackEnabledForLane({ client: qClient, laneId });
                const locked = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)}
             FROM lane_sessions
             WHERE id = ${sessionId} AND lane_id = ${laneId}
             FOR UPDATE`);
                if (locked.rows.length === 0) {
                    throw new FlowCommandError(404, 'NotFound', 'Session not found');
                }
                const session = locked.rows[0];
                const currentVersion = session.flow_version ?? 0;
                const dedupe = await tx.execute((0, drizzle_orm_1.sql) `SELECT session_id, command_id
             FROM lane_session_commands
             WHERE session_id = ${sessionId} AND command_id = ${commandId}
             LIMIT 1`);
                if (dedupe.rows.length > 0) {
                    return { applied: true, deduped: true, session };
                }
                if (typeof expectedFlowVersion === 'number' && expectedFlowVersion !== currentVersion) {
                    throw new FlowCommandError(409, 'VersionMismatch', `expectedFlowVersion ${expectedFlowVersion} does not match current ${currentVersion}`);
                }
                await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
             VALUES (${sessionId}, ${commandId}, ${actor}, ${type}, ${payload ?? null})`);
                if (lanMode) {
                    await (0, offlineOutbox_1.writeOfflineOutboxRecord)(qClient, {
                        laneId,
                        sessionId,
                        commandId,
                        actor,
                        type,
                        payload: payload ?? null,
                    });
                }
                let nextStatus = session.status;
                let nextDesiredRentalType = session.desired_rental_type;
                let nextProposedRentalType = session.proposed_rental_type;
                let nextProposedBy = session.proposed_by;
                let nextSelectionConfirmed = session.selection_confirmed;
                let nextSelectionConfirmedBy = session.selection_confirmed_by;
                let nextSelectionLockedAt = session.selection_locked_at;
                let nextWaitlistDesiredType = session.waitlist_desired_type;
                let nextWaitlistDesiredTypesJson = session.waitlist_desired_types_json;
                let nextBackupRentalType = session.backup_rental_type;
                let nextWaitlistRequestedResourceNumber = session.waitlist_requested_resource_number;
                let nextWaitlistRequestedResourceType = session.waitlist_requested_resource_type;
                if (type === 'PROPOSE_SELECTION') {
                    const rentalType = typeof payload?.['rentalType'] === 'string' ? payload['rentalType'] : null;
                    if (!rentalType) {
                        throw new FlowCommandError(400, 'InvalidPayload', 'payload.rentalType is required');
                    }
                    if (session.selection_confirmed && session.flow_step !== 'WAITLIST_BACKUP') {
                        throw new FlowCommandError(400, 'SelectionLocked', 'Selection is already locked');
                    }
                    nextProposedRentalType = rentalType;
                    nextProposedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
                }
                if (type === 'CONFIRM_SELECTION') {
                    if (!session.proposed_rental_type && !nextProposedRentalType) {
                        throw new FlowCommandError(400, 'NoProposal', 'No selection proposed yet');
                    }
                    nextSelectionConfirmed = true;
                    nextSelectionConfirmedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
                    nextSelectionLockedAt = new Date();
                    if (nextProposedRentalType) {
                        nextDesiredRentalType = nextProposedRentalType;
                    }
                    else if (session.proposed_rental_type) {
                        nextDesiredRentalType = session.proposed_rental_type;
                    }
                    if (nextStatus === 'ACTIVE') {
                        nextStatus = 'AWAITING_PAYMENT';
                    }
                }
                if (type === 'WAITLIST_UPDATE') {
                    const normalizeString = (value) => {
                        if (value === null || value === undefined)
                            return null;
                        if (typeof value !== 'string')
                            return null;
                        const trimmed = value.trim();
                        return trimmed.length > 0 ? trimmed : null;
                    };
                    const p = payload;
                    const desired = normalizeString(p?.['waitlistDesiredType'] ?? p?.['desiredTier']);
                    const backup = normalizeString(p?.['backupRentalType'] ?? p?.['backupTier']);
                    const requestedNumber = normalizeString(p?.['waitlistRequestedResourceNumber'] ?? p?.['requestedResourceNumber']);
                    const requestedTypeRaw = p?.['waitlistRequestedResourceType'] ?? p?.['requestedResourceType'];
                    const requestedType = requestedTypeRaw === 'room' || requestedTypeRaw === 'locker' ? requestedTypeRaw : null;
                    const desiredTypesRaw = p?.['waitlistDesiredTypes'] ?? p?.['desiredTypes'];
                    const desiredTypes = Array.isArray(desiredTypesRaw)
                        ? desiredTypesRaw
                            .filter((entry) => typeof entry === 'string')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0)
                        : undefined;
                    nextWaitlistDesiredType = desired;
                    nextWaitlistDesiredTypesJson = desiredTypes ? JSON.stringify(desiredTypes) : nextWaitlistDesiredTypesJson;
                    nextBackupRentalType = backup;
                    nextWaitlistRequestedResourceNumber = requestedNumber;
                    nextWaitlistRequestedResourceType = requestedType;
                }
                const currentStep = parseFlowStep(session.flow_step) ?? 'RENTAL';
                const { nextStep, clear } = computeFlowUpdate({ currentStep, type, payload });
                const nextVersion = currentVersion + 1;
                let finalDisclaimersAckJson = clear.agreement ? null : session.disclaimers_ack_json;
                // If backward-clearing, preserve waitlistDisclaimerAck if it exists
                if (clear.agreement &&
                    typeof session.disclaimers_ack_json === 'object' &&
                    session.disclaimers_ack_json !== null &&
                    session.disclaimers_ack_json['waitlistDisclaimerAck'] === true) {
                    finalDisclaimersAckJson = { waitlistDisclaimerAck: true };
                }
                // If moving forward from WAITLIST_DISCLAIMER, inject the acknowledgment
                if (type === 'SET_STEP' && currentStep === 'WAITLIST_DISCLAIMER' && nextStep === 'PAYMENT') {
                    finalDisclaimersAckJson = { ...(finalDisclaimersAckJson || {}), waitlistDisclaimerAck: true };
                }
                const stringifyIfObject = (val) => {
                    if (val === null || val === undefined)
                        return null;
                    if (typeof val === 'string')
                        return val;
                    return JSON.stringify(val);
                };
                const updateParams = [
                    nextStatus,
                    nextStep,
                    nextVersion,
                    commandId,
                    actor,
                    clear.rental,
                    nextDesiredRentalType,
                    nextProposedRentalType,
                    nextProposedBy,
                    nextSelectionConfirmed,
                    nextSelectionConfirmedBy,
                    nextSelectionLockedAt,
                    clear.waitlistBackup,
                    nextWaitlistDesiredType,
                    stringifyIfObject(nextWaitlistDesiredTypesJson),
                    nextBackupRentalType,
                    nextWaitlistRequestedResourceNumber,
                    nextWaitlistRequestedResourceType,
                    clear.paymentIntent,
                    clear.agreement,
                    sessionId,
                    stringifyIfObject(finalDisclaimersAckJson),
                ];
                // This complex UPDATE uses positional params ($1..$21) with many CASE
                // expressions — best kept as raw SQL via the toQueryable adapter.
                const updatedSession = await qClient.query(`UPDATE lane_sessions
             SET status = $1::public.lane_session_status,
                 flow_step = $2,
                 flow_version = $3,
                 flow_last_command_id = $4,
                 flow_last_actor = $5,
                 desired_rental_type = CASE WHEN $6 THEN NULL ELSE $7::public.rental_type END,
                 proposed_rental_type = CASE WHEN $6 THEN NULL ELSE $8::public.rental_type END,
                 proposed_by = CASE WHEN $6 THEN NULL ELSE $9 END,
                 selection_confirmed = CASE WHEN $6 THEN false ELSE $10 END,
                 selection_confirmed_by = CASE WHEN $6 THEN NULL ELSE $11 END,
                 selection_locked_at = CASE WHEN $6 THEN NULL ELSE $12::timestamptz END,
                 waitlist_desired_type = CASE WHEN $13 THEN NULL ELSE $14::public.rental_type END,
                 waitlist_desired_types_json = CASE WHEN $13 THEN NULL ELSE $15::jsonb END,
                 backup_rental_type = CASE WHEN $13 THEN NULL ELSE $16::public.rental_type END,
                 waitlist_requested_resource_number = CASE WHEN $13 THEN NULL ELSE $17 END,
                 waitlist_requested_resource_type = CASE WHEN $13 THEN NULL ELSE $18::public.inventory_resource_type END,
                 order_id = CASE WHEN $19 THEN NULL ELSE order_id END,
                 price_quote_json = CASE WHEN $19 THEN NULL ELSE price_quote_json END,
                 disclaimers_ack_json = $22::jsonb,
                 agreement_bypass_pending = CASE WHEN $20 THEN false ELSE agreement_bypass_pending END,
                 updated_at = NOW()
             WHERE id = $21
             RETURNING ${types_1.LANE_SESSION_COLS}`, updateParams);
                const finalSession = updatedSession.rows[0];
                // Apply payment-related side effects (auto-create intent, mark PAID, record failure).
                await applyFlowPaymentSideEffects(qClient, {
                    session: finalSession,
                    sessionId,
                    type,
                    payload,
                });
                return { applied: true, deduped: false, session: finalSession };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { laneId: sessionLaneId, payload: sessionPayload } = await (0, payload_1.buildFullSessionUpdatedPayload)(sessionId);
            fastify.broadcaster.broadcastSessionUpdated(sessionPayload, sessionLaneId);
            return reply.send({
                applied: true,
                deduped: result.deduped,
                flowVersion: result.session.flow_version ?? 0,
                session: result.session,
            });
        }
        catch (err) {
            request.log.error(err, 'Failed to apply flow command');
            const isFlowErr = err instanceof FlowCommandError;
            return reply.status(isFlowErr ? err.statusCode : 500).send({
                applied: false,
                error: isFlowErr ? err.error : 'InternalServerError',
                message: err instanceof Error ? err.message : 'An unexpected error occurred',
            });
        }
    });
}
