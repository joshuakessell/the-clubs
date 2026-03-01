-- Rename all _cents columns to drop the _cents suffix.
-- All monetary values in the system are whole dollars (tax-inclusive pricing, no change).

-- payment_intents
ALTER TABLE payment_intents RENAME COLUMN tip_cents TO tip;

-- orders
ALTER TABLE orders RENAME COLUMN subtotal_cents TO subtotal;
ALTER TABLE orders RENAME COLUMN discount_cents TO discount;
ALTER TABLE orders RENAME COLUMN tax_cents TO tax;
ALTER TABLE orders RENAME COLUMN tip_cents TO tip;
ALTER TABLE orders RENAME COLUMN total_cents TO total;

-- order_line_items
ALTER TABLE order_line_items RENAME COLUMN unit_price_cents TO unit_price;
ALTER TABLE order_line_items RENAME COLUMN discount_cents TO discount;
ALTER TABLE order_line_items RENAME COLUMN tax_cents TO tax;
ALTER TABLE order_line_items RENAME COLUMN total_cents TO total;

-- cash_drawer_sessions
ALTER TABLE cash_drawer_sessions RENAME COLUMN opening_float_cents TO opening_float;
ALTER TABLE cash_drawer_sessions RENAME COLUMN counted_cash_cents TO counted_cash;
ALTER TABLE cash_drawer_sessions RENAME COLUMN expected_cash_cents TO expected_cash;
ALTER TABLE cash_drawer_sessions RENAME COLUMN over_short_cents TO over_short;

-- cash_drawer_events
ALTER TABLE cash_drawer_events RENAME COLUMN amount_cents TO amount;

-- club_events
ALTER TABLE club_events RENAME COLUMN amount_cents TO amount;

-- Update the index on club_events.amount (was amount_cents)
DROP INDEX IF EXISTS idx_club_events_amount;
CREATE INDEX idx_club_events_amount ON club_events USING btree (amount, occurred_at) WHERE (amount IS NOT NULL);

-- products
ALTER TABLE products RENAME COLUMN price_cents TO price;

-- customer_spend_ledger_entries
ALTER TABLE customer_spend_ledger_entries RENAME COLUMN amount_cents TO amount;

-- late_checkout_ban_alerts
ALTER TABLE late_checkout_ban_alerts RENAME COLUMN fee_amount_cents TO fee_amount;
