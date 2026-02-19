-- Part 2 of migration 030: Update data to use new enum values
-- This runs in a separate transaction after the enum values are committed
-- Note: rental_type enum never had DELUXE/VIP, so we only update room_type columns

-- Update existing rooms: DELUXE -> DOUBLE, VIP -> SPECIAL
UPDATE rooms SET type = 'DOUBLE' WHERE type = 'DELUXE';
UPDATE rooms SET type = 'SPECIAL' WHERE type = 'VIP';

-- Note: Old enum values (DELUXE, VIP) remain in the enum type but should not be used.
-- They can be removed in a future migration if desired, but that requires recreating the enum type.

