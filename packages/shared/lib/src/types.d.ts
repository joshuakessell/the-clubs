import { RoomStatus, RoomType } from './enums.js';
/**
 * Represents a room in the club.
 */
export interface Room {
    id: string;
    number: string;
    type: RoomType;
    status: RoomStatus;
    floor: number;
    lastStatusChange: Date;
    assignedTo?: string;
    overrideFlag: boolean;
}
/**
 * Represents a locker in the club.
 */
export interface Locker {
    id: string;
    number: string;
    status: RoomStatus;
    assignedTo?: string;
}
/**
 * Summary of room inventory by status.
 */
export interface InventorySummary {
    clean: number;
    cleaning: number;
    dirty: number;
    total: number;
}
/**
 * Detailed inventory breakdown by room type.
 */
export interface DetailedInventory {
    byType: Record<RoomType, InventorySummary>;
    overall: InventorySummary;
    lockers: InventorySummary;
}
/**
 * Realtime event types for live updates.
 */
export type RealtimeEventType = 'ROOM_STATUS_CHANGED' | 'INVENTORY_UPDATED' | 'ROOM_ASSIGNED' | 'ROOM_RELEASED' | 'SESSION_UPDATED' | 'CHECKIN_OPTION_HIGHLIGHTED' | 'SELECTION_PROPOSED' | 'SELECTION_FORCED' | 'SELECTION_LOCKED' | 'SELECTION_ACKNOWLEDGED' | 'WAITLIST_CREATED' | 'UPGRADE_HOLD_AVAILABLE' | 'UPGRADE_OFFER_EXPIRED' | 'ASSIGNMENT_CREATED' | 'ASSIGNMENT_FAILED' | 'CUSTOMER_CONFIRMATION_REQUIRED' | 'CUSTOMER_CONFIRMED' | 'CUSTOMER_DECLINED' | 'CHECKOUT_REQUESTED' | 'CHECKOUT_CLAIMED' | 'CHECKOUT_UPDATED' | 'CHECKOUT_COMPLETED' | 'WAITLIST_UPDATED' | 'REGISTER_SESSION_UPDATED';
/**
 * Base realtime event structure.
 */
export interface RealtimeEvent<T = unknown> {
    type: RealtimeEventType;
    payload: T;
    timestamp: string;
}
export type CustomerIdType = 'STATE_ID' | 'DRIVERS_LICENSE' | 'PASSPORT' | 'OTHER';
/**
 * Room status change event payload.
 */
export interface RoomStatusChangedPayload {
    roomId: string;
    previousStatus: RoomStatus;
    newStatus: RoomStatus;
    changedBy: string;
    override: boolean;
    reason?: string;
}
/**
 * Snapshot of effective availability (rooms supply minus active/offered waitlist demand),
 * matching GET /v1/inventory/available.
 */
export interface InventoryAvailableSnapshot {
    rooms: Record<'SPECIAL' | 'DOUBLE' | 'STANDARD', number>;
    rawRooms: Record<'SPECIAL' | 'DOUBLE' | 'STANDARD', number>;
    waitlistDemand: Record<'SPECIAL' | 'DOUBLE' | 'STANDARD', number>;
    lockers: number;
    total: number;
}
/**
 * Inventory update event payload.
 */
export interface InventoryUpdatedPayload {
    inventory: DetailedInventory;
    /**
     * Optional: includes effective availability snapshot so UIs can update counts immediately
     * without refetching. Clients may ignore this and just refetch endpoints on the event.
     */
    available?: InventoryAvailableSnapshot;
}
/**
 * Session updated event payload.
 * Emitted whenever a lane session is created or updated.
 */
