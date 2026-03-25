import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { customers, staff } from './identity';
import { waitlist, laneSessions } from './visits';

export const inventoryResources = pgTable("inventory_resources", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kind: enums.inventoryResourceType().notNull(),
	number: varchar({ length: 20 }).notNull(),
	tier: enums.roomType().default('STANDARD').notNull(),
	status: enums.roomStatus().default('CLEAN').notNull(),
	floor: integer(),
	lastStatusChange: timestamp("last_status_change", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	overrideFlag: boolean("override_flag").default(false).notNull(),
	version: integer().default(1).notNull(),
	assignedToCustomerId: uuid("assigned_to_customer_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ir_kind").using("btree", table.kind.asc().nullsLast().op("enum_ops")),
	index("idx_ir_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_ir_tier").using("btree", table.tier.asc().nullsLast().op("enum_ops")),
	index("idx_ir_assigned").using("btree", table.assignedToCustomerId.asc().nullsLast().op("uuid_ops")).where(sql`(assigned_to_customer_id IS NOT NULL)`),
	index("idx_ir_floor").using("btree", table.floor.asc().nullsLast().op("int4_ops")).where(sql`(floor IS NOT NULL)`),
	foreignKey({
			columns: [table.assignedToCustomerId],
			foreignColumns: [customers.id],
			name: "inventory_resources_assigned_to_customer_id_fkey"
		}).onDelete("set null"),
	unique("inventory_resources_number_key").on(table.number),
]);

export const keyTags = pgTable("key_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	resourceId: uuid("resource_id").notNull(),
	tagType: enums.keyTagType("tag_type").notNull(),
	tagCode: varchar("tag_code", { length: 255 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_key_tags_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")).where(sql`(is_active = true)`),
	index("idx_key_tags_code").using("btree", table.tagCode.asc().nullsLast().op("text_ops")),
	index("idx_key_tags_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "key_tags_resource_id_fkey"
		}).onDelete("cascade"),
	unique("key_tags_tag_code_key").on(table.tagCode),
	check("key_tags_resource_id_nn", sql`resource_id IS NOT NULL`),
]);

export const inventoryReservations = pgTable("inventory_reservations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	resourceType: enums.inventoryResourceType("resource_type").notNull(),
	resourceId: uuid("resource_id").notNull(),
	kind: enums.inventoryReservationKind().notNull(),
	laneSessionId: uuid("lane_session_id"),
	waitlistId: uuid("waitlist_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }),
	releasedAt: timestamp("released_at", { withTimezone: true, mode: 'date' }),
	releaseReason: text("release_reason"),
}, (table) => [
	index("idx_inventory_reservations_active_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(released_at IS NULL)`),
	index("idx_inventory_reservations_waitlist_active").using("btree", table.waitlistId.asc().nullsLast().op("uuid_ops")).where(sql`(released_at IS NULL)`),
	uniqueIndex("uniq_inventory_reservations_active_resource").using("btree", table.resourceType.asc().nullsLast().op("uuid_ops"), table.resourceId.asc().nullsLast().op("enum_ops")).where(sql`(released_at IS NULL)`),
	foreignKey({
			columns: [table.laneSessionId],
			foreignColumns: [laneSessions.id],
			name: "inventory_reservations_lane_session_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.waitlistId],
			foreignColumns: [waitlist.id],
			name: "inventory_reservations_waitlist_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "inventory_reservations_resource_id_fkey"
		}).onDelete("cascade"),
	index("idx_inventory_reservations_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")),
	check("inventory_reservations_lane_session_required", sql`(kind <> 'LANE_SELECTION'::inventory_reservation_kind) OR (lane_session_id IS NOT NULL)`),
	check("inventory_reservations_waitlist_required", sql`(kind <> 'UPGRADE_HOLD'::inventory_reservation_kind) OR (waitlist_id IS NOT NULL)`),
]);

// charges and paymentIntents tables removed — unified into orders/orderLineItems

export const cleaningBatches = pgTable("cleaning_batches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffId: varchar("staff_id", { length: 255 }).notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	roomCount: integer("room_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_cleaning_batches_incomplete").using("btree", table.completedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(completed_at IS NULL)`),
	index("idx_cleaning_batches_staff").using("btree", table.staffId.asc().nullsLast().op("text_ops")),
	index("idx_cleaning_batches_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const cleaningBatchRooms = pgTable("cleaning_batch_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	batchId: uuid("batch_id").notNull(),
	resourceId: uuid("resource_id").notNull(),
	statusFrom: enums.roomStatus("status_from").notNull(),
	statusTo: enums.roomStatus("status_to").notNull(),
	transitionTime: timestamp("transition_time", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	overrideFlag: boolean("override_flag").default(false).notNull(),
	overrideReason: text("override_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_cleaning_batch_rooms_batch").using("btree", table.batchId.asc().nullsLast().op("uuid_ops")),
	index("idx_cleaning_batch_rooms_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")),
	index("idx_cleaning_batch_rooms_transition").using("btree", table.transitionTime.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.batchId],
			foreignColumns: [cleaningBatches.id],
			name: "cleaning_batch_rooms_batch_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "cleaning_batch_rooms_resource_id_fkey"
		}).onDelete("cascade"),
	unique("cleaning_batch_rooms_batch_id_resource_id_key").on(table.batchId, table.resourceId),
]);

export const cleaningEvents = pgTable("cleaning_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	resourceId: uuid("resource_id").notNull(),
	staffId: uuid("staff_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	fromStatus: enums.roomStatus("from_status").notNull(),
	toStatus: enums.roomStatus("to_status").notNull(),
	overrideFlag: boolean("override_flag").default(false).notNull(),
	overrideReason: text("override_reason"),
	deviceId: varchar("device_id", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_cleaning_events_completed").using("btree", table.completedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_cleaning_events_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where(sql`(device_id IS NOT NULL)`),
	index("idx_cleaning_events_override").using("btree", table.overrideFlag.asc().nullsLast().op("bool_ops")).where(sql`(override_flag = true)`),
	index("idx_cleaning_events_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")),
	index("idx_cleaning_events_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
	index("idx_cleaning_events_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "cleaning_events_resource_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "cleaning_events_staff_id_fkey"
		}).onDelete("restrict"),
]);
