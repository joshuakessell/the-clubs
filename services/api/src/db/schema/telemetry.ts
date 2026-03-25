import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { staff, customers } from './identity';
import { visits } from './visits';
import { orders, registerSessions } from './commerce';

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id", { length: 255 }),
	userRole: varchar("user_role", { length: 50 }),
	action: enums.auditAction().notNull(),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	entityId: uuid("entity_id").notNull(),
	oldValue: jsonb("old_value").$type<Record<string, unknown>>(),
	newValue: jsonb("new_value").$type<Record<string, unknown>>(),
	overrideReason: text("override_reason"),
	ipAddress: inet("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	staffId: uuid("staff_id"),
	metadata: jsonb().$type<Record<string, unknown>>(),
}, (table) => [
	index("idx_audit_log_action").using("btree", table.action.asc().nullsLast().op("enum_ops")),
	index("idx_audit_log_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_audit_log_entity").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("text_ops")),
	index("idx_audit_log_overrides").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(action = 'OVERRIDE'::audit_action)`),
	index("idx_audit_log_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
	index("idx_audit_log_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "audit_log_staff_id_fkey"
		}).onDelete("set null"),
]);

export const customerNotes = pgTable("customer_notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdByStaffId: uuid("created_by_staff_id"),
	createdByStaffName: text("created_by_staff_name").notNull(),
	sourceApp: text("source_app").notNull(),
	note: text().notNull(),
	isImportant: boolean("is_important").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("idx_customer_notes_customer_created").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	index("idx_customer_notes_customer_important").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")).where(sql`(is_important = true)`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "customer_notes_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdByStaffId],
			foreignColumns: [staff.id],
			name: "customer_notes_created_by_staff_id_fkey"
		}).onDelete("set null"),
]);

export const customerActivityEvents = pgTable("customer_activity_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerId: uuid("customer_id").notNull(),
	actionType: text("action_type").notNull(),
	actionCategory: text("action_category").notNull(),
	sourceApp: text("source_app").notNull(),
	actorType: text("actor_type").notNull(),
	actorStaffId: uuid("actor_staff_id"),
	actorStaffName: text("actor_staff_name"),
	summary: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	searchBlob: text("search_blob").notNull(),
	dedupeKey: text("dedupe_key"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_customer_activity_events_action_category").using("btree", table.actionCategory.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("idx_customer_activity_events_metadata").using("gin", table.metadata),
	index("idx_customer_activity_events_action_type").using("btree", table.actionType.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("idx_customer_activity_events_customer_occurred").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("idx_customer_activity_events_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where(sql`(dedupe_key IS NOT NULL)`),
	index("idx_customer_activity_events_occurred").using("btree", table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	index("idx_customer_activity_events_search_trgm").using("gin", table.searchBlob.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "customer_activity_events_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorStaffId],
			foreignColumns: [staff.id],
			name: "customer_activity_events_actor_staff_id_fkey"
		}).onDelete("set null"),
]);

export const customerSpendLedgerEntries = pgTable("customer_spend_ledger_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerId: uuid("customer_id").notNull(),
	visitId: uuid("visit_id"),
	entryType: text("entry_type").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint("amount", { mode: "number" }).notNull(),
	currency: text().default('USD').notNull(),
	sourceApp: text("source_app").notNull(),
	actorType: text("actor_type").notNull(),
	actorStaffId: uuid("actor_staff_id"),
	actorStaffName: text("actor_staff_name"),
	summary: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	dedupeKey: text("dedupe_key"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_customer_spend_ledger_customer_occurred").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	index("idx_customer_spend_ledger_metadata").using("gin", table.metadata),
	index("idx_customer_spend_ledger_customer_visit_occurred").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.visitId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("idx_customer_spend_ledger_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where(sql`(dedupe_key IS NOT NULL)`),
	index("idx_customer_spend_ledger_entry_type").using("btree", table.entryType.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("idx_customer_spend_ledger_visit_occurred").using("btree", table.visitId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "customer_spend_ledger_entries_customer_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "customer_spend_ledger_entries_visit_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.actorStaffId],
			foreignColumns: [staff.id],
			name: "customer_spend_ledger_entries_actor_staff_id_fkey"
		}).onDelete("set null"),
]);

export const clubEvents = pgTable("club_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	eventType: text("event_type").notNull(),
	eventDomain: text("event_domain").notNull(),
	sourceApp: text("source_app").notNull(),
	registerId: text("register_id"),
	staffId: uuid("staff_id"),
	staffName: text("staff_name"),
	customerId: uuid("customer_id"),
	customerName: text("customer_name"),
	visitId: uuid("visit_id"),
	orderId: uuid("order_id"),
	amount: integer("amount"),
	currency: varchar({ length: 3 }).default('USD'),
	summary: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	searchBlob: text("search_blob").notNull(),
	dedupeKey: text("dedupe_key"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_club_events_amount").using("btree", table.amount.asc().nullsLast().op("int4_ops"), table.occurredAt.desc().nullsFirst().op("int4_ops")).where(sql`(amount IS NOT NULL)`),
	index("idx_club_events_metadata").using("gin", table.metadata),
	index("idx_club_events_customer").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(customer_id IS NOT NULL)`),
	uniqueIndex("idx_club_events_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where(sql`(dedupe_key IS NOT NULL)`),
	index("idx_club_events_domain").using("btree", table.eventDomain.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("idx_club_events_occurred").using("btree", table.occurredAt.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_club_events_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where(sql`(order_id IS NOT NULL)`),
	index("idx_club_events_register").using("btree", table.registerId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")).where(sql`(register_id IS NOT NULL)`),
	index("idx_club_events_search_trgm").using("gin", table.searchBlob.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_club_events_staff").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops")).where(sql`(staff_id IS NOT NULL)`),
	index("idx_club_events_type").using("btree", table.eventType.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_club_events_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "club_events_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "club_events_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "club_events_visit_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "club_events_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.registerId],
			foreignColumns: [registerSessions.id],
			name: "club_events_register_id_fkey"
		}).onDelete("set null"),
]);
