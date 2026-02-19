export interface KeyTagRow {
  id: string;
  room_id: string | null;
  locker_id: string | null;
  tag_code: string;
  is_active: boolean;
}

export interface CheckinBlockRow {
  id: string;
  visit_id: string;
  block_type: string;
  starts_at: Date;
  ends_at: Date;
  rental_type: string;
  room_id: string | null;
  locker_id: string | null;
  session_id: string | null;
  has_tv_remote: boolean;
}

export interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  banned_until: Date | null;
}

export interface RoomRow {
  id: string;
  number: string;
  type: string;
}

export interface LockerRow {
  id: string;
  number: string;
}

export interface CheckoutRequestRow {
  id: string;
  occupancy_id: string;
  customer_id: string;
  key_tag_id: string | null;
  kiosk_device_id: string;
  created_at: Date;
  claimed_by_staff_id: string | null;
  claimed_at: Date | null;
  claim_expires_at: Date | null;
  customer_checklist_json: unknown;
  status: string;
  late_minutes: number;
  late_fee_amount: number;
  ban_applied: boolean;
  items_confirmed: boolean;
  fee_paid: boolean;
  completed_at: Date | null;
}

export interface WaitlistStatusRow {
  id: string;
  status: 'ACTIVE' | 'OFFERED';
}

export type ManualCheckoutResourceType = 'ROOM' | 'LOCKER';

export interface ManualCheckoutCandidateRow {
  occupancy_id: string;
  resource_type: ManualCheckoutResourceType;
  number: string;
  customer_name: string;
  checkin_at: Date;
  scheduled_checkout_at: Date;
  is_overdue: boolean;
}

export interface ManualResolveRow {
  occupancy_id: string;
  visit_id: string;
  customer_id: string;
  customer_name: string;
  checkin_at: Date;
  scheduled_checkout_at: Date;
  room_id: string | null;
  room_number: string | null;
  locker_id: string | null;
  locker_number: string | null;
  session_id: string | null;
}

export type VisitDateRow = { started_at: Date };
