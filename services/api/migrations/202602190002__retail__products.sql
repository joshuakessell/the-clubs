-- Products table for the retail store
-- Replaces the hard-coded RETAIL_CATALOG in the employee-kiosk
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT UNIQUE,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'RETAIL',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category_active ON products (category, is_active);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku) WHERE sku IS NOT NULL;

-- Seed with current hard-coded catalog items
INSERT INTO products (sku, name, price_cents, category, sort_order) VALUES
  ('swiss-navy-lube',    'Swiss Navy',   1000, 'RETAIL', 1),
  ('wet-platinum-lube',  'Wet Platinum', 1000, 'RETAIL', 2),
  ('large-aroma',        'Large Aroma',  1000, 'RETAIL', 3),
  ('small-aroma',        'Small Aroma',  1000, 'RETAIL', 4),
  ('sundries',           'Sundries',     1000, 'RETAIL', 5),
  ('chargers',           'Chargers',     1000, 'RETAIL', 6),
  ('flip-flops',         'Flip Flops',   1000, 'RETAIL', 7),
  ('monster',            'Monster',      1000, 'RETAIL', 8),
  ('gatorade',           'Gatorade',     1000, 'RETAIL', 9),
  ('water',              'Water',        1000, 'RETAIL', 10)
ON CONFLICT (sku) DO NOTHING;
