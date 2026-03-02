-- Add OUT_OF_SERVICE to room_status enum for admin room management.
-- Rooms/lockers set to OUT_OF_SERVICE are excluded from availability and assignment.
ALTER TYPE public.room_status ADD VALUE IF NOT EXISTS 'OUT_OF_SERVICE';
