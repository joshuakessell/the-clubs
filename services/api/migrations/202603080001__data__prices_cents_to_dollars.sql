-- Convert product prices from cents to whole dollars.
-- The products.price column stored values in cents (e.g. 1500 for $15).
-- Going forward, prices are stored as whole dollar integers (e.g. 15 for $15).

UPDATE products
SET price = price / 100,
    updated_at = NOW()
WHERE price >= 100;

-- Also fix any order_line_items that were stored with cent values.
-- Retail line items inserted via the simulator already use whole dollars,
-- but any orders created through the old API may have cent values.
UPDATE order_line_items
SET unit_price = unit_price / 100,
    total      = total / 100
WHERE unit_price >= 100
  AND kind = 'RETAIL';

-- Fix corresponding order totals
UPDATE orders
SET subtotal = (SELECT COALESCE(SUM(total), 0) FROM order_line_items WHERE order_id = orders.id),
    total    = (SELECT COALESCE(SUM(total), 0) FROM order_line_items WHERE order_id = orders.id) + orders.tip
WHERE id IN (
  SELECT DISTINCT order_id FROM order_line_items WHERE kind = 'RETAIL'
);
