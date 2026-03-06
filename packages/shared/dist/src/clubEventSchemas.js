import { z } from 'zod';
// ---------------------------------------------------------------------------
// Event Domain — broad categories for filtering the club log
// ---------------------------------------------------------------------------
export const ClubEventDomainSchema = z.enum([
    'HR', // Employee clock-in/out, register sign-in/out, breaks
    'SALES', // Orders paid, add-ons, upgrades, late fees, refunds
    'CHECKIN', // Customer check-in flow (start → complete)
    'CHECKOUT', // Customer checkout (request → complete)
    'INVENTORY', // Room/locker status changes, assignments
    'NOTE', // Customer notes
    'ADMIN', // Overrides, past-due waivers
]);
// ---------------------------------------------------------------------------
// Event Type — specific action within a domain
// ---------------------------------------------------------------------------
export const ClubEventTypeSchema = z.enum([
    // HR domain
    'EMPLOYEE_CLOCK_IN',
    'EMPLOYEE_CLOCK_OUT',
    'REGISTER_SIGN_IN',
    'REGISTER_SIGN_OUT',
    'BREAK_START',
    'BREAK_END',
    // SALES domain
    'SALE_COMPLETED',
    'ADDON_SOLD',
    'UPGRADE_PAID',
    'LATE_FEE_CHARGED',
    'REFUND_ISSUED',
    // CHECKIN domain
    'CHECKIN_STARTED',
    'CHECKIN_COMPLETED',
    'CHECKIN_CANCELLED',
    'MEMBERSHIP_SELECTED',
    // CHECKOUT domain
    'CHECKOUT_REQUESTED',
    'CHECKOUT_COMPLETED',
    // INVENTORY domain
    'ROOM_STATUS_CHANGED',
    'ROOM_ASSIGNED',
    'LOCKER_ASSIGNED',
    // ADMIN domain
    'NOTE_ADDED',
    'PAST_DUE_WAIVED',
    'OVERRIDE_APPLIED',
]);
// ---------------------------------------------------------------------------
// Source App — which application emitted the event
// ---------------------------------------------------------------------------
export const ClubEventSourceAppSchema = z.enum([
    'EMPLOYEE_REGISTER',
    'OFFICE_DASHBOARD',
    'CUSTOMER_KIOSK',
    'SYSTEM',
]);
//# sourceMappingURL=clubEventSchemas.js.map