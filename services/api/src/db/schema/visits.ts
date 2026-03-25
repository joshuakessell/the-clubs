import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { customers, staff } from './identity';
import { inventoryResources, keyTags } from './inventory';
import { orders } from './commerce';

export const visits = pgTable("visits", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerId: uuid("customer_id").notNull(),
}, (table) => [
	index("idx_visits_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "visits_customer_id_fkey"
		}).onDelete("restrict"),
]);

export const waitlist = pgTable("waitlist", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	visitId: uuid("visit_id").notNull(),
	checkinBlockId: uuid("checkin_block_id").notNull(),
	desiredTier: enums.rentalType("desired_tier").notNull(),
	backupTier: enums.rentalType("backup_tier").notNull(),
	resourceId: uuid("resource_id"),
	status: enums.waitlistStatus().default('ACTIVE').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	offeredAt: timestamp("offered_at", { withTimezone: true, mode: 'date' }),
	offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true, mode: 'date' }),
	lastOfferedAt: timestamp("last_offered_at", { withTimezone: true, mode: 'date' }),
	offerAttempts: integer("offer_attempts").default(0).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'date' }),
	cancelledByStaffId: uuid("cancelled_by_staff_id"),
	desiredTiers: enums.rentalType("desired_tiers").array().default(sql`'{}'::rental_type[]`).notNull(),
}, (table) => [
	index("idx_waitlist_active").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'ACTIVE'::waitlist_status)`),
	index("idx_waitlist_block").using("btree", table.checkinBlockId.asc().nullsLast().op("uuid_ops")),
	index("idx_waitlist_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_waitlist_desired_tier").using("btree", table.desiredTier.asc().nullsLast().op("enum_ops")),
	index("idx_waitlist_desired_tiers").using("gin", table.desiredTiers.asc().nullsLast().op("array_ops")),
	index("idx_waitlist_offered").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.createdAt.asc().nullsLast().op("enum_ops")).where(sql`(status = 'OFFERED'::waitlist_status)`),
	index("idx_waitlist_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")).where(sql`(resource_id IS NOT NULL)`),
	index("idx_waitlist_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_waitlist_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.cancelledByStaffId],
			foreignColumns: [staff.id],
			name: "waitlist_cancelled_by_staff_id_fkey"
		}).onDelete("set null"),
	// FK: checkinBlockId → checkin_blocks.id (defined at DB level, omitted to avoid circular TS ref)

	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "waitlist_resource_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "waitlist_visit_id_fkey"
		}).onDelete("cascade"),
]);

export const checkinBlocks = pgTable("checkin_blocks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	visitId: uuid("visit_id").notNull(),
	blockType: enums.blockType("block_type").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	resourceId: uuid("resource_id"),
	sessionId: uuid("session_id"),
	agreementSigned: boolean("agreement_signed").default(false).notNull(),
	agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	hasTvRemote: boolean("has_tv_remote").default(false).notNull(),
	waitlistId: uuid("waitlist_id"),
	rentalType: enums.rentalType("rental_type").notNull(),
}, (table) => [
	index("idx_checkin_blocks_ends_at").using("btree", table.endsAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(ends_at IS NOT NULL)`),
	index("idx_checkin_blocks_resource").using("btree", table.resourceId.asc().nullsLast().op("uuid_ops")).where(sql`(resource_id IS NOT NULL)`),
	index("idx_checkin_blocks_session").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")).where(sql`(session_id IS NOT NULL)`),
	index("idx_checkin_blocks_tv_remote").using("btree", table.hasTvRemote.asc().nullsLast().op("bool_ops")).where(sql`(has_tv_remote = true)`),
	index("idx_checkin_blocks_type").using("btree", table.blockType.asc().nullsLast().op("enum_ops")),
	index("idx_checkin_blocks_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")),
	index("idx_checkin_blocks_waitlist").using("btree", table.waitlistId.asc().nullsLast().op("uuid_ops")).where(sql`(waitlist_id IS NOT NULL)`),
	foreignKey({
			columns: [table.resourceId],
			foreignColumns: [inventoryResources.id],
			name: "checkin_blocks_resource_id_fkey"
		}).onDelete("set null"),
	// FK: sessionId → lane_sessions.id (defined at DB level, omitted to avoid circular TS ref)

	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "checkin_blocks_visit_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.waitlistId],
			foreignColumns: [waitlist.id],
			name: "checkin_blocks_waitlist_id_fkey"
		}).onDelete("set null"),
]);