export interface SessionUpdatedPayload {
    sessionId: string;
    customerId?: string;
    customerName: string;
    membershipNumber?: string;
    /**
     * Customer membership expiration date (YYYY-MM-DD).
     * If present and in the future (inclusive), the customer is treated as an active member.
     */
    customerMembershipValidUntil?: string;
    /**
     * Explicit membership choice made during the kiosk membership step.
     * - ONE_TIME: customer chose the one-time membership option
     * - SIX_MONTH: customer chose the 6-month membership option
     *
     * This is used for kiosk/employee UI coordination only; pricing logic remains server-authoritative.
     */
    membershipChoice?: 'ONE_TIME' | 'SIX_MONTH' | null;
    /**
     * Customer kiosk requested a membership purchase/renewal to be included in the payment quote.
     * Server-authoritative (stored on lane_sessions).
     */
    membershipPurchaseIntent?: 'PURCHASE' | 'RENEW';
    /**
     * Timestamp (ISO) when the customer kiosk acknowledged completion (tapped OK) and returned to idle UI.
     * This must NOT end/clear the lane session; employee-kiosk reset is the only formal completion path.
     */
    kioskAcknowledgedAt?: string;
    allowedRentals: string[];
    mode?: 'CHECKIN' | 'RENEWAL';
    renewalHours?: 2 | 6;
    blockEndsAt?: string;
    visitId?: string;
    /**
     * If present, customer requested a higher tier (unavailable) and selected a backup tier.
     * This represents the customer's pending upgrade intent for this visit.
     */
    waitlistDesiredType?: string;
    waitlistDesiredTypes?: string[];
    backupRentalType?: string;
    waitlistRequestedResourceNumber?: string;
    waitlistRequestedResourceType?: 'room' | 'locker';
    status?: string;
    proposedRentalType?: string;
    proposedBy?: 'CUSTOMER' | 'EMPLOYEE';
    selectionConfirmed?: boolean;
    selectionConfirmedBy?: 'CUSTOMER' | 'EMPLOYEE';
    customerPrimaryLanguage?: 'EN' | 'ES';
    /**
     * Customer date of birth (YYYY-MM-DD), if known.
     */
    customerDob?: string;
    customerDobMonthDay?: string;
    /**
     * Customer ID/document number, if known.
     */
    customerIdNumber?: string;
    customerLastVisitAt?: string;
    /**
     * Customer ID expiration date (YYYY-MM-DD), if known.
     */
    customerIdExpirationDate?: string;
    /**
     * Customer ID type when known.
     */
    customerIdType?: CustomerIdType;
    /**
     * Freeform description when customerIdType is OTHER.
     */
    customerIdTypeOther?: string;
    /**
     * True when the customer has an encrypted lookup marker (e.g., hashed ID scan) stored on file.
     * This enables faster and more reliable future lookup from ID scans without storing raw scan data.
     */
    customerHasEncryptedLookupMarker?: boolean;
    /**
     * ID scan validation issues (blocks check-in until resolved).
     */
    idScanIssue?: 'ID_EXPIRED' | 'UNDERAGE';
    pastDueBalance?: number;
    pastDueBlocked?: boolean;
    pastDueBypassed?: boolean;
    paymentIntentId?: string;
    paymentStatus?: 'DUE' | 'PAID';
    paymentMethod?: 'CASH' | 'CREDIT';
    paymentTotal?: number;
    paymentLineItems?: Array<{
        description: string;
        amount: number;
    }>;
    paymentFailureReason?: string;
    ledgerLineItems?: Array<{
        description: string;
        amount: number;
    }>;
    ledgerTotal?: number;
    agreementSigned?: boolean;
    agreementBypassPending?: boolean;
    agreementSignedMethod?: 'DIGITAL' | 'MANUAL';
    assignedResourceType?: 'room' | 'locker';
    assignedResourceNumber?: string;
    checkoutAt?: string;
    flowStep?: 'LANGUAGE' | 'RENTAL' | 'WAITLIST_PREFERENCES' | 'WAITLIST_BACKUP' | 'PAYMENT' | 'AGREEMENT' | 'COMPLETE';
    flowVersion?: number;
    flowLastActor?: 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM';
    flowLastCommandId?: string;
}
export type CheckinFlowStep = 'LANGUAGE' | 'RENTAL' | 'WAITLIST_PREFERENCES' | 'WAITLIST_BACKUP' | 'PAYMENT' | 'AGREEMENT' | 'COMPLETE';
export type CheckinFlowActor = 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM';
export type CheckinFlowCommandType = 'SET_STEP' | 'BACK_STEP' | 'CANCEL_STEP';
export interface CheckinFlowCommandRequest {
    sessionId: string;
    commandId: string;
    actor: CheckinFlowActor;
    expectedFlowVersion?: number;
    type: CheckinFlowCommandType;
    payload?: Record<string, unknown>;
}
/**
 * Ephemeral UI-only event to coordinate employee "pending/highlight" state with the customer kiosk
 * without mutating server-authoritative selection state.
 */
