import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { staff, customers } from './identity';
import { checkoutRequests, visits } from './visits';

export const registerSessions = pgTable("register_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	deviceId: varchar("device_id", { length: 255 }).notNull(),
	registerNumber: integer("register_number").notNull(),
	lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	signedOutAt: timestamp("signed_out_at", { withTimezone: true, mode: 'date' }),
	closeoutSummaryJson: jsonb("closeout_summary_json"),
	lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_register_sessions_activity").using("btree", table.lastActivityAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(signed_out_at IS NULL)`),
	index("idx_register_sessions_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("idx_register_sessions_device_active").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where(sql`(signed_out_at IS NULL)`),
	index("idx_register_sessions_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
	index("idx_register_sessions_heartbeat").using("btree", table.lastHeartbeat.asc().nullsLast().op("timestamptz_ops")).where(sql`(signed_out_at IS NULL)`),
	uniqueIndex("idx_register_sessions_register_active").using("btree", table.registerNumber.asc().nullsLast().op("int4_ops")).where(sql`(signed_out_at IS NULL)`),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "register_sessions_employee_id_fkey"
		}).onDelete("cascade"),
	check("register_sessions_register_number_check", sql`register_number = ANY (ARRAY[1, 2, 3])`),
]);

export const lateCheckoutEvents = pgTable("late_checkout_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	occupancyId: uuid("occupancy_id").notNull(),
	checkoutRequestId: uuid("checkout_request_id"),
	lateMinutes: integer("late_minutes").notNull(),
	feeAmount: numeric("fee_amount", { precision: 10, scale:  2 }).notNull(),
	banApplied: boolean("ban_applied").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerId: uuid("customer_id").notNull(),
}, (table) => [
	index("idx_late_checkout_events_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_late_checkout_events_occupancy").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")),
	index("idx_late_checkout_events_request").using("btree", table.checkoutRequestId.asc().nullsLast().op("uuid_ops")).where(sql`(checkout_request_id IS NOT NULL)`),
	foreignKey({
			columns: [table.checkoutRequestId],
			foreignColumns: [checkoutRequests.id],
			name: "late_checkout_events_checkout_request_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "late_checkout_events_customer_id_fkey"
		}).onDelete("restrict"),
]);

export const cashDrawerSessions = pgTable("cash_drawer_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	registerSessionId: uuid("register_session_id").notNull(),
	openedByStaffId: uuid("opened_by_staff_id").notNull(),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	openingFloat: integer("opening_float").notNull(),
	closedByStaffId: uuid("closed_by_staff_id"),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'date' }),
	countedCash: integer("counted_cash"),
	expectedCash: integer("expected_cash"),
	overShort: integer("over_short"),
	notes: text(),
	status: enums.cashDrawerSessionStatus().default('OPEN').notNull(),
	closeoutSnapshotJson: jsonb("closeout_snapshot_json").$type<Record<string, unknown>>(),
}, (table) => [
	index("idx_cash_drawer_sessions_opened_by").using("btree", table.openedByStaffId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_drawer_sessions_register_session").using("btree", table.registerSessionId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_drawer_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.registerSessionId],
			foreignColumns: [registerSessions.id],
			name: "cash_drawer_sessions_register_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.openedByStaffId],
			foreignColumns: [staff.id],
			name: "cash_drawer_sessions_opened_by_staff_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.closedByStaffId],
			foreignColumns: [staff.id],
			name: "cash_drawer_sessions_closed_by_staff_id_fkey"
		}).onDelete("set null"),
]);

