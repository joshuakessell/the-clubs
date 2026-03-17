-- Unify billing: migrate payment_intents/charges → orders/order_line_items
--
-- This migration:
--   1. Adds new enum values to order_line_item_kind
--   2. Adds columns to orders that mirror payment_intents (if not already present)
--   3. Adds order_id FK to lane_sessions (replacing payment_intent_id)
--   4. Migrates payment_intents data → orders
--   5. Migrates charges data → order_line_items
--   6. Drops payment_intents and charges tables + payment_status enum
--
-- ⚠  Run in a maintenance window. This migration is NOT reversible without a backup.
-- ⚠  Back up the database before running.

BEGIN;

-- ── 1. Extend the order_line_item_kind enum ──────────────────────────────────

ALTER TYPE order_line_item_kind ADD VALUE IF NOT EXISTS 'CHECKIN_FEE';
ALTER TYPE order_line_item_kind ADD VALUE IF NOT EXISTS 'RENEWAL_FEE';
ALTER TYPE order_line_item_kind ADD VALUE IF NOT EXISTS 'FINAL_EXTENSION';

COMMIT;
BEGIN;

-- ── 2. Add new columns to orders (idempotent) ───────────────────────────────
--    These align the orders table with the columns from payment_intents.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS visit_id          UUID REFERENCES visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lane_session_id   UUID,  -- FK added separately to avoid circular dep
  ADD COLUMN IF NOT EXISTS payment_method    TEXT CHECK (payment_method IS NULL OR payment_method = ANY(ARRAY['CASH','CREDIT'])),
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by_staff_id  UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_json        JSONB,
  ADD COLUMN IF NOT EXISTS failure_reason    TEXT,
  ADD COLUMN IF NOT EXISTS failure_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS register_number   INT,
  ADD COLUMN IF NOT EXISTS square_transaction_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_orders_visit
  ON orders USING btree (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_lane_session
  ON orders USING btree (lane_session_id) WHERE lane_session_id IS NOT NULL;

-- Rename _cents columns to match Drizzle schema (baseline used _cents suffix)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'subtotal_cents'
  ) THEN
    ALTER TABLE orders RENAME COLUMN subtotal_cents TO subtotal;
    ALTER TABLE orders RENAME COLUMN discount_cents TO discount;
    ALTER TABLE orders RENAME COLUMN tax_cents TO tax;
    ALTER TABLE orders RENAME COLUMN tip_cents TO tip;
    ALTER TABLE orders RENAME COLUMN total_cents TO total;
    RAISE NOTICE 'Renamed orders money columns from _cents to plain names';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_line_items' AND column_name = 'unit_price_cents'
  ) THEN
    ALTER TABLE order_line_items RENAME COLUMN unit_price_cents TO unit_price;
    ALTER TABLE order_line_items RENAME COLUMN discount_cents TO discount;
    ALTER TABLE order_line_items RENAME COLUMN tax_cents TO tax;
    ALTER TABLE order_line_items RENAME COLUMN total_cents TO total;
    RAISE NOTICE 'Renamed order_line_items money columns from _cents to plain names';
  END IF;
END $$;

-- Change money columns from integer to numeric(10,2) if they are still integer.
-- This is safe because all values are whole dollars (no fractional cents).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'subtotal' AND data_type = 'integer'
  ) THEN
    ALTER TABLE orders
      ALTER COLUMN subtotal TYPE numeric(10,2) USING subtotal::numeric(10,2),
      ALTER COLUMN discount TYPE numeric(10,2) USING discount::numeric(10,2),
      ALTER COLUMN tax      TYPE numeric(10,2) USING tax::numeric(10,2),
      ALTER COLUMN tip      TYPE numeric(10,2) USING tip::numeric(10,2),
      ALTER COLUMN total    TYPE numeric(10,2) USING total::numeric(10,2);
    RAISE NOTICE 'Converted orders money columns from integer to numeric(10,2)';
  ELSE
    RAISE NOTICE 'Orders money columns already numeric — skipping';
  END IF;