export interface CheckinOptionHighlightedPayload {
    sessionId: string;
    step: 'LANGUAGE' | 'MEMBERSHIP' | 'WAITLIST_BACKUP';
    /**
     * Option identifier for the step:
     * - LANGUAGE: 'EN' | 'ES'
     * - MEMBERSHIP: 'ONE_TIME' | 'SIX_MONTH'
     * - WAITLIST_BACKUP: rental type (e.g., 'LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL')
     *
     * null clears the highlight for the step.
     */
    option: string | null;
    by: 'EMPLOYEE';
}
/**
 * Selection proposed event payload.
 */
export interface SelectionProposedPayload {
    sessionId: string;
    rentalType: string;
    proposedBy: 'CUSTOMER' | 'EMPLOYEE';
}
export interface SelectionForcedPayload {
    sessionId: string;
    rentalType: string;
    forcedBy: 'EMPLOYEE';
}
/**
 * Selection locked event payload.
 */
export interface SelectionLockedPayload {
    sessionId: string;
    rentalType: string;
    confirmedBy: 'CUSTOMER' | 'EMPLOYEE';
    lockedAt: string;
}
/**
 * Selection acknowledged event payload.
 */
export interface SelectionAcknowledgedPayload {
    sessionId: string;
    acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE';
}
/**
 * Waitlist created event payload.
 */
export interface WaitlistCreatedPayload {
    sessionId: string;
    waitlistId: string;
    desiredType: string;
    backupType: string;
    position: number;
    estimatedReadyAt?: string;
    upgradeFee?: number;
}
export interface UpgradeHoldAvailablePayload {
    waitlistId: string;
    customerName: string;
    desiredTier: string;
    roomId: string;
    roomNumber: string;
    expiresAt: string;
}
export interface UpgradeOfferExpiredPayload {
    waitlistId: string;
    customerName: string;
    desiredTier: string;
    roomId: string;
    roomNumber: string;
}
/**
 * Assignment created event payload.
 */
export interface AssignmentCreatedPayload {
    sessionId: string;
    roomId?: string;
    roomNumber?: string;
    lockerId?: string;
    lockerNumber?: string;
    rentalType: string;
}
/**
 * Assignment failed event payload.
 */
export interface AssignmentFailedPayload {
    sessionId: string;
    reason: string;
    requestedRoomId?: string;
    requestedLockerId?: string;
}
/**
 * Customer confirmation required event payload.
 */
export interface CustomerConfirmationRequiredPayload {
    sessionId: string;
    requestedType: string;
    selectedType: string;
    selectedNumber: string;
}
/**
 * Customer confirmed event payload.
 */
export interface CustomerConfirmedPayload {
    sessionId: string;
    confirmedType: string;
    confirmedNumber: string;
}
/**
 * Customer declined event payload.
 */
