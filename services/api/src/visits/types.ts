export interface VisitRow {
  id: string;
  customer_id: string;
  started_at: Date;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
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
  agreement_signed: boolean;
  created_at: Date;
  updated_at: Date;
}
