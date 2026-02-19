import type { transaction } from '../db';

export type PoolClient = Parameters<Parameters<typeof transaction>[0]>[0];

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
  payment_intent_id: string | null;
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

export interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  assigned_to_customer_id: string | null;
}

export interface LockerRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

export interface PaymentIntentRow {
  id: string;
  lane_session_id: string;
  amount: number | string;
  tip_cents?: number | null;
  status: string;
  quote_json: unknown;
  payment_method?: string;
  failure_reason?: string;
  failure_at?: Date | null;
  register_number?: number | null;
  paid_by_staff_id?: string | null;
}