export const cashDrawerEvents = pgTable("cash_drawer_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	cashDrawerSessionId: uuid("cash_drawer_session_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	type: enums.cashDrawerEventType().notNull(),
	amount: integer("amount"),
	reason: text(),
	createdByStaffId: uuid("created_by_staff_id").notNull(),
	metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
}, (table) => [
	index("idx_cash_drawer_events_created_by").using("btree", table.createdByStaffId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_drawer_events_occurred_at").using("btree", table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_cash_drawer_events_session").using("btree", table.cashDrawerSessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.cashDrawerSessionId],
			foreignColumns: [cashDrawerSessions.id],
			name: "cash_drawer_events_cash_drawer_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdByStaffId],
			foreignColumns: [staff.id],
			name: "cash_drawer_events_created_by_staff_id_fkey"
		}).onDelete("cascade"),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id"),
	visitId: uuid("visit_id"),
	laneSessionId: uuid("lane_session_id"),
	registerSessionId: uuid("register_session_id"),
	createdByStaffId: uuid("created_by_staff_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	status: enums.orderStatus().default('OPEN').notNull(),
	subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
	discount: numeric("discount", { precision: 10, scale: 2 }).notNull(),
	tax: numeric("tax", { precision: 10, scale: 2 }).notNull(),
	tip: numeric("tip", { precision: 10, scale: 2 }).default('0').notNull(),
	total: numeric("total", { precision: 10, scale: 2 }).notNull(),
	currency: varchar({ length: 3 }).default('USD').notNull(),
	paymentMethod: text("payment_method"),
	splitCashAmount: numeric("split_cash_amount", { precision: 10, scale: 2 }),
	splitCreditAmount: numeric("split_credit_amount", { precision: 10, scale: 2 }),
	squareTransactionId: varchar("square_transaction_id", { length: 255 }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'date' }),
	paidByStaffId: uuid("paid_by_staff_id"),
	quoteJson: jsonb("quote_json").$type<Record<string, unknown>>(),
	failureReason: text("failure_reason"),
	failureAt: timestamp("failure_at", { withTimezone: true, mode: 'date' }),
	registerNumber: integer("register_number"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	metadataJson: jsonb("metadata_json"),
}, (table) => [
	index("idx_orders_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_orders_metadata").using("gin", table.metadataJson),
	index("idx_orders_created_by").using("btree", table.createdByStaffId.asc().nullsLast().op("uuid_ops")).where(sql`(created_by_staff_id IS NOT NULL)`),
	index("idx_orders_customer").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")).where(sql`(customer_id IS NOT NULL)`),
	index("idx_orders_lane_session").using("btree", table.laneSessionId.asc().nullsLast().op("uuid_ops")).where(sql`(lane_session_id IS NOT NULL)`),
	index("idx_orders_register_session").using("btree", table.registerSessionId.asc().nullsLast().op("uuid_ops")).where(sql`(register_session_id IS NOT NULL)`),
	index("idx_orders_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_orders_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")).where(sql`(visit_id IS NOT NULL)`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "orders_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.registerSessionId],
			foreignColumns: [registerSessions.id],
			name: "orders_register_session_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdByStaffId],
			foreignColumns: [staff.id],
			name: "orders_created_by_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.paidByStaffId],
			foreignColumns: [staff.id],
			name: "orders_paid_by_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "orders_visit_id_fkey"
		}).onDelete("set null"),
	// FK: laneSessionId → lane_sessions.id (defined at DB level, omitted to avoid circular TS ref)
	check("orders_payment_method_check", sql`payment_method IS NULL OR payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text, 'SPLIT'::text])`),
]);

export const orderLineItems = pgTable("order_line_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	kind: enums.orderLineItemKind().notNull(),
	sku: text(),
	name: text().notNull(),
	quantity: integer().notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
	discount: numeric("discount", { precision: 10, scale: 2 }).default('0').notNull(),
	tax: numeric("tax", { precision: 10, scale: 2 }).default('0').notNull(),
	total: numeric("total", { precision: 10, scale: 2 }).notNull(),
	metadataJson: jsonb("metadata_json"),
}, (table) => [
	index("idx_order_line_items_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_line_items_metadata").using("gin", table.metadataJson),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_line_items_order_id_fkey"
		}).onDelete("cascade"),
]);

export const receipts = pgTable("receipts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	receiptNumber: text("receipt_number").notNull(),
	receiptJson: jsonb("receipt_json").notNull(),
	pdfStorageKey: text("pdf_storage_key"),
	metadataJson: jsonb("metadata_json"),
}, (table) => [
	index("idx_receipts_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "receipts_order_id_fkey"
		}).onDelete("cascade"),
	unique("receipts_receipt_number_key").on(table.receiptNumber),
]);

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sku: text(),
	name: text().notNull(),
	price: integer("price").default(0).notNull(),
	category: text().default('RETAIL').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	imageUrl: text("image_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_products_category_active").using("btree", table.category.asc().nullsLast().op("text_ops"), table.isActive.asc().nullsLast().op("text_ops")),
	index("idx_products_sku").using("btree", table.sku.asc().nullsLast().op("text_ops")).where(sql`(sku IS NOT NULL)`),
	unique("products_sku_key").on(table.sku),
]);
