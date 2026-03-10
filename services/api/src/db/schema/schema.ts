import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, type AnyPgColumn, inet, time, primaryKey, pgEnum, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const auditAction = pgEnum("audit_action", ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'ASSIGN', 'RELEASE', 'OVERRIDE', 'CHECK_IN', 'CHECK_OUT', 'UPGRADE_DISCLAIMER', 'STAFF_WEBAUTHN_ENROLLED', 'STAFF_LOGIN_WEBAUTHN', 'STAFF_LOGIN_PIN', 'STAFF_LOGOUT', 'STAFF_WEBAUTHN_REVOKED', 'STAFF_PIN_RESET', 'STAFF_REAUTH_REQUIRED', 'STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_ACTIVATED', 'STAFF_DEACTIVATED', 'REGISTER_SIGN_IN', 'REGISTER_SIGN_OUT', 'REGISTER_FORCE_SIGN_OUT', 'WAITLIST_CREATED', 'WAITLIST_CANCELLED', 'WAITLIST_OFFERED', 'WAITLIST_COMPLETED', 'UPGRADE_STARTED', 'UPGRADE_PAID', 'UPGRADE_COMPLETED', 'FINAL_EXTENSION_STARTED', 'FINAL_EXTENSION_PAID', 'FINAL_EXTENSION_COMPLETED', 'STAFF_REAUTH_PIN', 'STAFF_REAUTH_WEBAUTHN', 'ROOM_STATUS_CHANGE', 'SHIFT_UPDATED', 'TIMECLOCK_ADJUSTED', 'TIMECLOCK_CLOSED', 'DOCUMENT_UPLOADED', 'TIME_OFF_REQUESTED', 'TIME_OFF_APPROVED', 'TIME_OFF_DENIED', 'SHIFT_CREATED', 'SHIFT_CANCELED'])
export const blockType = pgEnum("block_type", ['INITIAL', 'RENEWAL', 'FINAL2H'])
export const breakStatus = pgEnum("break_status", ['OPEN', 'CLOSED'])
export const breakType = pgEnum("break_type", ['MEAL', 'REST', 'OTHER'])
export const cashDrawerEventType = pgEnum("cash_drawer_event_type", ['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT'])
export const cashDrawerSessionStatus = pgEnum("cash_drawer_session_status", ['OPEN', 'CLOSED'])
export const checkoutRequestStatus = pgEnum("checkout_request_status", ['SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED'])
export const externalProviderEntityType = pgEnum("external_provider_entity_type", ['customer', 'payment', 'refund', 'order', 'shift', 'timeclock_session', 'cash_event', 'receipt'])
export const inventoryReservationKind = pgEnum("inventory_reservation_kind", ['LANE_SELECTION', 'UPGRADE_HOLD'])
export const inventoryResourceType = pgEnum("inventory_resource_type", ['room', 'locker'])
export const keyTagType = pgEnum("key_tag_type", ['QR', 'NFC'])
export const laneSessionStatus = pgEnum("lane_session_status", ['IDLE', 'ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE', 'COMPLETED', 'CANCELLED'])
export const orderLineItemKind = pgEnum("order_line_item_kind", ['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL', 'CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION'])
export const orderStatus = pgEnum("order_status", ['OPEN', 'PAID', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED'])
export const paymentStatus = pgEnum("payment_status", ['DUE', 'PAID', 'CANCELLED', 'REFUNDED'])
export const rentalType = pgEnum("rental_type", ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL', 'GYM_LOCKER'])
export const roomStatus = pgEnum("room_status", ['DIRTY', 'CLEANING', 'CLEAN', 'OCCUPIED', 'OUT_OF_SERVICE'])
export const roomType = pgEnum("room_type", ['STANDARD', 'DELUXE', 'VIP', 'LOCKER', 'DOUBLE', 'SPECIAL'])
export const shiftStatus = pgEnum("shift_status", ['SCHEDULED', 'UPDATED', 'CANCELED'])
export const staffRole = pgEnum("staff_role", ['STAFF', 'ADMIN'])
export const timeOffRequestStatus = pgEnum("time_off_request_status", ['PENDING', 'APPROVED', 'DENIED'])
export const waitlistStatus = pgEnum("waitlist_status", ['ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED'])


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

export const customers = pgTable("customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	dob: date(),
	membershipNumber: varchar("membership_number", { length: 50 }),
	membershipCardType: varchar("membership_card_type", { length: 20 }),
	membershipValidUntil: date("membership_valid_until"),
	bannedUntil: timestamp("banned_until", { withTimezone: true, mode: 'date' }),
	idScanHash: varchar("id_scan_hash", { length: 255 }),
	idScanValue: text("id_scan_value"),
	primaryLanguage: text("primary_language"),
	pastDueBalance: numeric("past_due_balance", { precision: 10, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	idExpirationDate: date("id_expiration_date"),
	idNumber: text("id_number"),
	idState: text("id_state"),
	idType: text("id_type"),
	idTypeOther: text("id_type_other"),
}, (table) => [
	index("customers_name_trgm_idx").using("gin", table.name.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_customers_banned").using("btree", table.bannedUntil.asc().nullsLast().op("timestamptz_ops")).where(sql`(banned_until IS NOT NULL)`),
	index("idx_customers_dob").using("btree", table.dob.asc().nullsLast().op("date_ops")).where(sql`(dob IS NOT NULL)`),
	index("idx_customers_id_hash").using("btree", table.idScanHash.asc().nullsLast().op("text_ops")).where(sql`(id_scan_hash IS NOT NULL)`),
	index("idx_customers_membership").using("btree", table.membershipNumber.asc().nullsLast().op("text_ops")).where(sql`(membership_number IS NOT NULL)`),
	check("customers_primary_language_check", sql`primary_language = ANY (ARRAY['EN'::text, 'ES'::text])`),
]);

export const schemaMigrations = pgTable("schema_migrations", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	executedAt: timestamp("executed_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	filename: text(),
}, (table) => [
	unique("schema_migrations_name_key").on(table.name),
]);

export const staff = pgTable("staff", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	role: staffRole().default('STAFF').notNull(),
	qrTokenHash: varchar("qr_token_hash", { length: 255 }),
	pinHash: varchar("pin_hash", { length: 255 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	forcePinChange: boolean("force_pin_change").default(false).notNull(),
}, (table) => [
	index("idx_staff_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where(sql`(active = true)`),
	index("idx_staff_qr_token_hash").using("btree", table.qrTokenHash.asc().nullsLast().op("text_ops")).where(sql`(qr_token_hash IS NOT NULL)`),
	index("idx_staff_role").using("btree", table.role.asc().nullsLast().op("enum_ops")),
	unique("staff_qr_token_hash_key").on(table.qrTokenHash),
]);

export const employeeDocuments = pgTable("employee_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	docType: text("doc_type").notNull(),
	filename: text().notNull(),
	mimeType: text("mime_type").notNull(),
	storageKey: text("storage_key").notNull(),
	uploadedBy: uuid("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	notes: text(),
	sha256Hash: text("sha256_hash"),
}, (table) => [
	index("idx_employee_documents_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
	index("idx_employee_documents_type").using("btree", table.docType.asc().nullsLast().op("text_ops")),
	index("idx_employee_documents_uploaded_by").using("btree", table.uploadedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "employee_documents_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [staff.id],
			name: "employee_documents_uploaded_by_fkey"
		}).onDelete("restrict"),
	check("employee_documents_doc_type_check", sql`doc_type = ANY (ARRAY['ID'::text, 'W4'::text, 'I9'::text, 'OFFER_LETTER'::text, 'NDA'::text, 'OTHER'::text])`),
]);

export const staffSessions = pgTable("staff_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffId: uuid("staff_id").notNull(),
	deviceId: varchar("device_id", { length: 255 }).notNull(),
	deviceType: varchar("device_type", { length: 50 }).notNull(),
	sessionToken: varchar("session_token", { length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	reauthOkUntil: timestamp("reauth_ok_until", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("idx_staff_sessions_active").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.revokedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(revoked_at IS NULL)`),
	index("idx_staff_sessions_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops"), table.deviceType.asc().nullsLast().op("text_ops")),
	index("idx_staff_sessions_reauth_ok").using("btree", table.sessionToken.asc().nullsLast().op("timestamptz_ops"), table.reauthOkUntil.asc().nullsLast().op("timestamptz_ops")).where(sql`((revoked_at IS NULL) AND (reauth_ok_until IS NOT NULL))`),
	index("idx_staff_sessions_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
	index("idx_staff_sessions_token").using("btree", table.sessionToken.asc().nullsLast().op("text_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "staff_sessions_staff_id_fkey"
		}).onDelete("cascade"),
	unique("staff_sessions_session_token_key").on(table.sessionToken),
]);

export const employeeShifts = pgTable("employee_shifts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	shiftCode: text("shift_code").notNull(),
	role: text(),
	status: shiftStatus().default('SCHEDULED').notNull(),
	notes: text(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	color: text().default('#3b82f6'),
	templateId: uuid("template_id"),
	breakMinutes: integer("break_minutes").default(0),
}, (table) => [
	index("idx_employee_shifts_dates").using("btree", table.startsAt.asc().nullsLast().op("timestamptz_ops"), table.endsAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_employee_shifts_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
	index("idx_employee_shifts_shift_code").using("btree", table.shiftCode.asc().nullsLast().op("text_ops")),
	index("idx_employee_shifts_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [staff.id],
			name: "employee_shifts_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "employee_shifts_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [staff.id],
			name: "employee_shifts_updated_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [shiftTemplates.id],
			name: "employee_shifts_template_id_fkey"
		}).onDelete("set null"),
]);

export const staffWebauthnCredentials = pgTable("staff_webauthn_credentials", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffId: uuid("staff_id").notNull(),
	deviceId: varchar("device_id", { length: 255 }).notNull(),
	credentialId: text("credential_id").notNull(),
	publicKey: text("public_key").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	signCount: bigint("sign_count", { mode: "number" }).default(0).notNull(),
	transports: jsonb().$type<string[]>(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'date' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("idx_webauthn_credentials_active").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.revokedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(revoked_at IS NULL)`),
	index("idx_webauthn_credentials_credential_id").using("btree", table.credentialId.asc().nullsLast().op("text_ops")).where(sql`(revoked_at IS NULL)`),
	index("idx_webauthn_credentials_device_id").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where(sql`(revoked_at IS NULL)`),
	index("idx_webauthn_credentials_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "staff_webauthn_credentials_staff_id_fkey"
		}).onDelete("cascade"),
]);

export const timeOffRequests = pgTable("time_off_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	day: date().notNull(),
	reason: text(),
	status: timeOffRequestStatus().default('PENDING').notNull(),
	decidedBy: uuid("decided_by"),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'date' }),
	decisionNotes: text("decision_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_time_off_requests_day").using("btree", table.day.asc().nullsLast().op("date_ops")),
	uniqueIndex("idx_time_off_requests_employee_day").using("btree", table.employeeId.asc().nullsLast().op("date_ops"), table.day.asc().nullsLast().op("date_ops")),
	index("idx_time_off_requests_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.decidedBy],
			foreignColumns: [staff.id],
			name: "time_off_requests_decided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "time_off_requests_employee_id_fkey"
		}).onDelete("cascade"),
]);

export const timeclockSessions = pgTable("timeclock_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	shiftId: uuid("shift_id"),
	clockInAt: timestamp("clock_in_at", { withTimezone: true, mode: 'date' }).notNull(),
	clockOutAt: timestamp("clock_out_at", { withTimezone: true, mode: 'date' }),
	source: text().notNull(),
	createdBy: uuid("created_by"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_timeclock_sessions_dates").using("btree", table.clockInAt.asc().nullsLast().op("timestamptz_ops"), table.clockOutAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_timeclock_sessions_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_timeclock_sessions_employee_open").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")).where(sql`(clock_out_at IS NULL)`),
	index("idx_timeclock_sessions_open").using("btree", table.clockOutAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(clock_out_at IS NULL)`),
	index("idx_timeclock_sessions_shift").using("btree", table.shiftId.asc().nullsLast().op("uuid_ops")).where(sql`(shift_id IS NOT NULL)`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [staff.id],
			name: "timeclock_sessions_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "timeclock_sessions_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.shiftId],
			foreignColumns: [employeeShifts.id],
			name: "timeclock_sessions_shift_id_fkey"
		}).onDelete("set null"),
	check("timeclock_sessions_source_check", sql`source = ANY (ARRAY['EMPLOYEE_REGISTER'::text, 'OFFICE_DASHBOARD'::text])`),
]);

export const webauthnChallenges = pgTable("webauthn_challenges", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	challenge: text().notNull(),
	staffId: uuid("staff_id"),
	deviceId: varchar("device_id", { length: 255 }),
	type: varchar({ length: 50 }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_webauthn_challenges_challenge").using("btree", table.challenge.asc().nullsLast().op("text_ops")),
	index("idx_webauthn_challenges_expires").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_webauthn_challenges_staff_device").using("btree", table.staffId.asc().nullsLast().op("text_ops"), table.deviceId.asc().nullsLast().op("uuid_ops")).where(sql`(expires_at IS NOT NULL)`),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "webauthn_challenges_staff_id_fkey"
		}).onDelete("cascade"),
	unique("webauthn_challenges_challenge_key").on(table.challenge),
]);

export const inventoryResources = pgTable("inventory_resources", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	kind: inventoryResourceType().notNull(),
	number: varchar({ length: 20 }).notNull(),
	tier: roomType().default('STANDARD').notNull(),
	status: roomStatus().default('CLEAN').notNull(),
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
	tagType: keyTagType("tag_type").notNull(),
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

export const waitlist = pgTable("waitlist", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	visitId: uuid("visit_id").notNull(),
	checkinBlockId: uuid("checkin_block_id").notNull(),
	desiredTier: rentalType("desired_tier").notNull(),
	backupTier: rentalType("backup_tier").notNull(),
	resourceId: uuid("resource_id"),
	status: waitlistStatus().default('ACTIVE').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	offeredAt: timestamp("offered_at", { withTimezone: true, mode: 'date' }),
	offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true, mode: 'date' }),
	lastOfferedAt: timestamp("last_offered_at", { withTimezone: true, mode: 'date' }),
	offerAttempts: integer("offer_attempts").default(0).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'date' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'date' }),
	cancelledByStaffId: uuid("cancelled_by_staff_id"),
	desiredTiers: rentalType("desired_tiers").array().default(sql`'{}'::rental_type[]`).notNull(),
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

export const agreements = pgTable("agreements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	version: varchar({ length: 50 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	bodyText: text("body_text").default('').notNull(),
	active: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_agreements_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where(sql`(active = true)`),
]);

export const agreementSignatures = pgTable("agreement_signatures", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	agreementId: uuid("agreement_id").notNull(),
	customerName: varchar("customer_name", { length: 255 }).notNull(),
	membershipNumber: varchar("membership_number", { length: 50 }),
	signedAt: timestamp("signed_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	signaturePngBase64: text("signature_png_base64"),
	signatureStrokesJson: jsonb("signature_strokes_json"),
	agreementTextSnapshot: text("agreement_text_snapshot").notNull(),
	agreementVersion: varchar("agreement_version", { length: 50 }).notNull(),
	deviceId: varchar("device_id", { length: 255 }),
	deviceType: varchar("device_type", { length: 50 }),
	userAgent: text("user_agent"),
	ipAddress: inet("ip_address"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	checkinBlockId: uuid("checkin_block_id"),
}, (table) => [
	index("idx_agreement_signatures_agreement").using("btree", table.agreementId.asc().nullsLast().op("uuid_ops")),
	index("idx_agreement_signatures_checkin_block").using("btree", table.checkinBlockId.asc().nullsLast().op("uuid_ops")).where(sql`(checkin_block_id IS NOT NULL)`),
	index("idx_agreement_signatures_signed_at").using("btree", table.signedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.agreementId],
			foreignColumns: [agreements.id],
			name: "agreement_signatures_agreement_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.checkinBlockId],
			foreignColumns: [checkinBlocks.id],
			name: "agreement_signatures_checkin_block_id_fkey"
		}).onDelete("set null"),
]);

export const checkinBlocks = pgTable("checkin_blocks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	visitId: uuid("visit_id").notNull(),
	blockType: blockType("block_type").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	resourceId: uuid("resource_id"),
	sessionId: uuid("session_id"),
	agreementSigned: boolean("agreement_signed").default(false).notNull(),
	agreementPdf: customType<{ data: Buffer; driverData: Buffer }>({
		dataType() { return 'bytea'; },
	})("agreement_pdf"),
	agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	hasTvRemote: boolean("has_tv_remote").default(false).notNull(),
	waitlistId: uuid("waitlist_id"),
	rentalType: rentalType("rental_type").notNull(),
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

export const inventoryReservations = pgTable("inventory_reservations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	resourceType: inventoryResourceType("resource_type").notNull(),
	resourceId: uuid("resource_id").notNull(),
	kind: inventoryReservationKind().notNull(),
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
	check("inventory_reservations_lane_session_required", sql`(kind <> 'LANE_SELECTION'::inventory_reservation_kind) OR (lane_session_id IS NOT NULL)`),
	check("inventory_reservations_waitlist_required", sql`(kind <> 'UPGRADE_HOLD'::inventory_reservation_kind) OR (waitlist_id IS NOT NULL)`),
]);

// charges and paymentIntents tables removed — unified into orders/orderLineItems

export const devices = pgTable("devices", {
	deviceId: varchar("device_id", { length: 255 }).primaryKey().notNull(),
	displayName: varchar("display_name", { length: 255 }).notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true, mode: 'date' }),
	lastLaneId: varchar("last_lane_id", { length: 50 }),
}, (table) => [
	index("idx_devices_enabled").using("btree", table.enabled.asc().nullsLast().op("bool_ops")).where(sql`(enabled = true)`),
]);

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
	status: checkoutRequestStatus().default('SUBMITTED'),
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
]);

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
	statusFrom: roomStatus("status_from").notNull(),
	statusTo: roomStatus("status_to").notNull(),
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
	fromStatus: roomStatus("from_status").notNull(),
	toStatus: roomStatus("to_status").notNull(),
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

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id", { length: 255 }),
	userRole: varchar("user_role", { length: 50 }),
	action: auditAction().notNull(),
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
	status: cashDrawerSessionStatus().default('OPEN').notNull(),
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
	type: cashDrawerEventType().notNull(),
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

export const staffBreakSessions = pgTable("staff_break_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffId: uuid("staff_id").notNull(),
	timeclockSessionId: uuid("timeclock_session_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'date' }),
	breakType: breakType("break_type").notNull(),
	status: breakStatus().default('OPEN').notNull(),
	notes: text(),
}, (table) => [
	index("idx_staff_break_sessions_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
	index("idx_staff_break_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_staff_break_sessions_timeclock").using("btree", table.timeclockSessionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staff.id],
			name: "staff_break_sessions_staff_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.timeclockSessionId],
			foreignColumns: [timeclockSessions.id],
			name: "staff_break_sessions_timeclock_session_id_fkey"
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
	status: orderStatus().default('OPEN').notNull(),
	subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
	discount: numeric("discount", { precision: 10, scale: 2 }).notNull(),
	tax: numeric("tax", { precision: 10, scale: 2 }).notNull(),
	tip: numeric("tip", { precision: 10, scale: 2 }).default('0').notNull(),
	total: numeric("total", { precision: 10, scale: 2 }).notNull(),
	currency: varchar({ length: 3 }).default('USD').notNull(),
	paymentMethod: text("payment_method"),
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
	check("orders_payment_method_check", sql`payment_method IS NULL OR payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text])`),
]);

export const orderLineItems = pgTable("order_line_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	kind: orderLineItemKind().notNull(),
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

export const externalProviderRefs = pgTable("external_provider_refs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().notNull(),
	entityType: externalProviderEntityType("entity_type").notNull(),
	internalId: uuid("internal_id").notNull(),
	externalId: text("external_id").notNull(),
	externalVersion: text("external_version"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	unique("external_provider_refs_provider_entity_type_internal_id_key").on(table.provider, table.entityType, table.internalId),
	unique("external_provider_refs_provider_entity_type_external_id_key").on(table.provider, table.entityType, table.externalId),
]);

export const demoState = pgTable("demo_state", {
	key: text().primaryKey().notNull(),
	valueJson: jsonb("value_json").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const laneFeatureFlags = pgTable("lane_feature_flags", {
	laneId: varchar("lane_id", { length: 50 }).primaryKey().notNull(),
	lockstepV2Enabled: boolean("lockstep_v2_enabled"),
	flowCommandsEnabled: boolean("flow_commands_enabled"),
	lanFallbackEnabled: boolean("lan_fallback_enabled"),
	lanAuthoritativeEnabled: boolean("lan_authoritative_enabled"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const offlineCommandOutbox = pgTable("offline_command_outbox", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	laneId: varchar("lane_id", { length: 50 }).notNull(),
	sessionId: uuid("session_id").notNull(),
	commandId: uuid("command_id").notNull(),
	actor: varchar({ length: 20 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	payloadJson: jsonb("payload_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	replayedAt: timestamp("replayed_at", { withTimezone: true, mode: 'date' }),
	replayAttempts: integer("replay_attempts").default(0).notNull(),
	lastReplayError: text("last_replay_error"),
}, (table) => [
	index("idx_offline_command_outbox_pending").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(replayed_at IS NULL)`),
	unique("offline_command_outbox_session_command_unique").on(table.sessionId, table.commandId),
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

export const shiftTemplates = pgTable("shift_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	label: text().notNull(),
	defaultStartTime: time("default_start_time").notNull(),
	defaultEndTime: time("default_end_time").notNull(),
	color: text().default('#3b82f6').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	active: boolean().default(true).notNull(),
}, (table) => [
	index("idx_shift_templates_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where(sql`(active = true)`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [staff.id],
			name: "shift_templates_created_by_fkey"
		}).onDelete("set null"),
]);

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

