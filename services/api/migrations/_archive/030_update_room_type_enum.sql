-- Migration to update room_type enum from DELUXE/VIP to DOUBLE/SPECIAL
-- Note: PostgreSQL does not support renaming enum values directly.
-- This migration:
-- 1. Adds new enum values (DOUBLE, SPECIAL) - must be committed separately
-- 2. Updates existing data to use new values
-- 3. Leaves old enum values in place (they will be unused)

-- Add new enum values (these will be committed in this transaction)
ALTER TYPE room_type ADD VALUE IF NOT EXISTS 'DOUBLE';
ALTER TYPE room_type ADD VALUE IF NOT EXISTS 'SPECIAL';

-- Note: The enum values must be committed before they can be used in UPDATE statements.
-- The migration runner will commit this transaction, then the next migration (030a) will do the updates.

