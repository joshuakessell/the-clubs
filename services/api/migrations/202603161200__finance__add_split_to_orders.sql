-- up migration
-- Allow 'SPLIT' as a valid payment_method alongside CASH and CREDIT
-- Due to dynamic naming conventions when ADD COLUMN is used with CHECK, we find and drop any old check constraint first.
DO $$
DECLARE constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass AND contype = 'c' 
      AND pg_get_constraintdef(oid) LIKE '%payment_method%';
      
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || constraint_name;
    END IF;
END $$;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text, 'SPLIT'::text]));

-- down migration
DO $$
DECLARE constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass AND contype = 'c' 
      AND (conname = 'orders_payment_method_check' OR pg_get_constraintdef(oid) LIKE '%payment_method%');
      
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || constraint_name;
    END IF;
END $$;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text]));
