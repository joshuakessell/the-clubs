import { z } from 'zod';
import type { AssignmentCreatedPayload, AssignmentFailedPayload, CheckinOptionHighlightedPayload, CheckoutClaimedPayload, CheckoutCompletedPayload, CheckoutRequestedPayload, CheckoutUpdatedPayload, CustomerConfirmationRequiredPayload, CustomerConfirmedPayload, CustomerDeclinedPayload, InventoryUpdatedPayload, RoomStatusChangedPayload, SelectionAcknowledgedPayload, SelectionForcedPayload, SelectionLockedPayload, SelectionProposedPayload, SessionUpdatedPayload, UpgradeHoldAvailablePayload, UpgradeOfferExpiredPayload, WaitlistCreatedPayload, RealtimeEvent } from './types.js';
export declare const CheckinFlowCommandRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    commandId: z.ZodString;
    actor: z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>;
    expectedFlowVersion: z.ZodOptional<z.ZodNumber>;
    type: z.ZodEnum<["SET_STEP", "BACK_STEP", "CANCEL_STEP"]>;
    payload: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    commandId: z.ZodString;
    actor: z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>;
    expectedFlowVersion: z.ZodOptional<z.ZodNumber>;
    type: z.ZodEnum<["SET_STEP", "BACK_STEP", "CANCEL_STEP"]>;
    payload: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    commandId: z.ZodString;
    actor: z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>;
    expectedFlowVersion: z.ZodOptional<z.ZodNumber>;
    type: z.ZodEnum<["SET_STEP", "BACK_STEP", "CANCEL_STEP"]>;
    payload: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const SessionUpdatedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    customerId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerName: z.ZodString;
    membershipNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerMembershipValidUntil: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    membershipChoice: z.ZodOptional<z.ZodNullable<z.ZodEnum<["ONE_TIME", "SIX_MONTH"]>>>;
    membershipPurchaseIntent: z.ZodEffects<z.ZodOptional<z.ZodEnum<["PURCHASE", "RENEW"]>>, "PURCHASE" | "RENEW" | undefined, unknown>;
    kioskAcknowledgedAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    allowedRentals: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    mode: z.ZodOptional<z.ZodEnum<["CHECKIN", "RENEWAL"]>>;
    renewalHours: z.ZodEffects<z.ZodOptional<z.ZodUnion<[z.ZodLiteral<2>, z.ZodLiteral<6>]>>, 2 | 6 | undefined, unknown>;
    blockEndsAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    visitId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredTypes: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, unknown>;
    backupRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["room", "locker"]>>, "room" | "locker" | undefined, unknown>;
    status: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    selectionConfirmed: z.ZodOptional<z.ZodBoolean>;
    selectionConfirmedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    customerPrimaryLanguage: z.ZodEffects<z.ZodOptional<z.ZodEnum<["EN", "ES"]>>, "EN" | "ES" | undefined, unknown>;
    customerDob: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerDobMonthDay: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerLastVisitAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdExpirationDate: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["STATE_ID", "DRIVERS_LICENSE", "PASSPORT", "OTHER"]>>, "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined, unknown>;
    customerIdTypeOther: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerHasEncryptedLookupMarker: z.ZodOptional<z.ZodBoolean>;
    idScanIssue: z.ZodEffects<z.ZodOptional<z.ZodEnum<["ID_EXPIRED", "UNDERAGE"]>>, "ID_EXPIRED" | "UNDERAGE" | undefined, unknown>;
    pastDueBalance: z.ZodOptional<z.ZodNumber>;
    pastDueBlocked: z.ZodOptional<z.ZodBoolean>;
    pastDueBypassed: z.ZodOptional<z.ZodBoolean>;
    paymentIntentId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    paymentStatus: z.ZodOptional<z.ZodEnum<["DUE", "PAID"]>>;
    paymentMethod: z.ZodOptional<z.ZodEnum<["CASH", "CREDIT"]>>;
    paymentTotal: z.ZodOptional<z.ZodNumber>;
    paymentLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    paymentFailureReason: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    ledgerLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    ledgerTotal: z.ZodOptional<z.ZodNumber>;
    agreementSigned: z.ZodOptional<z.ZodBoolean>;
    agreementBypassPending: z.ZodOptional<z.ZodBoolean>;
    agreementSignedMethod: z.ZodOptional<z.ZodEnum<["DIGITAL", "MANUAL"]>>;
    assignedResourceType: z.ZodOptional<z.ZodEnum<["room", "locker"]>>;
    assignedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    checkoutAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    flowStep: z.ZodEffects<z.ZodOptional<z.ZodEnum<["LANGUAGE", "RENTAL", "WAITLIST_PREFERENCES", "WAITLIST_BACKUP", "PAYMENT", "AGREEMENT", "COMPLETE"]>>, "LANGUAGE" | "RENTAL" | "WAITLIST_PREFERENCES" | "WAITLIST_BACKUP" | "PAYMENT" | "AGREEMENT" | "COMPLETE" | undefined, unknown>;
    flowVersion: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    flowLastActor: z.ZodEffects<z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>>, "CUSTOMER" | "EMPLOYEE" | "SYSTEM" | undefined, unknown>;
    flowLastCommandId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    customerId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerName: z.ZodString;
    membershipNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerMembershipValidUntil: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    membershipChoice: z.ZodOptional<z.ZodNullable<z.ZodEnum<["ONE_TIME", "SIX_MONTH"]>>>;
    membershipPurchaseIntent: z.ZodEffects<z.ZodOptional<z.ZodEnum<["PURCHASE", "RENEW"]>>, "PURCHASE" | "RENEW" | undefined, unknown>;
    kioskAcknowledgedAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    allowedRentals: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    mode: z.ZodOptional<z.ZodEnum<["CHECKIN", "RENEWAL"]>>;
    renewalHours: z.ZodEffects<z.ZodOptional<z.ZodUnion<[z.ZodLiteral<2>, z.ZodLiteral<6>]>>, 2 | 6 | undefined, unknown>;
    blockEndsAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    visitId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredTypes: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, unknown>;
    backupRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["room", "locker"]>>, "room" | "locker" | undefined, unknown>;
    status: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    selectionConfirmed: z.ZodOptional<z.ZodBoolean>;
    selectionConfirmedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    customerPrimaryLanguage: z.ZodEffects<z.ZodOptional<z.ZodEnum<["EN", "ES"]>>, "EN" | "ES" | undefined, unknown>;
    customerDob: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerDobMonthDay: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerLastVisitAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdExpirationDate: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["STATE_ID", "DRIVERS_LICENSE", "PASSPORT", "OTHER"]>>, "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined, unknown>;
    customerIdTypeOther: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerHasEncryptedLookupMarker: z.ZodOptional<z.ZodBoolean>;
    idScanIssue: z.ZodEffects<z.ZodOptional<z.ZodEnum<["ID_EXPIRED", "UNDERAGE"]>>, "ID_EXPIRED" | "UNDERAGE" | undefined, unknown>;
    pastDueBalance: z.ZodOptional<z.ZodNumber>;
    pastDueBlocked: z.ZodOptional<z.ZodBoolean>;
    pastDueBypassed: z.ZodOptional<z.ZodBoolean>;
    paymentIntentId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    paymentStatus: z.ZodOptional<z.ZodEnum<["DUE", "PAID"]>>;
    paymentMethod: z.ZodOptional<z.ZodEnum<["CASH", "CREDIT"]>>;
    paymentTotal: z.ZodOptional<z.ZodNumber>;
    paymentLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    paymentFailureReason: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    ledgerLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    ledgerTotal: z.ZodOptional<z.ZodNumber>;
    agreementSigned: z.ZodOptional<z.ZodBoolean>;
    agreementBypassPending: z.ZodOptional<z.ZodBoolean>;
    agreementSignedMethod: z.ZodOptional<z.ZodEnum<["DIGITAL", "MANUAL"]>>;
    assignedResourceType: z.ZodOptional<z.ZodEnum<["room", "locker"]>>;
    assignedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    checkoutAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    flowStep: z.ZodEffects<z.ZodOptional<z.ZodEnum<["LANGUAGE", "RENTAL", "WAITLIST_PREFERENCES", "WAITLIST_BACKUP", "PAYMENT", "AGREEMENT", "COMPLETE"]>>, "LANGUAGE" | "RENTAL" | "WAITLIST_PREFERENCES" | "WAITLIST_BACKUP" | "PAYMENT" | "AGREEMENT" | "COMPLETE" | undefined, unknown>;
    flowVersion: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    flowLastActor: z.ZodEffects<z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>>, "CUSTOMER" | "EMPLOYEE" | "SYSTEM" | undefined, unknown>;
    flowLastCommandId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    customerId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerName: z.ZodString;
    membershipNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerMembershipValidUntil: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    membershipChoice: z.ZodOptional<z.ZodNullable<z.ZodEnum<["ONE_TIME", "SIX_MONTH"]>>>;
    membershipPurchaseIntent: z.ZodEffects<z.ZodOptional<z.ZodEnum<["PURCHASE", "RENEW"]>>, "PURCHASE" | "RENEW" | undefined, unknown>;
    kioskAcknowledgedAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    allowedRentals: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    mode: z.ZodOptional<z.ZodEnum<["CHECKIN", "RENEWAL"]>>;
    renewalHours: z.ZodEffects<z.ZodOptional<z.ZodUnion<[z.ZodLiteral<2>, z.ZodLiteral<6>]>>, 2 | 6 | undefined, unknown>;
    blockEndsAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    visitId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistDesiredTypes: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, unknown>;
    backupRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    waitlistRequestedResourceType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["room", "locker"]>>, "room" | "locker" | undefined, unknown>;
    status: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedRentalType: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    proposedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    selectionConfirmed: z.ZodOptional<z.ZodBoolean>;
    selectionConfirmedBy: z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>>;
    customerPrimaryLanguage: z.ZodEffects<z.ZodOptional<z.ZodEnum<["EN", "ES"]>>, "EN" | "ES" | undefined, unknown>;
    customerDob: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerDobMonthDay: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerLastVisitAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdExpirationDate: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerIdType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["STATE_ID", "DRIVERS_LICENSE", "PASSPORT", "OTHER"]>>, "STATE_ID" | "DRIVERS_LICENSE" | "PASSPORT" | "OTHER" | undefined, unknown>;
    customerIdTypeOther: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    customerHasEncryptedLookupMarker: z.ZodOptional<z.ZodBoolean>;
    idScanIssue: z.ZodEffects<z.ZodOptional<z.ZodEnum<["ID_EXPIRED", "UNDERAGE"]>>, "ID_EXPIRED" | "UNDERAGE" | undefined, unknown>;
    pastDueBalance: z.ZodOptional<z.ZodNumber>;
    pastDueBlocked: z.ZodOptional<z.ZodBoolean>;
    pastDueBypassed: z.ZodOptional<z.ZodBoolean>;
    paymentIntentId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    paymentStatus: z.ZodOptional<z.ZodEnum<["DUE", "PAID"]>>;
    paymentMethod: z.ZodOptional<z.ZodEnum<["CASH", "CREDIT"]>>;
    paymentTotal: z.ZodOptional<z.ZodNumber>;
    paymentLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    paymentFailureReason: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    ledgerLineItems: z.ZodOptional<z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        description: string;
        amount: number;
    }, {
        description: string;
        amount: number;
    }>, "many">>;
    ledgerTotal: z.ZodOptional<z.ZodNumber>;
    agreementSigned: z.ZodOptional<z.ZodBoolean>;
    agreementBypassPending: z.ZodOptional<z.ZodBoolean>;
    agreementSignedMethod: z.ZodOptional<z.ZodEnum<["DIGITAL", "MANUAL"]>>;
    assignedResourceType: z.ZodOptional<z.ZodEnum<["room", "locker"]>>;
    assignedResourceNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    checkoutAt: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    flowStep: z.ZodEffects<z.ZodOptional<z.ZodEnum<["LANGUAGE", "RENTAL", "WAITLIST_PREFERENCES", "WAITLIST_BACKUP", "PAYMENT", "AGREEMENT", "COMPLETE"]>>, "LANGUAGE" | "RENTAL" | "WAITLIST_PREFERENCES" | "WAITLIST_BACKUP" | "PAYMENT" | "AGREEMENT" | "COMPLETE" | undefined, unknown>;
    flowVersion: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    flowLastActor: z.ZodEffects<z.ZodOptional<z.ZodEnum<["CUSTOMER", "EMPLOYEE", "SYSTEM"]>>, "CUSTOMER" | "EMPLOYEE" | "SYSTEM" | undefined, unknown>;
    flowLastCommandId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckinOptionHighlightedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    step: z.ZodEnum<["LANGUAGE", "MEMBERSHIP", "WAITLIST_BACKUP"]>;
    option: z.ZodNullable<z.ZodString>;
    by: z.ZodLiteral<"EMPLOYEE">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    step: z.ZodEnum<["LANGUAGE", "MEMBERSHIP", "WAITLIST_BACKUP"]>;
    option: z.ZodNullable<z.ZodString>;
    by: z.ZodLiteral<"EMPLOYEE">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    step: z.ZodEnum<["LANGUAGE", "MEMBERSHIP", "WAITLIST_BACKUP"]>;
    option: z.ZodNullable<z.ZodString>;
    by: z.ZodLiteral<"EMPLOYEE">;
}, z.ZodTypeAny, "passthrough">>;
export declare const SelectionProposedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    proposedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    proposedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    proposedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, z.ZodTypeAny, "passthrough">>;
export declare const SelectionLockedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    confirmedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
    lockedAt: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    confirmedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
    lockedAt: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    confirmedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
    lockedAt: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const SelectionForcedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    forcedBy: z.ZodLiteral<"EMPLOYEE">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    forcedBy: z.ZodLiteral<"EMPLOYEE">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    forcedBy: z.ZodLiteral<"EMPLOYEE">;
}, z.ZodTypeAny, "passthrough">>;
export declare const SelectionAcknowledgedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    acknowledgedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    acknowledgedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    acknowledgedBy: z.ZodEnum<["CUSTOMER", "EMPLOYEE"]>;
}, z.ZodTypeAny, "passthrough">>;
export declare const CustomerConfirmationRequiredPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
    selectedType: z.ZodString;
    selectedNumber: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
    selectedType: z.ZodString;
    selectedNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
    selectedType: z.ZodString;
    selectedNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const CustomerConfirmedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    confirmedType: z.ZodString;
    confirmedNumber: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    confirmedType: z.ZodString;
    confirmedNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    confirmedType: z.ZodString;
    confirmedNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const CustomerDeclinedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    requestedType: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const AssignmentCreatedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    roomId: z.ZodOptional<z.ZodString>;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerId: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    roomId: z.ZodOptional<z.ZodString>;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerId: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    rentalType: z.ZodString;
    roomId: z.ZodOptional<z.ZodString>;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerId: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const AssignmentFailedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    reason: z.ZodString;
    requestedRoomId: z.ZodOptional<z.ZodString>;
    requestedLockerId: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    reason: z.ZodString;
    requestedRoomId: z.ZodOptional<z.ZodString>;
    requestedLockerId: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    reason: z.ZodString;
    requestedRoomId: z.ZodOptional<z.ZodString>;
    requestedLockerId: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const InventoryUpdatedPayloadSchema: z.ZodObject<{
    inventory: z.ZodObject<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">>;
    available: z.ZodOptional<z.ZodObject<{
        rooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        rawRooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        waitlistDemand: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        lockers: z.ZodNumber;
        total: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    inventory: z.ZodObject<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">>;
    available: z.ZodOptional<z.ZodObject<{
        rooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        rawRooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        waitlistDemand: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        lockers: z.ZodNumber;
        total: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    inventory: z.ZodObject<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        byType: z.ZodObject<{
            STANDARD: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            DOUBLE: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            SPECIAL: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
            LOCKER: z.ZodObject<{
                clean: z.ZodNumber;
                cleaning: z.ZodNumber;
                dirty: z.ZodNumber;
                total: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }, {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }, {
            STANDARD: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            DOUBLE: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            SPECIAL: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
            LOCKER: {
                dirty: number;
                clean: number;
                cleaning: number;
                total: number;
            };
        }>;
        overall: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
        lockers: z.ZodObject<{
            clean: z.ZodNumber;
            cleaning: z.ZodNumber;
            dirty: z.ZodNumber;
            total: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }, {
            dirty: number;
            clean: number;
            cleaning: number;
            total: number;
        }>;
    }, z.ZodTypeAny, "passthrough">>;
    available: z.ZodOptional<z.ZodObject<{
        rooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        rawRooms: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        waitlistDemand: z.ZodObject<{
            SPECIAL: z.ZodNumber;
            DOUBLE: z.ZodNumber;
            STANDARD: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }, {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        }>;
        lockers: z.ZodNumber;
        total: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }, {
        total: number;
        lockers: number;
        rooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        rawRooms: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
        waitlistDemand: {
            STANDARD: number;
            DOUBLE: number;
            SPECIAL: number;
        };
    }>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const WaitlistCreatedPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    waitlistId: z.ZodString;
    desiredType: z.ZodString;
    backupType: z.ZodString;
    position: z.ZodNumber;
    estimatedReadyAt: z.ZodOptional<z.ZodString>;
    upgradeFee: z.ZodOptional<z.ZodNumber>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    sessionId: z.ZodString;
    waitlistId: z.ZodString;
    desiredType: z.ZodString;
    backupType: z.ZodString;
    position: z.ZodNumber;
    estimatedReadyAt: z.ZodOptional<z.ZodString>;
    upgradeFee: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    sessionId: z.ZodString;
    waitlistId: z.ZodString;
    desiredType: z.ZodString;
    backupType: z.ZodString;
    position: z.ZodNumber;
    estimatedReadyAt: z.ZodOptional<z.ZodString>;
    upgradeFee: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">>;
export declare const UpgradeHoldAvailablePayloadSchema: z.ZodObject<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
    expiresAt: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
    expiresAt: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
    expiresAt: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const UpgradeOfferExpiredPayloadSchema: z.ZodObject<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    waitlistId: z.ZodString;
    customerName: z.ZodString;
    desiredTier: z.ZodString;
    roomId: z.ZodString;
    roomNumber: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const RoomStatusChangedPayloadSchema: z.ZodObject<{
    roomId: z.ZodString;
    previousStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    newStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    changedBy: z.ZodString;
    override: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    roomId: z.ZodString;
    previousStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    newStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    changedBy: z.ZodString;
    override: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    roomId: z.ZodString;
    previousStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    newStatus: z.ZodNativeEnum<{
        readonly DIRTY: "DIRTY";
        readonly CLEANING: "CLEANING";
        readonly CLEAN: "CLEAN";
        readonly OCCUPIED: "OCCUPIED";
    }>;
    changedBy: z.ZodString;
    override: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckoutRequestSummarySchema: z.ZodObject<{
    requestId: z.ZodString;
    customerName: z.ZodString;
    membershipNumber: z.ZodOptional<z.ZodString>;
    rentalType: z.ZodString;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
    scheduledCheckoutAt: z.ZodDate;
    currentTime: z.ZodDate;
    lateMinutes: z.ZodNumber;
    lateFeeAmount: z.ZodNumber;
    banApplied: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    requestId: z.ZodString;
    customerName: z.ZodString;
    membershipNumber: z.ZodOptional<z.ZodString>;
    rentalType: z.ZodString;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
    scheduledCheckoutAt: z.ZodDate;
    currentTime: z.ZodDate;
    lateMinutes: z.ZodNumber;
    lateFeeAmount: z.ZodNumber;
    banApplied: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    requestId: z.ZodString;
    customerName: z.ZodString;
    membershipNumber: z.ZodOptional<z.ZodString>;
    rentalType: z.ZodString;
    roomNumber: z.ZodOptional<z.ZodString>;
    lockerNumber: z.ZodOptional<z.ZodString>;
    scheduledCheckoutAt: z.ZodDate;
    currentTime: z.ZodDate;
    lateMinutes: z.ZodNumber;
    lateFeeAmount: z.ZodNumber;
    banApplied: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckoutRequestedPayloadSchema: z.ZodObject<{
    request: z.ZodObject<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    request: z.ZodObject<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    request: z.ZodObject<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        requestId: z.ZodString;
        customerName: z.ZodString;
        membershipNumber: z.ZodOptional<z.ZodString>;
        rentalType: z.ZodString;
        roomNumber: z.ZodOptional<z.ZodString>;
        lockerNumber: z.ZodOptional<z.ZodString>;
        scheduledCheckoutAt: z.ZodDate;
        currentTime: z.ZodDate;
        lateMinutes: z.ZodNumber;
        lateFeeAmount: z.ZodNumber;
        banApplied: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckoutClaimedPayloadSchema: z.ZodObject<{
    requestId: z.ZodString;
    claimedBy: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    requestId: z.ZodString;
    claimedBy: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    requestId: z.ZodString;
    claimedBy: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckoutUpdatedPayloadSchema: z.ZodObject<{
    requestId: z.ZodString;
    itemsConfirmed: z.ZodBoolean;
    feePaid: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    requestId: z.ZodString;
    itemsConfirmed: z.ZodBoolean;
    feePaid: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    requestId: z.ZodString;
    itemsConfirmed: z.ZodBoolean;
    feePaid: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
export declare const CheckoutCompletedPayloadSchema: z.ZodObject<{
    requestId: z.ZodString;
    kioskDeviceId: z.ZodString;
    success: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    requestId: z.ZodString;
    kioskDeviceId: z.ZodString;
    success: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    requestId: z.ZodString;
    kioskDeviceId: z.ZodString;
    success: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
export declare const WaitlistUpdatedPayloadSchema: z.ZodObject<{
    waitlistId: z.ZodString;
    status: z.ZodString;
    visitId: z.ZodOptional<z.ZodString>;
    desiredTier: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    waitlistId: z.ZodString;
    status: z.ZodString;
    visitId: z.ZodOptional<z.ZodString>;
    desiredTier: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    waitlistId: z.ZodString;
    status: z.ZodString;
    visitId: z.ZodOptional<z.ZodString>;
    desiredTier: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type ParsedRealtimeEvent = ({
    type: 'SESSION_UPDATED';
    payload: SessionUpdatedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CHECKIN_OPTION_HIGHLIGHTED';
    payload: CheckinOptionHighlightedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'SELECTION_PROPOSED';
    payload: SelectionProposedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'SELECTION_LOCKED';
    payload: SelectionLockedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'SELECTION_FORCED';
    payload: SelectionForcedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'SELECTION_ACKNOWLEDGED';
    payload: SelectionAcknowledgedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CUSTOMER_CONFIRMATION_REQUIRED';
    payload: CustomerConfirmationRequiredPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CUSTOMER_CONFIRMED';
    payload: CustomerConfirmedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CUSTOMER_DECLINED';
    payload: CustomerDeclinedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'ASSIGNMENT_CREATED';
    payload: AssignmentCreatedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'ASSIGNMENT_FAILED';
    payload: AssignmentFailedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'INVENTORY_UPDATED';
    payload: InventoryUpdatedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'WAITLIST_CREATED';
    payload: WaitlistCreatedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'WAITLIST_UPDATED';
    payload: z.infer<typeof WaitlistUpdatedPayloadSchema>;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'UPGRADE_HOLD_AVAILABLE';
    payload: UpgradeHoldAvailablePayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'UPGRADE_OFFER_EXPIRED';
    payload: UpgradeOfferExpiredPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'ROOM_STATUS_CHANGED';
    payload: RoomStatusChangedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CHECKOUT_REQUESTED';
    payload: CheckoutRequestedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CHECKOUT_CLAIMED';
    payload: CheckoutClaimedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CHECKOUT_UPDATED';
    payload: CheckoutUpdatedPayload;
} & Pick<RealtimeEvent, 'timestamp'>) | ({
    type: 'CHECKOUT_COMPLETED';
    payload: CheckoutCompletedPayload;
} & Pick<RealtimeEvent, 'timestamp'>);
export declare function safeParseRealtimeEvent(input: unknown): ParsedRealtimeEvent | null;
//# sourceMappingURL=realtimeSchemas.d.ts.map