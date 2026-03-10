-- up migration
-- =============================================================================
-- Unify rooms + lockers into a single inventory_resources table.
--
-- Reuses the existing inventory_resource_type enum ('room', 'locker').
-- Preserves UUIDs so all historical references remain valid.
-- =============================================================================

-- 1. Create the unified table
CREATE TABLE IF NOT EXISTS inventory_resources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            inventory_resource_type NOT NULL,
  number          VARCHAR(20) NOT NULL,
  tier            room_type NOT NULL DEFAULT 'STANDARD',
  status          room_status NOT NULL DEFAULT 'CLEAN',
  floor           INTEGER,
  last_status_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  override_flag   BOOLEAN NOT NULL DEFAULT false,
  version         INTEGER NOT NULL DEFAULT 1,
  assigned_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_resources_number_key UNIQUE (number)
);

-- 2. Migrate rooms data (preserving original UUIDs)
INSERT INTO inventory_resources (id, kind, number, tier, status, floor, last_status_change, override_flag, version, assigned_to_customer_id, created_at, updated_at)
SELECT id, 'room'::inventory_resource_type, number, type, status, floor, last_status_change, override_flag, version, assigned_to_customer_id, created_at, updated_at
FROM rooms
ON CONFLICT (id) DO NOTHING;

-- 3. Migrate lockers data (preserving original UUIDs)
INSERT INTO inventory_resources (id, kind, number, tier, status, floor, last_status_change, override_flag, version, assigned_to_customer_id, created_at, updated_at)
SELECT id, 'locker'::inventory_resource_type, number, 'LOCKER'::room_type, status, NULL, NOW(), false, 1, assigned_to_customer_id, created_at, updated_at
FROM lockers
ON CONFLICT (id) DO NOTHING;

-- 4. checkin_blocks: add resource_id, backfill, drop old dual FKs
ALTER TABLE checkin_blocks ADD COLUMN IF NOT EXISTS resource_id UUID;
UPDATE checkin_blocks SET resource_id = COALESCE(room_id, locker_id) WHERE resource_id IS NULL;

-- Drop old FK constraints first
ALTER TABLE checkin_blocks DROP CONSTRAINT IF EXISTS checkin_blocks_room_id_fkey;
ALTER TABLE checkin_blocks DROP CONSTRAINT IF EXISTS checkin_blocks_locker_id_fkey;
ALTER TABLE checkin_blocks DROP COLUMN IF EXISTS room_id;
ALTER TABLE checkin_blocks DROP COLUMN IF EXISTS locker_id;

-- Add FK to inventory_resources
ALTER TABLE checkin_blocks
  ADD CONSTRAINT checkin_blocks_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES inventory_resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checkin_blocks_resource ON checkin_blocks(resource_id) WHERE resource_id IS NOT NULL;

-- 5. key_tags: replace dual FKs + CHECK with single resource_id
ALTER TABLE key_tags ADD COLUMN IF NOT EXISTS resource_id UUID;
UPDATE key_tags SET resource_id = COALESCE(room_id, locker_id) WHERE resource_id IS NULL;

ALTER TABLE key_tags DROP CONSTRAINT IF EXISTS key_tags_exactly_one_target_chk;
ALTER TABLE key_tags DROP CONSTRAINT IF EXISTS key_tags_room_id_fkey;
ALTER TABLE key_tags DROP CONSTRAINT IF EXISTS key_tags_locker_id_fkey;
ALTER TABLE key_tags DROP COLUMN IF EXISTS room_id;
ALTER TABLE key_tags DROP COLUMN IF EXISTS locker_id;

ALTER TABLE key_tags
  ADD CONSTRAINT key_tags_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES inventory_resources(id) ON DELETE CASCADE;

ALTER TABLE key_tags ADD CONSTRAINT key_tags_resource_id_nn CHECK (resource_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_key_tags_resource ON key_tags(resource_id);

-- 6. waitlist: replace room_id + locker_or_room_assigned_initially with resource_id
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS resource_id UUID;
UPDATE waitlist SET resource_id = COALESCE(room_id, locker_or_room_assigned_initially) WHERE resource_id IS NULL;

ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_room_id_fkey;
ALTER TABLE waitlist DROP COLUMN IF EXISTS room_id;
ALTER TABLE waitlist DROP COLUMN IF EXISTS locker_or_room_assigned_initially;

ALTER TABLE waitlist
  ADD CONSTRAINT waitlist_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES inventory_resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_resource ON waitlist(resource_id) WHERE resource_id IS NOT NULL;

-- 7. cleaning_batch_rooms: rename room_id → resource_id
ALTER TABLE cleaning_batch_rooms DROP CONSTRAINT IF EXISTS cleaning_batch_rooms_room_id_fkey;
ALTER TABLE cleaning_batch_rooms DROP CONSTRAINT IF EXISTS cleaning_batch_rooms_batch_id_room_id_key;
ALTER TABLE cleaning_batch_rooms RENAME COLUMN room_id TO resource_id;

ALTER TABLE cleaning_batch_rooms
  ADD CONSTRAINT cleaning_batch_rooms_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES inventory_resources(id) ON DELETE CASCADE;
ALTER TABLE cleaning_batch_rooms
  ADD CONSTRAINT cleaning_batch_rooms_batch_id_resource_id_key
  UNIQUE (batch_id, resource_id);

-- Rename index
DROP INDEX IF EXISTS idx_cleaning_batch_rooms_room;
CREATE INDEX IF NOT EXISTS idx_cleaning_batch_rooms_resource ON cleaning_batch_rooms(resource_id);

-- 8. cleaning_events: rename room_id → resource_id
ALTER TABLE cleaning_events DROP CONSTRAINT IF EXISTS cleaning_events_room_id_fkey;
ALTER TABLE cleaning_events RENAME COLUMN room_id TO resource_id;

ALTER TABLE cleaning_events
  ADD CONSTRAINT cleaning_events_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES inventory_resources(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_cleaning_events_room;
CREATE INDEX IF NOT EXISTS idx_cleaning_events_resource ON cleaning_events(resource_id);

-- 9. Indexes on inventory_resources
CREATE INDEX IF NOT EXISTS idx_ir_kind ON inventory_resources(kind);
CREATE INDEX IF NOT EXISTS idx_ir_status ON inventory_resources(status);
CREATE INDEX IF NOT EXISTS idx_ir_tier ON inventory_resources(tier);
CREATE INDEX IF NOT EXISTS idx_ir_assigned ON inventory_resources(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ir_floor ON inventory_resources(floor) WHERE floor IS NOT NULL;

-- 10. Drop old tables (CASCADE drops remaining dependent objects)
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS lockers CASCADE;


-- down migration
-- (Manual rollback — would require re-creating rooms/lockers tables and migrating data back)
-- This migration is not easily reversible. Take a database backup before applying.
