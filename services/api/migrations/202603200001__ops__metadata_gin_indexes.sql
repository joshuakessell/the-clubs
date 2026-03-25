-- up migration
CREATE INDEX IF NOT EXISTS idx_orders_metadata ON orders USING GIN (metadata_json);
CREATE INDEX IF NOT EXISTS idx_order_line_items_metadata ON order_line_items USING GIN (metadata_json);
CREATE INDEX IF NOT EXISTS idx_customer_activity_events_metadata ON customer_activity_events USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_customer_spend_ledger_metadata ON customer_spend_ledger_entries USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_club_events_metadata ON club_events USING GIN (metadata);

-- down migration
DROP INDEX IF EXISTS idx_orders_metadata;
DROP INDEX IF EXISTS idx_order_line_items_metadata;
DROP INDEX IF EXISTS idx_customer_activity_events_metadata;
DROP INDEX IF EXISTS idx_customer_spend_ledger_metadata;
DROP INDEX IF EXISTS idx_club_events_metadata;
