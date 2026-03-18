-- up migration

CREATE TABLE IF NOT EXISTS club_calendar_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(200)  NOT NULL,
  description   TEXT,
  event_date    DATE          NOT NULL,
  start_time    TIME,
  end_time      TIME,
  event_type    VARCHAR(50)   NOT NULL DEFAULT 'GENERAL',
  highlight     BOOLEAN       NOT NULL DEFAULT false,
  created_by    UUID          REFERENCES staff(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON club_calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_type ON club_calendar_events(event_type);

-- down migration

DROP TABLE IF EXISTS club_calendar_events;