export interface CustomerDeclinedPayload {
    sessionId: string;
    requestedType: string;
}
export interface Visit {
    id: string;
    customerId: string;
    startedAt: Date;
    endedAt?: Date;
}
export interface CheckinBlock {
    id: string;
    visitId: string;
    blockType: 'INITIAL' | 'RENEWAL' | 'FINAL2H';
    startsAt: Date;
    endsAt: Date;
    rentalType: string;
    roomId?: string;
    lockerId?: string;
}
export interface ActiveVisit {
    id: string;
    customerName: string;
    membershipNumber?: string;
    currentCheckoutAt: Date;
}
export type CheckoutRequestStatus = 'SUBMITTED' | 'CLAIMED' | 'VERIFIED' | 'CANCELLED';
export interface CheckoutChecklist {
    key?: boolean;
    towel?: boolean;
    sheets?: boolean;
    remote?: boolean;
}
export interface ResolvedCheckoutKey {
    keyTagId: string;
    occupancyId: string;
    customerId: string;
    customerName: string;
    membershipNumber?: string;
    rentalType: string;
    roomId?: string;
    roomNumber?: string;
    lockerId?: string;
    lockerNumber?: string;
    scheduledCheckoutAt: Date | string;
    hasTvRemote: boolean;
    lateMinutes: number;
    lateFeeAmount: number;
    banApplied: boolean;
}
export interface CheckoutRequestSummary {
    requestId: string;
    customerId?: string;
    customerName: string;
    membershipNumber?: string;
    rentalType: string;
    roomNumber?: string;
    lockerNumber?: string;
    scheduledCheckoutAt: Date;
    currentTime: Date;
    lateMinutes: number;
    lateFeeAmount: number;
    banApplied: boolean;
}
export interface CheckoutRequestedPayload {
    request: CheckoutRequestSummary;
}
export interface CheckoutClaimedPayload {
    requestId: string;
    claimedBy: string;
}
export interface CheckoutUpdatedPayload {
    requestId: string;
    itemsConfirmed: boolean;
    feePaid: boolean;
}
export interface CheckoutCompletedPayload {
    requestId: string;
    kioskDeviceId: string;
    success: boolean;
}
export type ManualCheckoutResourceType = 'ROOM' | 'LOCKER';
export interface ManualCheckoutCandidate {
    occupancyId: string;
    resourceType: ManualCheckoutResourceType;
    number: string;
    customerName: string;
    checkinAt: Date | string;
    scheduledCheckoutAt: Date | string;
    isOverdue: boolean;
}
export interface ManualCheckoutResolveResponse {
    occupancyId: string;
    resourceType: ManualCheckoutResourceType;
    number: string;
    customerName: string;
    checkinAt: Date | string;
    scheduledCheckoutAt: Date | string;
    lateMinutes: number;
    fee: number;
    banApplied: boolean;
}
export interface ManualCheckoutCompleteResponse extends ManualCheckoutResolveResponse {
    alreadyCheckedOut?: boolean;
}
export type CashDrawerSessionStatus = 'OPEN' | 'CLOSED';
export type CashDrawerEventType = 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'NO_SALE_OPEN' | 'ADJUSTMENT';
export type StaffBreakStatus = 'OPEN' | 'CLOSED';
export type StaffBreakType = 'MEAL' | 'REST' | 'OTHER';
export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type OrderLineItemKind = 'RETAIL' | 'ADDON' | 'UPGRADE' | 'LATE_FEE' | 'MANUAL';
export type ExternalProviderEntityType = 'customer' | 'payment' | 'refund' | 'order' | 'shift' | 'timeclock_session' | 'cash_event' | 'receipt';
export interface CashDrawerSession {
    id: string;
    registerSessionId: string;
    openedByStaffId: string;
    openedAt: Date | string;
    openingFloatCents: number;
    closedByStaffId?: string | null;
    closedAt?: Date | string | null;
    countedCashCents?: number | null;
    expectedCashCents?: number | null;
    overShortCents?: number | null;
    notes?: string | null;
    status: CashDrawerSessionStatus;
}
export interface CashDrawerEvent {
    id: string;
    cashDrawerSessionId: string;
    occurredAt: Date | string;
    type: CashDrawerEventType;
    amountCents?: number | null;
    reason?: string | null;
    createdByStaffId: string;
    metadataJson?: Record<string, unknown> | null;
}
export interface StaffBreakSession {
    id: string;
    staffId: string;
    timeclockSessionId: string;
    startedAt: Date | string;
    endedAt?: Date | string | null;
    breakType: StaffBreakType;
    status: StaffBreakStatus;
    notes?: string | null;
}
export interface Order {
    id: string;
    customerId?: string | null;
    registerSessionId?: string | null;
    createdByStaffId?: string | null;
    createdAt: Date | string;
    status: OrderStatus;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
    totalCents: number;
    currency: string;
    metadataJson?: Record<string, unknown> | null;
}
export interface OrderLineItem {
    id: string;
    orderId: string;
    kind: OrderLineItemKind;
    sku?: string | null;
    name: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    metadataJson?: Record<string, unknown> | null;
}
export interface Receipt {
    id: string;
    orderId: string;
    issuedAt: Date | string;
    receiptNumber: string;
    receiptJson: Record<string, unknown>;
    pdfStorageKey?: string | null;
    metadataJson?: Record<string, unknown> | null;
}
export interface ExternalProviderRef {
    id: string;
    provider: string;
    entityType: ExternalProviderEntityType;
    internalId: string;
    externalId: string;
    externalVersion?: string | null;
    createdAt: Date | string;
}
/**
 * Register session updated event payload.
 * Emitted when a register session is created, signed out, force signed out, or expires.
 */
export interface RegisterSessionUpdatedPayload {
    registerNumber: 1 | 2 | 3;
    active: boolean;
    sessionId: string | null;
    employee: {
        id: string;
        displayName: string;
        role: string;
    } | null;
    deviceId: string | null;
    createdAt: string | null;
    lastHeartbeatAt: string | null;
    reason: 'CONFIRMED' | 'SIGNED_OUT' | 'FORCED_SIGN_OUT' | 'TTL_EXPIRED' | 'DEVICE_DISABLED';
}
//# sourceMappingURL=types.d.ts.map