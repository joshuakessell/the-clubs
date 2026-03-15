import type pg from 'pg';

export type PoolClient = pg.PoolClient;

export type RoomRentalType = 'STANDARD' | 'DOUBLE' | 'SPECIAL';

export interface LaneSessionRow {
  id: string;
  lane_id: string;
  status: string;
  staff_id: string | null;
  customer_id: string | null;
  customer_display_name: string | null;
  membership_number: string | null;
  desired_rental_type: string | null;
  waitlist_desired_type: string | null;
  waitlist_desired_types_json?: unknown;
  backup_rental_type: string | null;
  waitlist_requested_resource_number?: string | null;
  waitlist_requested_resource_type?: 'room' | 'locker' | null;
  assigned_resource_id: string | null;
  assigned_resource_type: string | null;
  price_quote_json: unknown;
  disclaimers_ack_json: unknown;
  order_id: string | null;
  agreement_bypass_pending?: boolean;
  agreement_signed_method?: string | null;
  membership_purchase_intent?: 'PURCHASE' | 'RENEW' | null;
  membership_purchase_requested_at?: Date | null;
  membership_choice?: 'ONE_TIME' | 'SIX_MONTH' | null;
  kiosk_acknowledged_at?: Date | null;
  checkin_mode: string | null; // 'CHECKIN' or 'RENEWAL'
  renewal_hours?: number | null;
  proposed_rental_type: string | null;
  proposed_by: string | null;
  selection_confirmed: boolean;
  selection_confirmed_by: string | null;
  selection_locked_at: Date | null;
  flow_step?: string | null;
  flow_version?: number;
  flow_last_command_id?: string | null;
  flow_last_actor?: string | null;
  past_due_bypassed?: boolean;
  past_due_bypassed_by_staff_id?: string | null;
  past_due_bypassed_at?: Date | null;
  last_payment_decline_reason?: string | null;
  last_payment_decline_at?: Date | null;
  last_past_due_decline_reason?: string | null;
  last_past_due_decline_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerRow {
  id: string;
  name: string;
  dob: Date | null;
  membership_number: string | null;
  membership_card_type: string | null;
  membership_valid_until: Date | null;
  id_expiration_date?: Date | null;
  id_number?: string | null;
  id_state?: string | null;
  id_type?: string | null;
  id_type_other?: string | null;
  banned_until: Date | null;
  past_due_balance?: number;
  primary_language?: string;
  notes?: string;
  id_scan_hash?: string | null;
  id_scan_value?: string | null;
}

export interface ResourceRow {
  id: string;
  number: string;
  kind: string;
  tier?: string;
  status: string;
  assigned_to_customer_id: string | null;
}

/** @deprecated Use ResourceRow instead */
export type RoomRow = ResourceRow;
/** @deprecated Use ResourceRow instead */
export type LockerRow = ResourceRow;

export interface OrderRow {
  id: string;
  lane_session_id: string | null;
  visit_id: string | null;
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  tip?: number | null;
  total: number | string;
  status: string;
  quote_json: unknown;
  payment_method?: string;
  failure_reason?: string;
  failure_at?: Date | null;
  register_number?: number | null;
  paid_by_staff_id?: string | null;
  square_transaction_id?: string | null;
  paid_at?: Date | null;
}



/* ── Shared column-list constants ─────────────────────────────── */
/*
 * These mirror the field names in the TypeScript interfaces above.
 * Use them in raw SQL queries to avoid `SELECT *`.
 * Example: `SELECT ${LANE_SESSION_COLS} FROM lane_sessions WHERE ...`
 */

export const LANE_SESSION_COLS = [
  'id', 'lane_id', 'status', 'staff_id', 'customer_id',
  'customer_display_name', 'membership_number',
  'desired_rental_type', 'waitlist_desired_type', 'waitlist_desired_types_json',
  'backup_rental_type', 'waitlist_requested_resource_number', 'waitlist_requested_resource_type',
  'assigned_resource_id', 'assigned_resource_type',
  'price_quote_json', 'disclaimers_ack_json',
  'order_id', 'agreement_bypass_pending', 'agreement_signed_method',
  'membership_purchase_intent', 'membership_purchase_requested_at', 'membership_choice',
  'kiosk_acknowledged_at', 'checkin_mode', 'renewal_hours',
  'proposed_rental_type', 'proposed_by',
  'selection_confirmed', 'selection_confirmed_by', 'selection_locked_at',
  'flow_step', 'flow_version', 'flow_last_command_id', 'flow_last_actor',
  'past_due_bypassed', 'past_due_bypassed_by_staff_id', 'past_due_bypassed_at',
  'last_payment_decline_reason', 'last_payment_decline_at',
  'last_past_due_decline_reason', 'last_past_due_decline_at',
  'created_at', 'updated_at',
].join(', ');

export const ORDER_COLS = [
  'id', 'lane_session_id', 'visit_id', 'subtotal', 'discount', 'tax', 'tip',
  'total', 'status', 'quote_json', 'payment_method', 'failure_reason', 'failure_at',
  'register_number', 'paid_by_staff_id', 'square_transaction_id', 'paid_at',
].join(', ');