export const checkoutRequests = pgTable("checkout_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	occupancyId: uuid("occupancy_id").notNull(),
	keyTagId: uuid("key_tag_id"),
	kioskDeviceId: varchar("kiosk_device_id", { length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	claimedByStaffId: uuid("claimed_by_staff_id"),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'date' }),
	claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true, mode: 'date' }),
	customerChecklistJson: jsonb("customer_checklist_json").notNull(),
	lateMinutes: integer("late_minutes").default(0).notNull(),
	lateFeeAmount: numeric("late_fee_amount", { precision: 10, scale:  2 }).default('0').notNull(),
	banApplied: boolean("ban_applied").default(false).notNull(),
	itemsConfirmed: boolean("items_confirmed").default(false).notNull(),
	feePaid: boolean("fee_paid").default(false).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	customerId: uuid("customer_id").notNull(),
	status: enums.checkoutRequestStatus().default('SUBMITTED'),
}, (table) => [
	index("idx_checkout_requests_claim_expires").using("btree", table.claimExpiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(claim_expires_at IS NOT NULL)`),
	index("idx_checkout_requests_claimed").using("btree", table.claimedByStaffId.asc().nullsLast().op("uuid_ops")).where(sql`(claimed_by_staff_id IS NOT NULL)`),
	index("idx_checkout_requests_kiosk").using("btree", table.kioskDeviceId.asc().nullsLast().op("text_ops")),
	index("idx_checkout_requests_occupancy").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.claimedByStaffId],
			foreignColumns: [staff.id],
			name: "checkout_requests_claimed_by_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "checkout_requests_customer_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.keyTagId],
			foreignColumns: [keyTags.id],
			name: "checkout_requests_key_tag_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.occupancyId],
			foreignColumns: [checkinBlocks.id],
			name: "checkout_requests_occupancy_id_fkey"
		}).onDelete("cascade"),
]);

export const laneFeatureFlags = pgTable("lane_feature_flags", {
	laneId: varchar("lane_id", { length: 50 }).primaryKey().notNull(),
	lockstepV2Enabled: boolean("lockstep_v2_enabled"),
	flowCommandsEnabled: boolean("flow_commands_enabled"),
	lanFallbackEnabled: boolean("lan_fallback_enabled"),
	lanAuthoritativeEnabled: boolean("lan_authoritative_enabled"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const lateCheckoutBanAlerts = pgTable("late_checkout_ban_alerts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	checkoutRequestId: uuid("checkout_request_id"),
	occupancyId: uuid("occupancy_id").notNull(),
	visitId: uuid("visit_id"),
	lateMinutes: integer("late_minutes").notNull(),
	feeAmount: integer("fee_amount").notNull(),
	recommendedBanDays: integer("recommended_ban_days").default(30).notNull(),
	status: text().default('PENDING').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdByStaffId: uuid("created_by_staff_id"),
	createdByStaffName: text("created_by_staff_name"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'date' }),
	decidedByStaffId: uuid("decided_by_staff_id"),
	decidedByStaffName: text("decided_by_staff_name"),
	decision: text(),
	banDays: integer("ban_days"),
	managerNotes: text("manager_notes"),
}, (table) => [
	index("idx_late_checkout_ban_alerts_customer").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("idx_late_checkout_ban_alerts_occupancy_manual").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")).where(sql`(checkout_request_id IS NULL)`),
	uniqueIndex("idx_late_checkout_ban_alerts_request").using("btree", table.checkoutRequestId.asc().nullsLast().op("uuid_ops")),
	index("idx_late_checkout_ban_alerts_status_created").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "late_checkout_ban_alerts_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.checkoutRequestId],
			foreignColumns: [checkoutRequests.id],
			name: "late_checkout_ban_alerts_checkout_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.occupancyId],
			foreignColumns: [checkinBlocks.id],
			name: "late_checkout_ban_alerts_occupancy_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.visitId],
			foreignColumns: [visits.id],
			name: "late_checkout_ban_alerts_visit_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdByStaffId],
			foreignColumns: [staff.id],
			name: "late_checkout_ban_alerts_created_by_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.decidedByStaffId],
			foreignColumns: [staff.id],
			name: "late_checkout_ban_alerts_decided_by_staff_id_fkey"
		}).onDelete("set null"),
]);

export const laneSessions = pgTable("lane_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	laneId: varchar("lane_id", { length: 50 }).notNull(),
	status: enums.laneSessionStatus().default('IDLE').notNull(),
	staffId: uuid("staff_id"),
	customerDisplayName: varchar("customer_display_name", { length: 255 }),
	membershipNumber: varchar("membership_number", { length: 50 }),
	desiredRentalType: enums.rentalType("desired_rental_type"),
	waitlistDesiredType: enums.rentalType("waitlist_desired_type"),
	backupRentalType: enums.rentalType("backup_rental_type"),
	assignedResourceId: uuid("assigned_resource_id"),
	assignedResourceType: varchar("assigned_resource_type", { length: 20 }),
	priceQuoteJson: jsonb("price_quote_json"),
	disclaimersAckJson: jsonb("disclaimers_ack_json"),
	orderId: uuid("order_id"),
	membershipPurchaseIntent: varchar("membership_purchase_intent", { length: 20 }),
	membershipPurchaseRequestedAt: timestamp("membership_purchase_requested_at", { withTimezone: true, mode: 'date' }),
	membershipChoice: varchar("membership_choice", { length: 20 }),
	kioskAcknowledgedAt: timestamp("kiosk_acknowledged_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	checkinMode: varchar("checkin_mode", { length: 20 }).default('CHECKIN'),
	renewalHours: integer("renewal_hours"),
	customerId: uuid("customer_id"),
	proposedRentalType: enums.rentalType("proposed_rental_type"),
	proposedBy: varchar("proposed_by", { length: 20 }),
	selectionConfirmed: boolean("selection_confirmed").default(false),
	selectionConfirmedBy: varchar("selection_confirmed_by", { length: 20 }),
	selectionLockedAt: timestamp("selection_locked_at", { withTimezone: true, mode: 'date' }),
	waitlistDesiredTypesJson: jsonb("waitlist_desired_types_json"),
	waitlistRequestedResourceNumber: varchar("waitlist_requested_resource_number", { length: 20 }),
	waitlistRequestedResourceType: varchar("waitlist_requested_resource_type", { length: 20 }),
	flowStep: varchar("flow_step", { length: 50 }),
	flowVersion: integer("flow_version").default(0).notNull(),
	flowLastCommandId: uuid("flow_last_command_id"),
	flowLastActor: varchar("flow_last_actor", { length: 20 }),
	agreementBypassPending: boolean("agreement_bypass_pending").default(false).notNull(),
	agreementSignedMethod: varchar("agreement_signed_method", { length: 16 }),
	pastDueBypassed: boolean("past_due_bypassed").default(false).notNull(),
	pastDueBypassedByStaffId: uuid("past_due_bypassed_by_staff_id"),
	pastDueBypassedAt: timestamp("past_due_bypassed_at", { withTimezone: true, mode: 'date' }),
	lastPaymentDeclineReason: text("last_payment_decline_reason"),
	lastPaymentDeclineAt: timestamp("last_payment_decline_at", { withTimezone: true, mode: 'date' }),
	lastPastDueDeclineReason: text("last_past_due_decline_reason"),
	lastPastDueDeclineAt: timestamp("last_past_due_decline_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("idx_lane_sessions_checkin_mode").using("btree", table.checkinMode.asc().nullsLast().op("text_ops")),
	index("idx_lane_sessions_lane").using("btree", table.laneId.asc().nullsLast().op("text_ops")),
	index("idx_lane_sessions_lane_active").using("btree", table.laneId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['ACTIVE'::lane_session_status, 'AWAITING_CUSTOMER'::lane_session_status, 'AWAITING_ASSIGNMENT'::lane_session_status, 'AWAITING_PAYMENT'::lane_session_status, 'AWAITING_SIGNATURE'::lane_session_status]))`),
	index("idx_lane_sessions_selection_state").using("btree", table.proposedRentalType.asc().nullsLast().op("bool_ops"), table.selectionConfirmed.asc().nullsLast().op("enum_ops")).where(sql`(proposed_rental_type IS NOT NULL)`),
	index("idx_lane_sessions_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")).where(sql`(staff_id IS NOT NULL)`),
	index("idx_lane_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "fk_lane_sessions_order"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "lane_sessions_customer_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "lane_sessions_staff_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.pastDueBypassedByStaffId],
			foreignColumns: [staff.id],
			name: "lane_sessions_past_due_bypassed_by_staff_id_fkey"
		}),
	foreignKey({
			columns: [table.assignedResourceId],
			foreignColumns: [inventoryResources.id],
			name: "lane_sessions_assigned_resource_id_fkey"
		}).onDelete("set null"),
	index("idx_lane_sessions_assigned_resource").using("btree", table.assignedResourceId.asc().nullsLast().op("uuid_ops")),
	check("lane_sessions_membership_choice_check", sql`((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL)`),
	check("lane_sessions_renewal_hours_check", sql`(renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL)`),
	check("lane_sessions_proposed_by_check", sql`(proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
	check("lane_sessions_selection_confirmed_by_check", sql`(selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
	check("lane_sessions_waitlist_requested_resource_type_check", sql`(waitlist_requested_resource_type IS NULL) OR ((waitlist_requested_resource_type)::text = ANY ((ARRAY['room'::character varying, 'locker'::character varying])::text[]))`),
	check("lane_sessions_flow_last_actor_check", sql`(flow_last_actor IS NULL) OR ((flow_last_actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[]))`),
]);

export const laneSessionCommands = pgTable("lane_session_commands", {
	sessionId: uuid("session_id").notNull(),
	commandId: uuid("command_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	actor: varchar({ length: 20 }).notNull(),
	type: varchar({ length: 100 }).notNull(),
	payloadJson: jsonb("payload_json"),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [laneSessions.id],
			name: "lane_session_commands_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.sessionId, table.commandId], name: "lane_session_commands_pkey"}),
	check("lane_session_commands_actor_check", sql`(actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[])`),
]);
