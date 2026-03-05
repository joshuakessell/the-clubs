-- Add image_url to products table for storefront display
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Replace the original placeholder catalog with 10 proper spa retail items.
-- Uses ON CONFLICT (sku) DO UPDATE so this is safe to re-run.
INSERT INTO products (sku, name, price, category, sort_order, image_url) VALUES
  ('body-wash',       'Body Wash',         1500, 'RETAIL', 1,  '/images/products/body-wash.png'),
  ('body-lotion',     'Body Lotion',        1200, 'RETAIL', 2,  '/images/products/body-lotion.png'),
  ('charcoal-mask',   'Charcoal Face Mask', 2000, 'RETAIL', 3,  '/images/products/charcoal-mask.png'),
  ('aroma-roll-on',   'Aroma Roll-On',      1200, 'RETAIL', 4,  '/images/products/aroma-roll-on.png'),
  ('body-scrub',      'Exfoliating Scrub',  1800, 'RETAIL', 5,  '/images/products/body-scrub.png'),
  ('shampoo',         'Shampoo',            1400, 'RETAIL', 6,  '/images/products/shampoo.png'),
  ('conditioner',     'Conditioner',        1400, 'RETAIL', 7,  '/images/products/conditioner.png'),
  ('lip-balm',        'Lip Balm',            700, 'RETAIL', 8,  '/images/products/lip-balm.png'),
  ('aloe-gel',        'Aloe Vera Gel',      1000, 'RETAIL', 9,  '/images/products/aloe-gel.png'),
  ('facial-toner',    'Facial Toner',       1600, 'RETAIL', 10, '/images/products/facial-toner.png')
ON CONFLICT (sku) DO UPDATE SET
  name       = EXCLUDED.name,
  price      = EXCLUDED.price,
  category   = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  image_url  = EXCLUDED.image_url,
  is_active  = true,
  updated_at = now();

-- Deactivate the old placeholder items that were seeded in the original migration
UPDATE products SET is_active = false
WHERE sku IN ('swiss-navy-lube','wet-platinum-lube','large-aroma','small-aroma',
              'sundries','chargers','flip-flops','monster','gatorade','water')
  AND sku NOT IN ('body-wash','body-lotion','charcoal-mask','aroma-roll-on','body-scrub',
                  'shampoo','conditioner','lip-balm','aloe-gel','facial-toner');
