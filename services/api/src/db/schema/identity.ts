import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, boolean, bigint, jsonb } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';

export const customers = pgTable("customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	squareCustomerId: varchar("square_customer_id", { length: 255 }).unique(),
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
	index("idx_customers_square_id").using("btree", table.squareCustomerId.asc().nullsLast().op("text_ops")),
	check("customers_primary_language_check", sql`primary_language = ANY (ARRAY['EN'::text, 'ES'::text])`),
]);

export const staff = pgTable("staff", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	role: enums.staffRole().default('STAFF').notNull(),
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