export const schedulePatterns = pgTable("schedule_patterns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	dayOfWeek: integer("day_of_week").notNull(),
	templateId: uuid("template_id").notNull(),
	active: boolean().default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("idx_schedule_patterns_employee_day").using("btree", table.employeeId.asc().nullsLast().op("int4_ops"), table.dayOfWeek.asc().nullsLast().op("int4_ops")).where(sql`(active = true)`),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [staff.id],
			name: "schedule_patterns_employee_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [shiftTemplates.id],
			name: "schedule_patterns_template_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [staff.id],
			name: "schedule_patterns_created_by_fkey"
		}).onDelete("set null"),
	check("schedule_patterns_day_of_week_check", sql`(day_of_week >= 0) AND (day_of_week <= 6)`),
]);

export const laneSessions = pgTable("lane_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	laneId: varchar("lane_id", { length: 50 }).notNull(),
	status: laneSessionStatus().default('IDLE').notNull(),
	staffId: uuid("staff_id"),
	customerDisplayName: varchar("customer_display_name", { length: 255 }),
	membershipNumber: varchar("membership_number", { length: 50 }),
	desiredRentalType: rentalType("desired_rental_type"),
	waitlistDesiredType: rentalType("waitlist_desired_type"),
	backupRentalType: rentalType("backup_rental_type"),
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
	proposedRentalType: rentalType("proposed_rental_type"),
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
	check("lane_sessions_membership_choice_check", sql`((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL)`),
	check("lane_sessions_renewal_hours_check", sql`(renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL)`),
	check("lane_sessions_proposed_by_check", sql`(proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
	check("lane_sessions_selection_confirmed_by_check", sql`(selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
	check("lane_sessions_waitlist_requested_resource_type_check", sql`(waitlist_requested_resource_type IS NULL) OR ((waitlist_requested_resource_type)::text = ANY ((ARRAY['room'::character varying, 'locker'::character varying])::text[]))`),
	check("lane_sessions_flow_last_actor_check", sql`(flow_last_actor IS NULL) OR ((flow_last_actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[]))`),
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

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sender: text().notNull(),
	subject: text().notNull(),
	body: text().notNull(),
	read: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_messages_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
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