END $$;

-- Same for order_line_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_line_items' AND column_name = 'unit_price' AND data_type = 'integer'
  ) THEN
    ALTER TABLE order_line_items
      ALTER COLUMN unit_price TYPE numeric(10,2) USING unit_price::numeric(10,2),
      ALTER COLUMN discount   TYPE numeric(10,2) USING discount::numeric(10,2),
      ALTER COLUMN tax        TYPE numeric(10,2) USING tax::numeric(10,2),
      ALTER COLUMN total      TYPE numeric(10,2) USING total::numeric(10,2);
    RAISE NOTICE 'Converted order_line_items money columns from integer to numeric(10,2)';
  ELSE
    RAISE NOTICE 'order_line_items money columns already numeric — skipping';
  END IF;
END $$;

-- ── 3. Add order_id to lane_sessions (replacing payment_intent_id) ──────────

ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lane_sessions_order
  ON lane_sessions USING btree (order_id) WHERE order_id IS NOT NULL;

-- ── 4. Migrate payment_intents → orders ─────────────────────────────────────
--    Map: DUE→OPEN, PAID→PAID, CANCELLED→CANCELED, REFUNDED→REFUNDED.

INSERT INTO orders (
  id, customer_id, visit_id, lane_session_id,
  status,
  subtotal, discount, tax, tip, total,
  currency,
  payment_method, square_transaction_id,
  paid_at, paid_by_staff_id,
  quote_json,
  failure_reason, failure_at, register_number,
  created_at, updated_at
)
SELECT
  pi.id,
  NULL,  -- customer_id (payment_intents didn't track this)
  NULL,  -- visit_id (will be set from charges if available)
  pi.lane_session_id,
  CASE pi.status::text
    WHEN 'DUE'       THEN 'OPEN'::order_status
    WHEN 'PAID'      THEN 'PAID'::order_status
    WHEN 'CANCELLED' THEN 'CANCELED'::order_status
    WHEN 'REFUNDED'  THEN 'REFUNDED'::order_status
    ELSE 'OPEN'::order_status
  END,
  pi.amount,      -- subtotal = amount
  0,              -- discount
  0,              -- tax
  COALESCE(pi.tip, 0),
  pi.amount + COALESCE(pi.tip, 0),  -- total = amount + tip
  'USD',
  pi.payment_method,
  pi.square_transaction_id,
  pi.paid_at,
  pi.paid_by_staff_id,
  pi.quote_json,
  pi.failure_reason,
  pi.failure_at,
  pi.register_number,
  pi.created_at,
  pi.updated_at
FROM payment_intents pi
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = pi.id)
ON CONFLICT (id) DO NOTHING;

-- Back-fill visit_id on migrated orders from charges
UPDATE orders o
SET visit_id = c.visit_id
FROM charges c
WHERE c.payment_intent_id = o.id
  AND o.visit_id IS NULL;

-- Back-fill customer_id from visits
UPDATE orders o
SET customer_id = v.customer_id
FROM visits v
WHERE o.visit_id = v.id
  AND o.customer_id IS NULL;

-- ── 5. Populate lane_sessions.order_id from payment_intent_id ───────────────

UPDATE lane_sessions ls
SET order_id = ls.payment_intent_id
WHERE ls.payment_intent_id IS NOT NULL
  AND ls.order_id IS NULL;

-- ── 6. Migrate charges → order_line_items ───────────────────────────────────

