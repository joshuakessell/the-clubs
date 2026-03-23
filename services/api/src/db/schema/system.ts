import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { checkinBlocks } from './visits';

export const schemaMigrations = pgTable("schema_migrations", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	executedAt: timestamp("executed_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	filename: text(),
}, (table) => [
	unique("schema_migrations_name_key").on(table.name),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
	principalId: text("principal_id").notNull(),
	routePath: text("route_path").notNull(),
	idempotencyKey: text("idempotency_key").notNull(),
	requestHash: text("request_hash").notNull(),
	responseStatus: integer("response_status").notNull(),
	responseBody: jsonb("response_body"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' })
		.default(sql`NOW() + INTERVAL '24 hours'`)
		.notNull(),
}, (table) => [
	primaryKey({ columns: [table.principalId, table.routePath, table.idempotencyKey] }),
	index("idx_idempotency_keys_expires").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	check("idempotency_keys_status_check", sql`response_status BETWEEN 100 AND 599`),
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

export const externalProviderRefs = pgTable("external_provider_refs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().notNull(),
	entityType: enums.externalProviderEntityType("entity_type").notNull(),
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
