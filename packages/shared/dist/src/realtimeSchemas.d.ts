import { z } from 'zod';
import type { AssignmentCreatedPayload, AssignmentFailedPayload, CheckinOptionHighlightedPayload, CheckinFlowCommandRequest, CheckoutClaimedPayload, CheckoutCompletedPayload, CheckoutRequestedPayload, CheckoutRequestSummary, CheckoutUpdatedPayload, CustomerConfirmationRequiredPayload, CustomerConfirmedPayload, CustomerDeclinedPayload, InventoryUpdatedPayload, RoomStatusChangedPayload, SelectionAcknowledgedPayload, SelectionForcedPayload, SelectionLockedPayload, SelectionProposedPayload, SessionUpdatedPayload, UpgradeHoldAvailablePayload, UpgradeOfferExpiredPayload, WaitlistCreatedPayload, RealtimeEvent } from './types.js';
export declare const CheckinFlowCommandRequestSchema: z.ZodType<CheckinFlowCommandRequest>;
export declare const SessionUpdatedPayloadSchema: z.ZodType<SessionUpdatedPayload, z.ZodTypeDef, unknown>;
export declare const CheckinOptionHighlightedPayloadSchema: z.ZodType<CheckinOptionHighlightedPayload>;
export declare const SelectionProposedPayloadSchema: z.ZodType<SelectionProposedPayload>;
export declare const SelectionLockedPayloadSchema: z.ZodType<SelectionLockedPayload>;
export declare const SelectionForcedPayloadSchema: z.ZodType<SelectionForcedPayload>;
export declare const SelectionAcknowledgedPayloadSchema: z.ZodType<SelectionAcknowledgedPayload>;
export declare const CustomerConfirmationRequiredPayloadSchema: z.ZodType<CustomerConfirmationRequiredPayload>;
export declare const CustomerConfirmedPayloadSchema: z.ZodType<CustomerConfirmedPayload>;
export declare const CustomerDeclinedPayloadSchema: z.ZodType<CustomerDeclinedPayload>;
export declare const AssignmentCreatedPayloadSchema: z.ZodType<AssignmentCreatedPayload>;
export declare const AssignmentFailedPayloadSchema: z.ZodType<AssignmentFailedPayload>;
export declare const InventoryUpdatedPayloadSchema: z.ZodType<InventoryUpdatedPayload>;
export declare const WaitlistCreatedPayloadSchema: z.ZodType<WaitlistCreatedPayload>;
export declare const UpgradeHoldAvailablePayloadSchema: z.ZodType<UpgradeHoldAvailablePayload>;
export declare const UpgradeOfferExpiredPayloadSchema: z.ZodType<UpgradeOfferExpiredPayload>;
export declare const RoomStatusChangedPayloadSchema: z.ZodType<RoomStatusChangedPayload>;
export declare const CheckoutRequestSummarySchema: z.ZodType<CheckoutRequestSummary>;
export declare const CheckoutRequestedPayloadSchema: z.ZodType<CheckoutRequestedPayload>;
export declare const CheckoutClaimedPayloadSchema: z.ZodType<CheckoutClaimedPayload>;
export declare const CheckoutUpdatedPayloadSchema: z.ZodType<CheckoutUpdatedPayload>;
export declare const CheckoutCompletedPayloadSchema: z.ZodType<CheckoutCompletedPayload>;
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