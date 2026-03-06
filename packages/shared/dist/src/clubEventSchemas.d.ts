import { z } from 'zod';
export declare const ClubEventDomainSchema: z.ZodEnum<["HR", "SALES", "CHECKIN", "CHECKOUT", "INVENTORY", "NOTE", "ADMIN"]>;
export type ClubEventDomain = z.infer<typeof ClubEventDomainSchema>;
export declare const ClubEventTypeSchema: z.ZodEnum<["EMPLOYEE_CLOCK_IN", "EMPLOYEE_CLOCK_OUT", "REGISTER_SIGN_IN", "REGISTER_SIGN_OUT", "BREAK_START", "BREAK_END", "SALE_COMPLETED", "ADDON_SOLD", "UPGRADE_PAID", "LATE_FEE_CHARGED", "REFUND_ISSUED", "CHECKIN_STARTED", "CHECKIN_COMPLETED", "CHECKIN_CANCELLED", "MEMBERSHIP_SELECTED", "CHECKOUT_REQUESTED", "CHECKOUT_COMPLETED", "ROOM_STATUS_CHANGED", "ROOM_ASSIGNED", "LOCKER_ASSIGNED", "NOTE_ADDED", "PAST_DUE_WAIVED", "OVERRIDE_APPLIED"]>;
export type ClubEventType = z.infer<typeof ClubEventTypeSchema>;
export declare const ClubEventSourceAppSchema: z.ZodEnum<["EMPLOYEE_REGISTER", "OFFICE_DASHBOARD", "CUSTOMER_KIOSK", "SYSTEM"]>;
export type ClubEventSourceApp = z.infer<typeof ClubEventSourceAppSchema>;
export interface ClubEventRow {
    id: string;
    occurredAt: string;
    eventType: ClubEventType;
    eventDomain: ClubEventDomain;
    sourceApp: ClubEventSourceApp;
    registerId: string | null;
    staffId: string | null;
    staffName: string | null;
    customerId: string | null;
    customerName: string | null;
    visitId: string | null;
    orderId: string | null;
    amount: number | null;
    currency: string;
    summary: string;
    metadata: Record<string, unknown>;
}
//# sourceMappingURL=clubEventSchemas.d.ts.map