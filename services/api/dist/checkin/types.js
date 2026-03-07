"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_INTENT_COLS = exports.LANE_SESSION_COLS = void 0;
/* ── Shared column-list constants ─────────────────────────────── */
/*
 * These mirror the field names in the TypeScript interfaces above.
 * Use them in raw SQL queries to avoid `SELECT *`.
 * Example: `SELECT ${LANE_SESSION_COLS} FROM lane_sessions WHERE ...`
 */
exports.LANE_SESSION_COLS = [
    'id', 'lane_id', 'status', 'staff_id', 'customer_id',
    'customer_display_name', 'membership_number',
    'desired_rental_type', 'waitlist_desired_type', 'waitlist_desired_types_json',
    'backup_rental_type', 'waitlist_requested_resource_number', 'waitlist_requested_resource_type',
    'assigned_resource_id', 'assigned_resource_type',
    'price_quote_json', 'disclaimers_ack_json',
    'payment_intent_id', 'agreement_bypass_pending', 'agreement_signed_method',
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
exports.PAYMENT_INTENT_COLS = [
    'id', 'lane_session_id', 'amount', 'tip', 'status',
    'quote_json', 'payment_method', 'failure_reason', 'failure_at',
    'register_number', 'paid_by_staff_id',
].join(', ');
