import { z } from 'zod';

// ---------------------------------------------------------------------------
// Event Domain — broad categories for filtering the club log
// ---------------------------------------------------------------------------
export const ClubEventDomainSchema = z.enum([
  'HR',        // Employee clock-in/out, register sign-in/out, breaks
  'SALES',     // Orders paid, add-ons, upgrades, late fees, refunds
  'CHECKIN',   // Customer check-in flow (start → complete)
  'CHECKOUT',  // Customer checkout (request → complete)
  'INVENTORY', // Room/locker status changes, assignments
  'ADMIN',     // Notes, overrides, past-due waivers
]);
export type ClubEventDomain = z.infer<typeof ClubEventDomainSchema>;

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
export type ClubEventType = z.infer<typeof ClubEventTypeSchema>;

// ---------------------------------------------------------------------------
// Source App — which application emitted the event
// ---------------------------------------------------------------------------
export const ClubEventSourceAppSchema = z.enum([
  'EMPLOYEE_REGISTER',
  'OFFICE_DASHBOARD',
  'CUSTOMER_KIOSK',
  'SYSTEM',
]);
export type ClubEventSourceApp = z.infer<typeof ClubEventSourceAppSchema>;

// ---------------------------------------------------------------------------
// Club Event row type (matches club_events table shape)
// ---------------------------------------------------------------------------
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
  amountCents: number | null;
  currency: string;
  summary: string;
  metadata: Record<string, unknown>;
}