INSERT INTO order_line_items (
  id, order_id, kind, name, quantity, unit_price, discount, tax, total
)
SELECT
  c.id,
  c.payment_intent_id,
  CASE c.type
    WHEN 'UPGRADE_FEE'    THEN 'UPGRADE'::order_line_item_kind
    WHEN 'LATE_FEE'       THEN 'LATE_FEE'::order_line_item_kind
    WHEN 'CHECKIN_FEE'    THEN 'CHECKIN_FEE'::order_line_item_kind
    WHEN 'RENEWAL_FEE'    THEN 'RENEWAL_FEE'::order_line_item_kind
    WHEN 'FINAL_EXTENSION' THEN 'FINAL_EXTENSION'::order_line_item_kind
    ELSE 'MANUAL'::order_line_item_kind
  END,
  -- Readable name from type
  CASE c.type
    WHEN 'UPGRADE_FEE'     THEN 'Upgrade Fee'
    WHEN 'LATE_FEE'        THEN 'Late Fee'
    WHEN 'CHECKIN_FEE'     THEN 'Check-in Fee'
    WHEN 'RENEWAL_FEE'     THEN 'Renewal Fee'
    WHEN 'FINAL_EXTENSION' THEN 'Final Extension'
    ELSE REPLACE(c.type, '_', ' ')
  END,
  1,          -- quantity
  c.amount,   -- unit_price
  0,          -- discount
  0,          -- tax
  c.amount    -- total
FROM charges c
WHERE c.payment_intent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_line_items oli WHERE oli.id = c.id)
ON CONFLICT (id) DO NOTHING;

-- Charges without a payment_intent_id get an order created for them
-- (defensive: handle orphaned charges)
DO $$
DECLARE
  r RECORD;
  new_order_id UUID;
BEGIN
  FOR r IN
    SELECT c.id, c.visit_id, c.checkin_block_id, c.type, c.amount, c.created_at
    FROM charges c
    WHERE c.payment_intent_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM order_line_items oli WHERE oli.id = c.id)
  LOOP
    INSERT INTO orders (
      visit_id, status, subtotal, discount, tax, tip, total, currency, created_at, updated_at
    ) VALUES (
      r.visit_id, 'PAID', r.amount, 0, 0, 0, r.amount, 'USD', r.created_at, r.created_at
    ) RETURNING id INTO new_order_id;

    INSERT INTO order_line_items (
      id, order_id, kind, name, quantity, unit_price, discount, tax, total
    ) VALUES (
      r.id, new_order_id,
      CASE r.type
        WHEN 'UPGRADE_FEE'     THEN 'UPGRADE'::order_line_item_kind
        WHEN 'LATE_FEE'        THEN 'LATE_FEE'::order_line_item_kind
        WHEN 'CHECKIN_FEE'     THEN 'CHECKIN_FEE'::order_line_item_kind
        WHEN 'RENEWAL_FEE'     THEN 'RENEWAL_FEE'::order_line_item_kind
        WHEN 'FINAL_EXTENSION' THEN 'FINAL_EXTENSION'::order_line_item_kind
        ELSE 'MANUAL'::order_line_item_kind
      END,
      CASE r.type
        WHEN 'UPGRADE_FEE'     THEN 'Upgrade Fee'
        WHEN 'LATE_FEE'        THEN 'Late Fee'
        ELSE REPLACE(r.type, '_', ' ')
      END,
      1, r.amount, 0, 0, r.amount
    );
  END LOOP;
END $$;

-- ── 7. Drop old tables ──────────────────────────────────────────────────────

-- Remove FKs first
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_payment_intent_id_fkey;
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_checkin_block_id_fkey;
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_visit_id_fkey;
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_lane_session_id_fkey;
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_paid_by_staff_id_fkey;
ALTER TABLE lane_sessions DROP CONSTRAINT IF EXISTS fk_lane_sessions_payment_intent;
ALTER TABLE lane_sessions DROP CONSTRAINT IF EXISTS lane_sessions_payment_intent_id_fkey;

-- Drop the tables
DROP TABLE IF EXISTS charges;
DROP TABLE IF EXISTS payment_intents;

-- ── 8. Drop payment_intent_id from lane_sessions ────────────────────────────

ALTER TABLE lane_sessions
  DROP COLUMN IF EXISTS payment_intent_id;

-- ── 9. Clean up the payment_status enum (no longer used) ────────────────────

DROP TYPE IF EXISTS payment_status;

COMMIT;
