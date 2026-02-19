import { z } from 'zod';
import { RoomStatus } from './enums.js';
const RealtimeEventBaseSchema = z.object({
    type: z.string(),
    payload: z.unknown(),
    timestamp: z.string(),
});
const CustomerIdTypeSchema = z.enum(['STATE_ID', 'DRIVERS_LICENSE', 'PASSPORT', 'OTHER']);
const CheckinFlowStepSchema = z.enum([
    'LANGUAGE',
    'RENTAL',
    'WAITLIST_PREFERENCES',
    'WAITLIST_BACKUP',
    'PAYMENT',
    'AGREEMENT',
    'COMPLETE',
]);
const CheckinFlowActorSchema = z.enum(['CUSTOMER', 'EMPLOYEE', 'SYSTEM']);
const CheckinFlowCommandTypeSchema = z.enum([
    'SET_STEP',
    'BACK_STEP',
    'CANCEL_STEP',
]);
export const CheckinFlowCommandRequestSchema = z
    .object({
    sessionId: z.string(),
    commandId: z.string(),
    actor: CheckinFlowActorSchema,
    expectedFlowVersion: z.number().int().nonnegative().optional(),
    type: CheckinFlowCommandTypeSchema,
    payload: z
        .record(z.unknown())
        .refine((value) => {
        const step = value['step'];
        if (step === undefined || step === null)
            return true;
        return CheckinFlowStepSchema.safeParse(step).success;
    }, { message: 'payload.step must be a valid CheckinFlowStep when present' })
        .optional(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// Payload schemas (runtime validation)
// ---------------------------------------------------------------------------
export const SessionUpdatedPayloadSchema = z
    .object({
    sessionId: z.string(),
    customerId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerName: z.string(),
    // Some producers may send null for "missing" optional fields; normalize null -> undefined.
    membershipNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerMembershipValidUntil: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    membershipChoice: z.enum(['ONE_TIME', 'SIX_MONTH']).nullable().optional(),
    membershipPurchaseIntent: z.preprocess((v) => (v === null ? undefined : v), z.enum(['PURCHASE', 'RENEW']).optional()),
    kioskAcknowledgedAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    // Server normally includes this, but keep tolerant so older servers/tests don't drop realtime events.
    allowedRentals: z.array(z.string()).default([]),
    mode: z.enum(['CHECKIN', 'RENEWAL']).optional(),
    renewalHours: z.preprocess((v) => (v === null ? undefined : v), z.union([z.literal(2), z.literal(6)]).optional()),
    blockEndsAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    visitId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    waitlistDesiredType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    waitlistDesiredTypes: z.preprocess((v) => (v === null ? undefined : v), z.array(z.string()).optional()),
    backupRentalType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    waitlistRequestedResourceNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    waitlistRequestedResourceType: z.preprocess((v) => (v === null ? undefined : v), z.enum(['room', 'locker']).optional()),
    status: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    proposedRentalType: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    proposedBy: z.enum(['CUSTOMER', 'EMPLOYEE']).optional(),
    selectionConfirmed: z.boolean().optional(),
    selectionConfirmedBy: z.enum(['CUSTOMER', 'EMPLOYEE']).optional(),
    customerPrimaryLanguage: z.preprocess((v) => (v === null ? undefined : v), z.enum(['EN', 'ES']).optional()),
    customerDob: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerDobMonthDay: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerIdNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerLastVisitAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerIdExpirationDate: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerIdType: z.preprocess((v) => (v === null ? undefined : v), CustomerIdTypeSchema.optional()),
    customerIdTypeOther: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    customerHasEncryptedLookupMarker: z.boolean().optional(),
    idScanIssue: z.preprocess((v) => (v === null ? undefined : v), z.enum(['ID_EXPIRED', 'UNDERAGE']).optional()),
    pastDueBalance: z.number().optional(),
    pastDueBlocked: z.boolean().optional(),
    pastDueBypassed: z.boolean().optional(),
    paymentIntentId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    paymentStatus: z.enum(['DUE', 'PAID']).optional(),
    paymentMethod: z.enum(['CASH', 'CREDIT']).optional(),
    paymentTotal: z.number().optional(),
    paymentLineItems: z
        .array(z.object({
        description: z.string(),
        amount: z.number(),
    }))
        .optional(),
    paymentFailureReason: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    ledgerLineItems: z
        .array(z.object({
        description: z.string(),
        amount: z.number(),
    }))
        .optional(),
    ledgerTotal: z.number().optional(),
    agreementSigned: z.boolean().optional(),
    agreementBypassPending: z.boolean().optional(),
    agreementSignedMethod: z.enum(['DIGITAL', 'MANUAL']).optional(),
    assignedResourceType: z.enum(['room', 'locker']).optional(),
    assignedResourceNumber: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    checkoutAt: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
    flowStep: z.preprocess((v) => (v === null ? undefined : v), z
        .enum([
        'LANGUAGE',
        'RENTAL',
        'WAITLIST_PREFERENCES',
        'WAITLIST_BACKUP',
        'PAYMENT',
        'AGREEMENT',
        'COMPLETE',
    ])
        .optional()),
    flowVersion: z.preprocess((v) => (v === null ? undefined : v), z.number().int().nonnegative().optional()),
    flowLastActor: z.preprocess((v) => (v === null ? undefined : v), z.enum(['CUSTOMER', 'EMPLOYEE', 'SYSTEM']).optional()),
    flowLastCommandId: z.preprocess((v) => (v === null ? undefined : v), z.string().optional()),
})
    .passthrough();
export const CheckinOptionHighlightedPayloadSchema = z
    .object({
    sessionId: z.string(),
    step: z.enum(['LANGUAGE', 'MEMBERSHIP', 'WAITLIST_BACKUP']),
    option: z.string().nullable(),
    by: z.literal('EMPLOYEE'),
})
    .passthrough();
export const SelectionProposedPayloadSchema = z
    .object({
    sessionId: z.string(),
    rentalType: z.string(),
    proposedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
})
    .passthrough();
export const SelectionLockedPayloadSchema = z
    .object({
    sessionId: z.string(),
    rentalType: z.string(),
    confirmedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
    lockedAt: z.string(),
})
    .passthrough();
export const SelectionForcedPayloadSchema = z
    .object({
    sessionId: z.string(),
    rentalType: z.string(),
    forcedBy: z.literal('EMPLOYEE'),
})
    .passthrough();
export const SelectionAcknowledgedPayloadSchema = z
    .object({
    sessionId: z.string(),
    acknowledgedBy: z.enum(['CUSTOMER', 'EMPLOYEE']),
})
    .passthrough();
export const CustomerConfirmationRequiredPayloadSchema = z
    .object({
    sessionId: z.string(),
    requestedType: z.string(),
    selectedType: z.string(),
    selectedNumber: z.string(),
})
    .passthrough();
export const CustomerConfirmedPayloadSchema = z
    .object({
    sessionId: z.string(),
    confirmedType: z.string(),
    confirmedNumber: z.string(),
})
    .passthrough();
export const CustomerDeclinedPayloadSchema = z
    .object({
    sessionId: z.string(),
    requestedType: z.string(),
})
    .passthrough();
export const AssignmentCreatedPayloadSchema = z
    .object({
    sessionId: z.string(),
    rentalType: z.string(),
    roomId: z.string().optional(),
    roomNumber: z.string().optional(),
    lockerId: z.string().optional(),
    lockerNumber: z.string().optional(),
})
    .passthrough();
export const AssignmentFailedPayloadSchema = z
    .object({
    sessionId: z.string(),
    reason: z.string(),
    requestedRoomId: z.string().optional(),
    requestedLockerId: z.string().optional(),
})
    .passthrough();
const InventorySummarySchema = z.object({
    clean: z.number(),
    cleaning: z.number(),
    dirty: z.number(),
    total: z.number(),
});
const DetailedInventorySchema = z
    .object({
    byType: z.object({
        STANDARD: InventorySummarySchema,
        DOUBLE: InventorySummarySchema,
        SPECIAL: InventorySummarySchema,
        LOCKER: InventorySummarySchema,
    }),
    overall: InventorySummarySchema,
    lockers: InventorySummarySchema,
})
    .passthrough();
export const InventoryUpdatedPayloadSchema = z
    .object({
    inventory: DetailedInventorySchema,
    available: z
        .object({
        rooms: z.object({
            SPECIAL: z.number(),
            DOUBLE: z.number(),
            STANDARD: z.number(),
        }),
        rawRooms: z.object({
            SPECIAL: z.number(),
            DOUBLE: z.number(),
            STANDARD: z.number(),
        }),
        waitlistDemand: z.object({
            SPECIAL: z.number(),
            DOUBLE: z.number(),
            STANDARD: z.number(),
        }),
        lockers: z.number(),
        total: z.number(),
    })
        .optional(),
})
    .passthrough();
export const WaitlistCreatedPayloadSchema = z
    .object({
    sessionId: z.string(),
    waitlistId: z.string(),
    desiredType: z.string(),
    backupType: z.string(),
    position: z.number(),
    estimatedReadyAt: z.string().optional(),
    upgradeFee: z.number().optional(),
})
    .passthrough();
export const UpgradeHoldAvailablePayloadSchema = z
    .object({
    waitlistId: z.string(),
    customerName: z.string(),
    desiredTier: z.string(),
    roomId: z.string(),
    roomNumber: z.string(),
    expiresAt: z.string(),
})
    .passthrough();
export const UpgradeOfferExpiredPayloadSchema = z
    .object({
    waitlistId: z.string(),
    customerName: z.string(),
    desiredTier: z.string(),
    roomId: z.string(),
    roomNumber: z.string(),
})
    .passthrough();
export const RoomStatusChangedPayloadSchema = z
    .object({
    roomId: z.string(),
    previousStatus: z.nativeEnum(RoomStatus),
    newStatus: z.nativeEnum(RoomStatus),
    changedBy: z.string(),
    override: z.boolean(),
    reason: z.string().optional(),
})
    .passthrough();
export const CheckoutRequestSummarySchema = z
    .object({
    requestId: z.string(),
    customerName: z.string(),
    membershipNumber: z.string().optional(),
    rentalType: z.string(),
    roomNumber: z.string().optional(),
    lockerNumber: z.string().optional(),
    // Realtime payloads are JSON; timestamps arrive as ISO strings.
    scheduledCheckoutAt: z.coerce.date(),
    currentTime: z.coerce.date(),
    lateMinutes: z.number(),
    lateFeeAmount: z.number(),
    banApplied: z.boolean(),
})
    .passthrough();
export const CheckoutRequestedPayloadSchema = z
    .object({
    request: CheckoutRequestSummarySchema,
})
    .passthrough();
export const CheckoutClaimedPayloadSchema = z
    .object({
    requestId: z.string(),
    claimedBy: z.string(),
})
    .passthrough();
export const CheckoutUpdatedPayloadSchema = z
    .object({
    requestId: z.string(),
    itemsConfirmed: z.boolean(),
    feePaid: z.boolean(),
})
    .passthrough();
export const CheckoutCompletedPayloadSchema = z
    .object({
    requestId: z.string(),
    kioskDeviceId: z.string(),
    success: z.boolean(),
})
    .passthrough();
export const WaitlistUpdatedPayloadSchema = z
    .object({
    waitlistId: z.string(),
    status: z.string(),
    visitId: z.string().optional(),
    desiredTier: z.string().optional(),
})
    .passthrough();
export function safeParseRealtimeEvent(input) {
    const base = RealtimeEventBaseSchema.safeParse(input);
    if (!base.success)
        return null;
    const { type, payload, timestamp } = base.data;
    const wrap = (schema) => {
        const parsed = schema.safeParse(payload);
        if (!parsed.success)
            return null;
        return { type, payload: parsed.data, timestamp };
    };
    switch (type) {
        case 'SESSION_UPDATED':
            return wrap(SessionUpdatedPayloadSchema);
        case 'CHECKIN_OPTION_HIGHLIGHTED':
            return wrap(CheckinOptionHighlightedPayloadSchema);
        case 'SELECTION_PROPOSED':
            return wrap(SelectionProposedPayloadSchema);
        case 'SELECTION_LOCKED':
            return wrap(SelectionLockedPayloadSchema);
        case 'SELECTION_FORCED':
            return wrap(SelectionForcedPayloadSchema);
        case 'SELECTION_ACKNOWLEDGED':
            return wrap(SelectionAcknowledgedPayloadSchema);
        case 'CUSTOMER_CONFIRMATION_REQUIRED':
            return wrap(CustomerConfirmationRequiredPayloadSchema);
        case 'CUSTOMER_CONFIRMED':
            return wrap(CustomerConfirmedPayloadSchema);
        case 'CUSTOMER_DECLINED':
            return wrap(CustomerDeclinedPayloadSchema);
        case 'ASSIGNMENT_CREATED':
            return wrap(AssignmentCreatedPayloadSchema);
        case 'ASSIGNMENT_FAILED':
            return wrap(AssignmentFailedPayloadSchema);
        case 'INVENTORY_UPDATED':
            return wrap(InventoryUpdatedPayloadSchema);
        case 'WAITLIST_CREATED':
            return wrap(WaitlistCreatedPayloadSchema);
        case 'WAITLIST_UPDATED':
            return wrap(WaitlistUpdatedPayloadSchema);
        case 'UPGRADE_HOLD_AVAILABLE':
            return wrap(UpgradeHoldAvailablePayloadSchema);
        case 'UPGRADE_OFFER_EXPIRED':
            return wrap(UpgradeOfferExpiredPayloadSchema);
        case 'ROOM_STATUS_CHANGED':
            return wrap(RoomStatusChangedPayloadSchema);
        case 'CHECKOUT_REQUESTED':
            return wrap(CheckoutRequestedPayloadSchema);
        case 'CHECKOUT_CLAIMED':
            return wrap(CheckoutClaimedPayloadSchema);
        case 'CHECKOUT_UPDATED':
            return wrap(CheckoutUpdatedPayloadSchema);
        case 'CHECKOUT_COMPLETED':
            return wrap(CheckoutCompletedPayloadSchema);
        default:
            // Unknown / forward-compatible event types are ignored by default.
            return null;
    }
}
//# sourceMappingURL=realtimeSchemas.js.map