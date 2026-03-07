-- up migration
-- Allow 'SPLIT' as a valid payment_method alongside CASH and CREDIT
ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_payment_method_check;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_payment_method_check
  CHECK (payment_method IN ('CASH', 'CREDIT', 'SPLIT'));

-- down migration
ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_payment_method_check;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_payment_method_check
  CHECK (payment_method IN ('CASH', 'CREDIT'));
