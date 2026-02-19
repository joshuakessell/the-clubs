-- Add kiosk acknowledgement timestamp to lane_sessions
-- Used to allow the kiosk UI to return to idle without clearing/ending the lane session.

ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS kiosk_acknowledged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lane_sessions_kiosk_acknowledged_at
  ON lane_sessions(kiosk_acknowledged_at)
  WHERE kiosk_acknowledged_at IS NOT NULL;


