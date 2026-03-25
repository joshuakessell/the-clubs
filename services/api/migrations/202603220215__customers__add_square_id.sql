-- Up
ALTER TABLE customers ADD COLUMN square_customer_id VARCHAR(255) UNIQUE;
CREATE INDEX idx_customers_square_id ON customers (square_customer_id);

-- Down
DROP INDEX IF EXISTS idx_customers_square_id;
ALTER TABLE customers DROP COLUMN square_customer_id;
