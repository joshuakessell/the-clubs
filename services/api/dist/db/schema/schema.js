"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lateCheckoutEvents = exports.cleaningEvents = exports.cleaningBatchRooms = exports.cleaningBatches = exports.checkoutRequests = exports.registerSessions = exports.devices = exports.paymentIntents = exports.charges = exports.inventoryReservations = exports.checkinBlocks = exports.agreementSignatures = exports.agreements = exports.waitlist = exports.keyTags = exports.rooms = exports.lockers = exports.webauthnChallenges = exports.timeclockSessions = exports.timeOffRequests = exports.staffWebauthnCredentials = exports.employeeShifts = exports.staffSessions = exports.employeeDocuments = exports.staff = exports.schemaMigrations = exports.customers = exports.visits = exports.waitlistStatus = exports.timeOffRequestStatus = exports.staffRole = exports.shiftStatus = exports.roomType = exports.roomStatus = exports.rentalType = exports.paymentStatus = exports.orderStatus = exports.orderLineItemKind = exports.laneSessionStatus = exports.keyTagType = exports.inventoryResourceType = exports.inventoryReservationKind = exports.externalProviderEntityType = exports.checkoutRequestStatus = exports.cashDrawerSessionStatus = exports.cashDrawerEventType = exports.breakType = exports.breakStatus = exports.blockType = exports.auditAction = void 0;
exports.laneSessionCommands = exports.messages = exports.products = exports.clubEvents = exports.laneSessions = exports.schedulePatterns = exports.lateCheckoutBanAlerts = exports.shiftTemplates = exports.customerSpendLedgerEntries = exports.customerActivityEvents = exports.customerNotes = exports.offlineCommandOutbox = exports.laneFeatureFlags = exports.demoState = exports.externalProviderRefs = exports.receipts = exports.orderLineItems = exports.orders = exports.staffBreakSessions = exports.cashDrawerEvents = exports.cashDrawerSessions = exports.auditLog = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.auditAction = (0, pg_core_1.pgEnum)("audit_action", ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'ASSIGN', 'RELEASE', 'OVERRIDE', 'CHECK_IN', 'CHECK_OUT', 'UPGRADE_DISCLAIMER', 'STAFF_WEBAUTHN_ENROLLED', 'STAFF_LOGIN_WEBAUTHN', 'STAFF_LOGIN_PIN', 'STAFF_LOGOUT', 'STAFF_WEBAUTHN_REVOKED', 'STAFF_PIN_RESET', 'STAFF_REAUTH_REQUIRED', 'STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_ACTIVATED', 'STAFF_DEACTIVATED', 'REGISTER_SIGN_IN', 'REGISTER_SIGN_OUT', 'REGISTER_FORCE_SIGN_OUT', 'WAITLIST_CREATED', 'WAITLIST_CANCELLED', 'WAITLIST_OFFERED', 'WAITLIST_COMPLETED', 'UPGRADE_STARTED', 'UPGRADE_PAID', 'UPGRADE_COMPLETED', 'FINAL_EXTENSION_STARTED', 'FINAL_EXTENSION_PAID', 'FINAL_EXTENSION_COMPLETED', 'STAFF_REAUTH_PIN', 'STAFF_REAUTH_WEBAUTHN', 'ROOM_STATUS_CHANGE', 'SHIFT_UPDATED', 'TIMECLOCK_ADJUSTED', 'TIMECLOCK_CLOSED', 'DOCUMENT_UPLOADED', 'TIME_OFF_REQUESTED', 'TIME_OFF_APPROVED', 'TIME_OFF_DENIED', 'SHIFT_CREATED', 'SHIFT_CANCELED']);
exports.blockType = (0, pg_core_1.pgEnum)("block_type", ['INITIAL', 'RENEWAL', 'FINAL2H']);
exports.breakStatus = (0, pg_core_1.pgEnum)("break_status", ['OPEN', 'CLOSED']);
exports.breakType = (0, pg_core_1.pgEnum)("break_type", ['MEAL', 'REST', 'OTHER']);
exports.cashDrawerEventType = (0, pg_core_1.pgEnum)("cash_drawer_event_type", ['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT']);
exports.cashDrawerSessionStatus = (0, pg_core_1.pgEnum)("cash_drawer_session_status", ['OPEN', 'CLOSED']);
exports.checkoutRequestStatus = (0, pg_core_1.pgEnum)("checkout_request_status", ['SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED']);
exports.externalProviderEntityType = (0, pg_core_1.pgEnum)("external_provider_entity_type", ['customer', 'payment', 'refund', 'order', 'shift', 'timeclock_session', 'cash_event', 'receipt']);
exports.inventoryReservationKind = (0, pg_core_1.pgEnum)("inventory_reservation_kind", ['LANE_SELECTION', 'UPGRADE_HOLD']);
exports.inventoryResourceType = (0, pg_core_1.pgEnum)("inventory_resource_type", ['room', 'locker']);
exports.keyTagType = (0, pg_core_1.pgEnum)("key_tag_type", ['QR', 'NFC']);
exports.laneSessionStatus = (0, pg_core_1.pgEnum)("lane_session_status", ['IDLE', 'ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE', 'COMPLETED', 'CANCELLED']);
exports.orderLineItemKind = (0, pg_core_1.pgEnum)("order_line_item_kind", ['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']);
exports.orderStatus = (0, pg_core_1.pgEnum)("order_status", ['OPEN', 'PAID', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
exports.paymentStatus = (0, pg_core_1.pgEnum)("payment_status", ['DUE', 'PAID', 'CANCELLED', 'REFUNDED']);
exports.rentalType = (0, pg_core_1.pgEnum)("rental_type", ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL', 'GYM_LOCKER']);
exports.roomStatus = (0, pg_core_1.pgEnum)("room_status", ['DIRTY', 'CLEANING', 'CLEAN', 'OCCUPIED', 'OUT_OF_SERVICE']);
exports.roomType = (0, pg_core_1.pgEnum)("room_type", ['STANDARD', 'DELUXE', 'VIP', 'LOCKER', 'DOUBLE', 'SPECIAL']);
exports.shiftStatus = (0, pg_core_1.pgEnum)("shift_status", ['SCHEDULED', 'UPDATED', 'CANCELED']);
exports.staffRole = (0, pg_core_1.pgEnum)("staff_role", ['STAFF', 'ADMIN']);
exports.timeOffRequestStatus = (0, pg_core_1.pgEnum)("time_off_request_status", ['PENDING', 'APPROVED', 'DENIED']);
exports.waitlistStatus = (0, pg_core_1.pgEnum)("waitlist_status", ['ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
exports.visits = (0, pg_core_1.pgTable)("visits", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    startedAt: (0, pg_core_1.timestamp)("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    endedAt: (0, pg_core_1.timestamp)("ended_at", { withTimezone: true, mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_visits_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "visits_customer_id_fkey"
    }).onDelete("restrict"),
]);
exports.customers = (0, pg_core_1.pgTable)("customers", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    name: (0, pg_core_1.varchar)({ length: 255 }).notNull(),
    dob: (0, pg_core_1.date)(),
    membershipNumber: (0, pg_core_1.varchar)("membership_number", { length: 50 }),
    membershipCardType: (0, pg_core_1.varchar)("membership_card_type", { length: 20 }),
    membershipValidUntil: (0, pg_core_1.date)("membership_valid_until"),
    bannedUntil: (0, pg_core_1.timestamp)("banned_until", { withTimezone: true, mode: 'string' }),
    idScanHash: (0, pg_core_1.varchar)("id_scan_hash", { length: 255 }),
    idScanValue: (0, pg_core_1.text)("id_scan_value"),
    primaryLanguage: (0, pg_core_1.text)("primary_language"),
    pastDueBalance: (0, pg_core_1.numeric)("past_due_balance", { precision: 10, scale: 2 }).default('0').notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    idExpirationDate: (0, pg_core_1.date)("id_expiration_date"),
    idNumber: (0, pg_core_1.text)("id_number"),
    idState: (0, pg_core_1.text)("id_state"),
    idType: (0, pg_core_1.text)("id_type"),
    idTypeOther: (0, pg_core_1.text)("id_type_other"),
}, (table) => [
    (0, pg_core_1.index)("customers_name_trgm_idx").using("gin", table.name.asc().nullsLast().op("gin_trgm_ops")),
    (0, pg_core_1.index)("idx_customers_banned").using("btree", table.bannedUntil.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(banned_until IS NOT NULL)`),
    (0, pg_core_1.index)("idx_customers_dob").using("btree", table.dob.asc().nullsLast().op("date_ops")).where((0, drizzle_orm_1.sql) `(dob IS NOT NULL)`),
    (0, pg_core_1.index)("idx_customers_id_hash").using("btree", table.idScanHash.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(id_scan_hash IS NOT NULL)`),
    (0, pg_core_1.index)("idx_customers_membership").using("btree", table.membershipNumber.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(membership_number IS NOT NULL)`),
    (0, pg_core_1.check)("customers_primary_language_check", (0, drizzle_orm_1.sql) `primary_language = ANY (ARRAY['EN'::text, 'ES'::text])`),
]);
exports.schemaMigrations = (0, pg_core_1.pgTable)("schema_migrations", {
    id: (0, pg_core_1.serial)().primaryKey().notNull(),
    name: (0, pg_core_1.varchar)({ length: 255 }).notNull(),
    executedAt: (0, pg_core_1.timestamp)("executed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    filename: (0, pg_core_1.text)(),
}, (table) => [
    (0, pg_core_1.unique)("schema_migrations_name_key").on(table.name),
]);
exports.staff = (0, pg_core_1.pgTable)("staff", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    name: (0, pg_core_1.varchar)({ length: 255 }).notNull(),
    role: (0, exports.staffRole)().default('STAFF').notNull(),
    qrTokenHash: (0, pg_core_1.varchar)("qr_token_hash", { length: 255 }),
    pinHash: (0, pg_core_1.varchar)("pin_hash", { length: 255 }),
    active: (0, pg_core_1.boolean)().default(true).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    forcePinChange: (0, pg_core_1.boolean)("force_pin_change").default(false).notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_staff_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(active = true)`),
    (0, pg_core_1.index)("idx_staff_qr_token_hash").using("btree", table.qrTokenHash.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(qr_token_hash IS NOT NULL)`),
    (0, pg_core_1.index)("idx_staff_role").using("btree", table.role.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.unique)("staff_qr_token_hash_key").on(table.qrTokenHash),
]);
exports.employeeDocuments = (0, pg_core_1.pgTable)("employee_documents", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    docType: (0, pg_core_1.text)("doc_type").notNull(),
    filename: (0, pg_core_1.text)().notNull(),
    mimeType: (0, pg_core_1.text)("mime_type").notNull(),
    storageKey: (0, pg_core_1.text)("storage_key").notNull(),
    uploadedBy: (0, pg_core_1.uuid)("uploaded_by").notNull(),
    uploadedAt: (0, pg_core_1.timestamp)("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    notes: (0, pg_core_1.text)(),
    sha256Hash: (0, pg_core_1.text)("sha256_hash"),
}, (table) => [
    (0, pg_core_1.index)("idx_employee_documents_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_employee_documents_type").using("btree", table.docType.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_employee_documents_uploaded_by").using("btree", table.uploadedBy.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "employee_documents_employee_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.uploadedBy],
        foreignColumns: [exports.staff.id],
        name: "employee_documents_uploaded_by_fkey"
    }).onDelete("restrict"),
    (0, pg_core_1.check)("employee_documents_doc_type_check", (0, drizzle_orm_1.sql) `doc_type = ANY (ARRAY['ID'::text, 'W4'::text, 'I9'::text, 'OFFER_LETTER'::text, 'NDA'::text, 'OTHER'::text])`),
]);
exports.staffSessions = (0, pg_core_1.pgTable)("staff_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id").notNull(),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }).notNull(),
    deviceType: (0, pg_core_1.varchar)("device_type", { length: 50 }).notNull(),
    sessionToken: (0, pg_core_1.varchar)("session_token", { length: 255 }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    revokedAt: (0, pg_core_1.timestamp)("revoked_at", { withTimezone: true, mode: 'string' }),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
    reauthOkUntil: (0, pg_core_1.timestamp)("reauth_ok_until", { withTimezone: true, mode: 'string' }),
}, (table) => [
    (0, pg_core_1.index)("idx_staff_sessions_active").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.revokedAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.index)("idx_staff_sessions_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops"), table.deviceType.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_staff_sessions_reauth_ok").using("btree", table.sessionToken.asc().nullsLast().op("timestamptz_ops"), table.reauthOkUntil.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `((revoked_at IS NULL) AND (reauth_ok_until IS NOT NULL))`),
    (0, pg_core_1.index)("idx_staff_sessions_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_staff_sessions_token").using("btree", table.sessionToken.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "staff_sessions_staff_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.unique)("staff_sessions_session_token_key").on(table.sessionToken),
]);
exports.employeeShifts = (0, pg_core_1.pgTable)("employee_shifts", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    startsAt: (0, pg_core_1.timestamp)("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: (0, pg_core_1.timestamp)("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
    shiftCode: (0, pg_core_1.text)("shift_code").notNull(),
    role: (0, pg_core_1.text)(),
    status: (0, exports.shiftStatus)().default('SCHEDULED').notNull(),
    notes: (0, pg_core_1.text)(),
    createdBy: (0, pg_core_1.uuid)("created_by"),
    updatedBy: (0, pg_core_1.uuid)("updated_by"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    color: (0, pg_core_1.text)().default('#3b82f6'),
    templateId: (0, pg_core_1.uuid)("template_id"),
    breakMinutes: (0, pg_core_1.integer)("break_minutes").default(0),
}, (table) => [
    (0, pg_core_1.index)("idx_employee_shifts_dates").using("btree", table.startsAt.asc().nullsLast().op("timestamptz_ops"), table.endsAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_employee_shifts_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_employee_shifts_shift_code").using("btree", table.shiftCode.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_employee_shifts_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdBy],
        foreignColumns: [exports.staff.id],
        name: "employee_shifts_created_by_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "employee_shifts_employee_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.updatedBy],
        foreignColumns: [exports.staff.id],
        name: "employee_shifts_updated_by_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.templateId],
        foreignColumns: [exports.shiftTemplates.id],
        name: "employee_shifts_template_id_fkey"
    }).onDelete("set null"),
]);
exports.staffWebauthnCredentials = (0, pg_core_1.pgTable)("staff_webauthn_credentials", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id").notNull(),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }).notNull(),
    credentialId: (0, pg_core_1.text)("credential_id").notNull(),
    publicKey: (0, pg_core_1.text)("public_key").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    signCount: (0, pg_core_1.bigint)("sign_count", { mode: "number" }).default(0).notNull(),
    transports: (0, pg_core_1.jsonb)().$type(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    lastUsedAt: (0, pg_core_1.timestamp)("last_used_at", { withTimezone: true, mode: 'string' }),
    revokedAt: (0, pg_core_1.timestamp)("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
    (0, pg_core_1.index)("idx_webauthn_credentials_active").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.revokedAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.index)("idx_webauthn_credentials_credential_id").using("btree", table.credentialId.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.index)("idx_webauthn_credentials_device_id").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.index)("idx_webauthn_credentials_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(revoked_at IS NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "staff_webauthn_credentials_staff_id_fkey"
    }).onDelete("cascade"),
]);
exports.timeOffRequests = (0, pg_core_1.pgTable)("time_off_requests", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    day: (0, pg_core_1.date)().notNull(),
    reason: (0, pg_core_1.text)(),
    status: (0, exports.timeOffRequestStatus)().default('PENDING').notNull(),
    decidedBy: (0, pg_core_1.uuid)("decided_by"),
    decidedAt: (0, pg_core_1.timestamp)("decided_at", { withTimezone: true, mode: 'string' }),
    decisionNotes: (0, pg_core_1.text)("decision_notes"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_time_off_requests_day").using("btree", table.day.asc().nullsLast().op("date_ops")),
    (0, pg_core_1.uniqueIndex)("idx_time_off_requests_employee_day").using("btree", table.employeeId.asc().nullsLast().op("date_ops"), table.day.asc().nullsLast().op("date_ops")),
    (0, pg_core_1.index)("idx_time_off_requests_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.decidedBy],
        foreignColumns: [exports.staff.id],
        name: "time_off_requests_decided_by_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "time_off_requests_employee_id_fkey"
    }).onDelete("cascade"),
]);
exports.timeclockSessions = (0, pg_core_1.pgTable)("timeclock_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    shiftId: (0, pg_core_1.uuid)("shift_id"),
    clockInAt: (0, pg_core_1.timestamp)("clock_in_at", { withTimezone: true, mode: 'string' }).notNull(),
    clockOutAt: (0, pg_core_1.timestamp)("clock_out_at", { withTimezone: true, mode: 'string' }),
    source: (0, pg_core_1.text)().notNull(),
    createdBy: (0, pg_core_1.uuid)("created_by"),
    notes: (0, pg_core_1.text)(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_timeclock_sessions_dates").using("btree", table.clockInAt.asc().nullsLast().op("timestamptz_ops"), table.clockOutAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_timeclock_sessions_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.uniqueIndex)("idx_timeclock_sessions_employee_open").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(clock_out_at IS NULL)`),
    (0, pg_core_1.index)("idx_timeclock_sessions_open").using("btree", table.clockOutAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(clock_out_at IS NULL)`),
    (0, pg_core_1.index)("idx_timeclock_sessions_shift").using("btree", table.shiftId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(shift_id IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdBy],
        foreignColumns: [exports.staff.id],
        name: "timeclock_sessions_created_by_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "timeclock_sessions_employee_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.shiftId],
        foreignColumns: [exports.employeeShifts.id],
        name: "timeclock_sessions_shift_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.check)("timeclock_sessions_source_check", (0, drizzle_orm_1.sql) `source = ANY (ARRAY['EMPLOYEE_REGISTER'::text, 'OFFICE_DASHBOARD'::text])`),
]);
exports.webauthnChallenges = (0, pg_core_1.pgTable)("webauthn_challenges", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    challenge: (0, pg_core_1.text)().notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id"),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }),
    type: (0, pg_core_1.varchar)({ length: 50 }).notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_webauthn_challenges_challenge").using("btree", table.challenge.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_webauthn_challenges_expires").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_webauthn_challenges_staff_device").using("btree", table.staffId.asc().nullsLast().op("text_ops"), table.deviceId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(expires_at IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "webauthn_challenges_staff_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.unique)("webauthn_challenges_challenge_key").on(table.challenge),
]);
exports.lockers = (0, pg_core_1.pgTable)("lockers", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    number: (0, pg_core_1.varchar)({ length: 20 }).notNull(),
    status: (0, exports.roomStatus)().default('CLEAN').notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    assignedToCustomerId: (0, pg_core_1.uuid)("assigned_to_customer_id"),
}, (table) => [
    (0, pg_core_1.index)("idx_lockers_assigned_customer").using("btree", table.assignedToCustomerId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(assigned_to_customer_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_lockers_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.assignedToCustomerId],
        foreignColumns: [exports.customers.id],
        name: "lockers_assigned_to_customer_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.unique)("lockers_number_key").on(table.number),
]);
exports.rooms = (0, pg_core_1.pgTable)("rooms", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    number: (0, pg_core_1.varchar)({ length: 20 }).notNull(),
    type: (0, exports.roomType)().default('STANDARD').notNull(),
    status: (0, exports.roomStatus)().default('CLEAN').notNull(),
    floor: (0, pg_core_1.integer)().default(1).notNull(),
    lastStatusChange: (0, pg_core_1.timestamp)("last_status_change", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    overrideFlag: (0, pg_core_1.boolean)("override_flag").default(false).notNull(),
    version: (0, pg_core_1.integer)().default(1).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    assignedToCustomerId: (0, pg_core_1.uuid)("assigned_to_customer_id"),
}, (table) => [
    (0, pg_core_1.index)("idx_rooms_assigned_customer").using("btree", table.assignedToCustomerId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(assigned_to_customer_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_rooms_floor").using("btree", table.floor.asc().nullsLast().op("int4_ops")),
    (0, pg_core_1.index)("idx_rooms_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_rooms_type").using("btree", table.type.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.assignedToCustomerId],
        foreignColumns: [exports.customers.id],
        name: "rooms_assigned_to_customer_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.unique)("rooms_number_key").on(table.number),
    (0, pg_core_1.check)("rooms_type_no_deprecated", (0, drizzle_orm_1.sql) `type <> ALL (ARRAY['DELUXE'::room_type, 'VIP'::room_type])`),
]);
exports.keyTags = (0, pg_core_1.pgTable)("key_tags", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    roomId: (0, pg_core_1.uuid)("room_id"),
    lockerId: (0, pg_core_1.uuid)("locker_id"),
    tagType: (0, exports.keyTagType)("tag_type").notNull(),
    tagCode: (0, pg_core_1.varchar)("tag_code", { length: 255 }).notNull(),
    isActive: (0, pg_core_1.boolean)("is_active").default(true).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_key_tags_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(is_active = true)`),
    (0, pg_core_1.index)("idx_key_tags_code").using("btree", table.tagCode.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_key_tags_room").using("btree", table.roomId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.lockerId],
        foreignColumns: [exports.lockers.id],
        name: "key_tags_locker_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.roomId],
        foreignColumns: [exports.rooms.id],
        name: "key_tags_room_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.unique)("key_tags_tag_code_key").on(table.tagCode),
    (0, pg_core_1.check)("key_tags_exactly_one_target_chk", (0, drizzle_orm_1.sql) `(
CASE
    WHEN (room_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (locker_id IS NULL) THEN 0
    ELSE 1
END) = 1`),
]);
exports.waitlist = (0, pg_core_1.pgTable)("waitlist", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    visitId: (0, pg_core_1.uuid)("visit_id").notNull(),
    checkinBlockId: (0, pg_core_1.uuid)("checkin_block_id").notNull(),
    desiredTier: (0, exports.rentalType)("desired_tier").notNull(),
    backupTier: (0, exports.rentalType)("backup_tier").notNull(),
    lockerOrRoomAssignedInitially: (0, pg_core_1.uuid)("locker_or_room_assigned_initially"),
    roomId: (0, pg_core_1.uuid)("room_id"),
    status: (0, exports.waitlistStatus)().default('ACTIVE').notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    offeredAt: (0, pg_core_1.timestamp)("offered_at", { withTimezone: true, mode: 'string' }),
    offerExpiresAt: (0, pg_core_1.timestamp)("offer_expires_at", { withTimezone: true, mode: 'string' }),
    lastOfferedAt: (0, pg_core_1.timestamp)("last_offered_at", { withTimezone: true, mode: 'string' }),
    offerAttempts: (0, pg_core_1.integer)("offer_attempts").default(0).notNull(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true, mode: 'string' }),
    cancelledAt: (0, pg_core_1.timestamp)("cancelled_at", { withTimezone: true, mode: 'string' }),
    cancelledByStaffId: (0, pg_core_1.uuid)("cancelled_by_staff_id"),
    desiredTiers: (0, exports.rentalType)("desired_tiers").array().default((0, drizzle_orm_1.sql) `'{}'::rental_type[]`).notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_waitlist_active").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(status = 'ACTIVE'::waitlist_status)`),
    (0, pg_core_1.index)("idx_waitlist_block").using("btree", table.checkinBlockId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_waitlist_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_waitlist_desired_tier").using("btree", table.desiredTier.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_waitlist_desired_tiers").using("gin", table.desiredTiers.asc().nullsLast().op("array_ops")),
    (0, pg_core_1.index)("idx_waitlist_offered").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.createdAt.asc().nullsLast().op("enum_ops")).where((0, drizzle_orm_1.sql) `(status = 'OFFERED'::waitlist_status)`),
    (0, pg_core_1.index)("idx_waitlist_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_waitlist_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.cancelledByStaffId],
        foreignColumns: [exports.staff.id],
        name: "waitlist_cancelled_by_staff_id_fkey"
    }).onDelete("set null"),
    // FK: checkinBlockId → checkin_blocks.id (defined at DB level, omitted to avoid circular TS ref)
    (0, pg_core_1.foreignKey)({
        columns: [table.roomId],
        foreignColumns: [exports.rooms.id],
        name: "waitlist_room_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.visitId],
        foreignColumns: [exports.visits.id],
        name: "waitlist_visit_id_fkey"
    }).onDelete("cascade"),
]);
exports.agreements = (0, pg_core_1.pgTable)("agreements", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    version: (0, pg_core_1.varchar)({ length: 50 }).notNull(),
    title: (0, pg_core_1.varchar)({ length: 255 }).notNull(),
    bodyText: (0, pg_core_1.text)("body_text").default('').notNull(),
    active: (0, pg_core_1.boolean)().default(false).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_agreements_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(active = true)`),
]);
exports.agreementSignatures = (0, pg_core_1.pgTable)("agreement_signatures", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    agreementId: (0, pg_core_1.uuid)("agreement_id").notNull(),
    customerName: (0, pg_core_1.varchar)("customer_name", { length: 255 }).notNull(),
    membershipNumber: (0, pg_core_1.varchar)("membership_number", { length: 50 }),
    signedAt: (0, pg_core_1.timestamp)("signed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    signaturePngBase64: (0, pg_core_1.text)("signature_png_base64"),
    signatureStrokesJson: (0, pg_core_1.jsonb)("signature_strokes_json"),
    agreementTextSnapshot: (0, pg_core_1.text)("agreement_text_snapshot").notNull(),
    agreementVersion: (0, pg_core_1.varchar)("agreement_version", { length: 50 }).notNull(),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }),
    deviceType: (0, pg_core_1.varchar)("device_type", { length: 50 }),
    userAgent: (0, pg_core_1.text)("user_agent"),
    ipAddress: (0, pg_core_1.inet)("ip_address"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    checkinBlockId: (0, pg_core_1.uuid)("checkin_block_id"),
}, (table) => [
    (0, pg_core_1.index)("idx_agreement_signatures_agreement").using("btree", table.agreementId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_agreement_signatures_checkin_block").using("btree", table.checkinBlockId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(checkin_block_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_agreement_signatures_signed_at").using("btree", table.signedAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.agreementId],
        foreignColumns: [exports.agreements.id],
        name: "agreement_signatures_agreement_id_fkey"
    }).onDelete("restrict"),
    (0, pg_core_1.foreignKey)({
        columns: [table.checkinBlockId],
        foreignColumns: [exports.checkinBlocks.id],
        name: "agreement_signatures_checkin_block_id_fkey"
    }).onDelete("set null"),
]);
exports.checkinBlocks = (0, pg_core_1.pgTable)("checkin_blocks", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    visitId: (0, pg_core_1.uuid)("visit_id").notNull(),
    blockType: (0, exports.blockType)("block_type").notNull(),
    startsAt: (0, pg_core_1.timestamp)("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: (0, pg_core_1.timestamp)("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
    roomId: (0, pg_core_1.uuid)("room_id"),
    lockerId: (0, pg_core_1.uuid)("locker_id"),
    sessionId: (0, pg_core_1.uuid)("session_id"),
    agreementSigned: (0, pg_core_1.boolean)("agreement_signed").default(false).notNull(),
    agreementPdf: (0, pg_core_1.customType)({
        dataType() { return 'bytea'; },
    })("agreement_pdf"),
    agreementSignedAt: (0, pg_core_1.timestamp)("agreement_signed_at", { withTimezone: true, mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    hasTvRemote: (0, pg_core_1.boolean)("has_tv_remote").default(false).notNull(),
    waitlistId: (0, pg_core_1.uuid)("waitlist_id"),
    rentalType: (0, exports.rentalType)("rental_type").notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_checkin_blocks_ends_at").using("btree", table.endsAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(ends_at IS NOT NULL)`),
    (0, pg_core_1.index)("idx_checkin_blocks_session").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(session_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_checkin_blocks_tv_remote").using("btree", table.hasTvRemote.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(has_tv_remote = true)`),
    (0, pg_core_1.index)("idx_checkin_blocks_type").using("btree", table.blockType.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_checkin_blocks_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_checkin_blocks_waitlist").using("btree", table.waitlistId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(waitlist_id IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.lockerId],
        foreignColumns: [exports.lockers.id],
        name: "checkin_blocks_locker_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.roomId],
        foreignColumns: [exports.rooms.id],
        name: "checkin_blocks_room_id_fkey"
    }).onDelete("set null"),
    // FK: sessionId → lane_sessions.id (defined at DB level, omitted to avoid circular TS ref)
    (0, pg_core_1.foreignKey)({
        columns: [table.visitId],
        foreignColumns: [exports.visits.id],
        name: "checkin_blocks_visit_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.waitlistId],
        foreignColumns: [exports.waitlist.id],
        name: "checkin_blocks_waitlist_id_fkey"
    }).onDelete("set null"),
]);
exports.inventoryReservations = (0, pg_core_1.pgTable)("inventory_reservations", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    resourceType: (0, exports.inventoryResourceType)("resource_type").notNull(),
    resourceId: (0, pg_core_1.uuid)("resource_id").notNull(),
    kind: (0, exports.inventoryReservationKind)().notNull(),
    laneSessionId: (0, pg_core_1.uuid)("lane_session_id"),
    waitlistId: (0, pg_core_1.uuid)("waitlist_id"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at", { withTimezone: true, mode: 'string' }),
    releasedAt: (0, pg_core_1.timestamp)("released_at", { withTimezone: true, mode: 'string' }),
    releaseReason: (0, pg_core_1.text)("release_reason"),
}, (table) => [
    (0, pg_core_1.index)("idx_inventory_reservations_active_expires_at").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(released_at IS NULL)`),
    (0, pg_core_1.index)("idx_inventory_reservations_waitlist_active").using("btree", table.waitlistId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(released_at IS NULL)`),
    (0, pg_core_1.uniqueIndex)("uniq_inventory_reservations_active_resource").using("btree", table.resourceType.asc().nullsLast().op("uuid_ops"), table.resourceId.asc().nullsLast().op("enum_ops")).where((0, drizzle_orm_1.sql) `(released_at IS NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.laneSessionId],
        foreignColumns: [exports.laneSessions.id],
        name: "inventory_reservations_lane_session_fk"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.waitlistId],
        foreignColumns: [exports.waitlist.id],
        name: "inventory_reservations_waitlist_fk"
    }).onDelete("cascade"),
    (0, pg_core_1.check)("inventory_reservations_lane_session_required", (0, drizzle_orm_1.sql) `(kind <> 'LANE_SELECTION'::inventory_reservation_kind) OR (lane_session_id IS NOT NULL)`),
    (0, pg_core_1.check)("inventory_reservations_waitlist_required", (0, drizzle_orm_1.sql) `(kind <> 'UPGRADE_HOLD'::inventory_reservation_kind) OR (waitlist_id IS NOT NULL)`),
]);
exports.charges = (0, pg_core_1.pgTable)("charges", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    visitId: (0, pg_core_1.uuid)("visit_id").notNull(),
    checkinBlockId: (0, pg_core_1.uuid)("checkin_block_id"),
    type: (0, pg_core_1.varchar)({ length: 50 }).notNull(),
    amount: (0, pg_core_1.numeric)({ precision: 10, scale: 2 }).notNull(),
    paymentIntentId: (0, pg_core_1.uuid)("payment_intent_id"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_charges_block").using("btree", table.checkinBlockId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(checkin_block_id IS NOT NULL)`),
    (0, pg_core_1.uniqueIndex)("idx_charges_payment_intent").using("btree", table.paymentIntentId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(payment_intent_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_charges_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.checkinBlockId],
        foreignColumns: [exports.checkinBlocks.id],
        name: "charges_checkin_block_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.paymentIntentId],
        foreignColumns: [exports.paymentIntents.id],
        name: "charges_payment_intent_id_fkey"
    }),
    (0, pg_core_1.foreignKey)({
        columns: [table.visitId],
        foreignColumns: [exports.visits.id],
        name: "charges_visit_id_fkey"
    }).onDelete("cascade"),
]);
exports.paymentIntents = (0, pg_core_1.pgTable)("payment_intents", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    laneSessionId: (0, pg_core_1.uuid)("lane_session_id"),
    amount: (0, pg_core_1.numeric)({ precision: 10, scale: 2 }).notNull(),
    tip: (0, pg_core_1.integer)("tip").default(0).notNull(),
    status: (0, exports.paymentStatus)().default('DUE').notNull(),
    quoteJson: (0, pg_core_1.jsonb)("quote_json").$type().notNull(),
    squareTransactionId: (0, pg_core_1.varchar)("square_transaction_id", { length: 255 }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    paidAt: (0, pg_core_1.timestamp)("paid_at", { withTimezone: true, mode: 'string' }),
    paidByStaffId: (0, pg_core_1.uuid)("paid_by_staff_id"),
    paymentMethod: (0, pg_core_1.text)("payment_method"),
    failureReason: (0, pg_core_1.text)("failure_reason"),
    failureAt: (0, pg_core_1.timestamp)("failure_at", { withTimezone: true, mode: 'string' }),
    registerNumber: (0, pg_core_1.integer)("register_number"),
}, (table) => [
    (0, pg_core_1.index)("idx_payment_intents_due").using("btree", table.status.asc().nullsLast().op("enum_ops")).where((0, drizzle_orm_1.sql) `(status = 'DUE'::payment_status)`),
    (0, pg_core_1.index)("idx_payment_intents_lane_session").using("btree", table.laneSessionId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_payment_intents_paid_by_staff").using("btree", table.paidByStaffId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(paid_by_staff_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_payment_intents_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    // FK: laneSessionId → lane_sessions.id (defined at DB level, omitted to avoid circular TS ref)
    (0, pg_core_1.foreignKey)({
        columns: [table.paidByStaffId],
        foreignColumns: [exports.staff.id],
        name: "payment_intents_paid_by_staff_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.check)("payment_intents_payment_method_check", (0, drizzle_orm_1.sql) `payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text])`),
]);
exports.devices = (0, pg_core_1.pgTable)("devices", {
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }).primaryKey().notNull(),
    displayName: (0, pg_core_1.varchar)("display_name", { length: 255 }).notNull(),
    enabled: (0, pg_core_1.boolean)().default(true).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    lastHeartbeat: (0, pg_core_1.timestamp)("last_heartbeat", { withTimezone: true, mode: 'string' }),
    lastLaneId: (0, pg_core_1.varchar)("last_lane_id", { length: 50 }),
}, (table) => [
    (0, pg_core_1.index)("idx_devices_enabled").using("btree", table.enabled.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(enabled = true)`),
]);
exports.registerSessions = (0, pg_core_1.pgTable)("register_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }).notNull(),
    registerNumber: (0, pg_core_1.integer)("register_number").notNull(),
    lastHeartbeat: (0, pg_core_1.timestamp)("last_heartbeat", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    signedOutAt: (0, pg_core_1.timestamp)("signed_out_at", { withTimezone: true, mode: 'string' }),
    closeoutSummaryJson: (0, pg_core_1.jsonb)("closeout_summary_json"),
    lastActivityAt: (0, pg_core_1.timestamp)("last_activity_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_register_sessions_activity").using("btree", table.lastActivityAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(signed_out_at IS NULL)`),
    (0, pg_core_1.index)("idx_register_sessions_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.uniqueIndex)("idx_register_sessions_device_active").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(signed_out_at IS NULL)`),
    (0, pg_core_1.index)("idx_register_sessions_employee").using("btree", table.employeeId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_register_sessions_heartbeat").using("btree", table.lastHeartbeat.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(signed_out_at IS NULL)`),
    (0, pg_core_1.uniqueIndex)("idx_register_sessions_register_active").using("btree", table.registerNumber.asc().nullsLast().op("int4_ops")).where((0, drizzle_orm_1.sql) `(signed_out_at IS NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "register_sessions_employee_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.check)("register_sessions_register_number_check", (0, drizzle_orm_1.sql) `register_number = ANY (ARRAY[1, 2, 3])`),
]);
exports.checkoutRequests = (0, pg_core_1.pgTable)("checkout_requests", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    occupancyId: (0, pg_core_1.uuid)("occupancy_id").notNull(),
    keyTagId: (0, pg_core_1.uuid)("key_tag_id"),
    kioskDeviceId: (0, pg_core_1.varchar)("kiosk_device_id", { length: 255 }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    claimedByStaffId: (0, pg_core_1.uuid)("claimed_by_staff_id"),
    claimedAt: (0, pg_core_1.timestamp)("claimed_at", { withTimezone: true, mode: 'string' }),
    claimExpiresAt: (0, pg_core_1.timestamp)("claim_expires_at", { withTimezone: true, mode: 'string' }),
    customerChecklistJson: (0, pg_core_1.jsonb)("customer_checklist_json").notNull(),
    lateMinutes: (0, pg_core_1.integer)("late_minutes").default(0).notNull(),
    lateFeeAmount: (0, pg_core_1.numeric)("late_fee_amount", { precision: 10, scale: 2 }).default('0').notNull(),
    banApplied: (0, pg_core_1.boolean)("ban_applied").default(false).notNull(),
    itemsConfirmed: (0, pg_core_1.boolean)("items_confirmed").default(false).notNull(),
    feePaid: (0, pg_core_1.boolean)("fee_paid").default(false).notNull(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true, mode: 'string' }),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
    status: (0, exports.checkoutRequestStatus)().default('SUBMITTED'),
}, (table) => [
    (0, pg_core_1.index)("idx_checkout_requests_claim_expires").using("btree", table.claimExpiresAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(claim_expires_at IS NOT NULL)`),
    (0, pg_core_1.index)("idx_checkout_requests_claimed").using("btree", table.claimedByStaffId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(claimed_by_staff_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_checkout_requests_kiosk").using("btree", table.kioskDeviceId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_checkout_requests_occupancy").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.claimedByStaffId],
        foreignColumns: [exports.staff.id],
        name: "checkout_requests_claimed_by_staff_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "checkout_requests_customer_id_fkey"
    }).onDelete("restrict"),
    (0, pg_core_1.foreignKey)({
        columns: [table.keyTagId],
        foreignColumns: [exports.keyTags.id],
        name: "checkout_requests_key_tag_id_fkey"
    }).onDelete("set null"),
]);
exports.cleaningBatches = (0, pg_core_1.pgTable)("cleaning_batches", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    staffId: (0, pg_core_1.varchar)("staff_id", { length: 255 }).notNull(),
    startedAt: (0, pg_core_1.timestamp)("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true, mode: 'string' }),
    roomCount: (0, pg_core_1.integer)("room_count").default(0).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_cleaning_batches_incomplete").using("btree", table.completedAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(completed_at IS NULL)`),
    (0, pg_core_1.index)("idx_cleaning_batches_staff").using("btree", table.staffId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_cleaning_batches_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
]);
exports.cleaningBatchRooms = (0, pg_core_1.pgTable)("cleaning_batch_rooms", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    batchId: (0, pg_core_1.uuid)("batch_id").notNull(),
    roomId: (0, pg_core_1.uuid)("room_id").notNull(),
    statusFrom: (0, exports.roomStatus)("status_from").notNull(),
    statusTo: (0, exports.roomStatus)("status_to").notNull(),
    transitionTime: (0, pg_core_1.timestamp)("transition_time", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    overrideFlag: (0, pg_core_1.boolean)("override_flag").default(false).notNull(),
    overrideReason: (0, pg_core_1.text)("override_reason"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_cleaning_batch_rooms_batch").using("btree", table.batchId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cleaning_batch_rooms_room").using("btree", table.roomId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cleaning_batch_rooms_transition").using("btree", table.transitionTime.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.batchId],
        foreignColumns: [exports.cleaningBatches.id],
        name: "cleaning_batch_rooms_batch_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.roomId],
        foreignColumns: [exports.rooms.id],
        name: "cleaning_batch_rooms_room_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.unique)("cleaning_batch_rooms_batch_id_room_id_key").on(table.batchId, table.roomId),
]);
exports.cleaningEvents = (0, pg_core_1.pgTable)("cleaning_events", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    roomId: (0, pg_core_1.uuid)("room_id").notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id").notNull(),
    startedAt: (0, pg_core_1.timestamp)("started_at", { withTimezone: true, mode: 'string' }),
    completedAt: (0, pg_core_1.timestamp)("completed_at", { withTimezone: true, mode: 'string' }),
    fromStatus: (0, exports.roomStatus)("from_status").notNull(),
    toStatus: (0, exports.roomStatus)("to_status").notNull(),
    overrideFlag: (0, pg_core_1.boolean)("override_flag").default(false).notNull(),
    overrideReason: (0, pg_core_1.text)("override_reason"),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 255 }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_cleaning_events_completed").using("btree", table.completedAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_cleaning_events_device").using("btree", table.deviceId.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(device_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_cleaning_events_override").using("btree", table.overrideFlag.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(override_flag = true)`),
    (0, pg_core_1.index)("idx_cleaning_events_room").using("btree", table.roomId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cleaning_events_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cleaning_events_started").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.roomId],
        foreignColumns: [exports.rooms.id],
        name: "cleaning_events_room_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "cleaning_events_staff_id_fkey"
    }).onDelete("restrict"),
]);
exports.lateCheckoutEvents = (0, pg_core_1.pgTable)("late_checkout_events", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    occupancyId: (0, pg_core_1.uuid)("occupancy_id").notNull(),
    checkoutRequestId: (0, pg_core_1.uuid)("checkout_request_id"),
    lateMinutes: (0, pg_core_1.integer)("late_minutes").notNull(),
    feeAmount: (0, pg_core_1.numeric)("fee_amount", { precision: 10, scale: 2 }).notNull(),
    banApplied: (0, pg_core_1.boolean)("ban_applied").default(false).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_late_checkout_events_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_late_checkout_events_occupancy").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_late_checkout_events_request").using("btree", table.checkoutRequestId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(checkout_request_id IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.checkoutRequestId],
        foreignColumns: [exports.checkoutRequests.id],
        name: "late_checkout_events_checkout_request_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "late_checkout_events_customer_id_fkey"
    }).onDelete("restrict"),
]);
exports.auditLog = (0, pg_core_1.pgTable)("audit_log", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    userId: (0, pg_core_1.varchar)("user_id", { length: 255 }),
    userRole: (0, pg_core_1.varchar)("user_role", { length: 50 }),
    action: (0, exports.auditAction)().notNull(),
    entityType: (0, pg_core_1.varchar)("entity_type", { length: 50 }).notNull(),
    entityId: (0, pg_core_1.uuid)("entity_id").notNull(),
    oldValue: (0, pg_core_1.jsonb)("old_value").$type(),
    newValue: (0, pg_core_1.jsonb)("new_value").$type(),
    overrideReason: (0, pg_core_1.text)("override_reason"),
    ipAddress: (0, pg_core_1.inet)("ip_address"),
    userAgent: (0, pg_core_1.text)("user_agent"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id"),
    metadata: (0, pg_core_1.jsonb)().$type(),
}, (table) => [
    (0, pg_core_1.index)("idx_audit_log_action").using("btree", table.action.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_audit_log_created").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_audit_log_entity").using("btree", table.entityType.asc().nullsLast().op("uuid_ops"), table.entityId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_audit_log_overrides").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(action = 'OVERRIDE'::audit_action)`),
    (0, pg_core_1.index)("idx_audit_log_staff_id").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_audit_log_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "audit_log_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.cashDrawerSessions = (0, pg_core_1.pgTable)("cash_drawer_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    registerSessionId: (0, pg_core_1.uuid)("register_session_id").notNull(),
    openedByStaffId: (0, pg_core_1.uuid)("opened_by_staff_id").notNull(),
    openedAt: (0, pg_core_1.timestamp)("opened_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    openingFloat: (0, pg_core_1.integer)("opening_float").notNull(),
    closedByStaffId: (0, pg_core_1.uuid)("closed_by_staff_id"),
    closedAt: (0, pg_core_1.timestamp)("closed_at", { withTimezone: true, mode: 'string' }),
    countedCash: (0, pg_core_1.integer)("counted_cash"),
    expectedCash: (0, pg_core_1.integer)("expected_cash"),
    overShort: (0, pg_core_1.integer)("over_short"),
    notes: (0, pg_core_1.text)(),
    status: (0, exports.cashDrawerSessionStatus)().default('OPEN').notNull(),
    closeoutSnapshotJson: (0, pg_core_1.jsonb)("closeout_snapshot_json").$type(),
}, (table) => [
    (0, pg_core_1.index)("idx_cash_drawer_sessions_opened_by").using("btree", table.openedByStaffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cash_drawer_sessions_register_session").using("btree", table.registerSessionId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cash_drawer_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.registerSessionId],
        foreignColumns: [exports.registerSessions.id],
        name: "cash_drawer_sessions_register_session_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.openedByStaffId],
        foreignColumns: [exports.staff.id],
        name: "cash_drawer_sessions_opened_by_staff_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.closedByStaffId],
        foreignColumns: [exports.staff.id],
        name: "cash_drawer_sessions_closed_by_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.cashDrawerEvents = (0, pg_core_1.pgTable)("cash_drawer_events", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    cashDrawerSessionId: (0, pg_core_1.uuid)("cash_drawer_session_id").notNull(),
    occurredAt: (0, pg_core_1.timestamp)("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    type: (0, exports.cashDrawerEventType)().notNull(),
    amount: (0, pg_core_1.integer)("amount"),
    reason: (0, pg_core_1.text)(),
    createdByStaffId: (0, pg_core_1.uuid)("created_by_staff_id").notNull(),
    metadataJson: (0, pg_core_1.jsonb)("metadata_json").$type(),
}, (table) => [
    (0, pg_core_1.index)("idx_cash_drawer_events_created_by").using("btree", table.createdByStaffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_cash_drawer_events_occurred_at").using("btree", table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_cash_drawer_events_session").using("btree", table.cashDrawerSessionId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.cashDrawerSessionId],
        foreignColumns: [exports.cashDrawerSessions.id],
        name: "cash_drawer_events_cash_drawer_session_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdByStaffId],
        foreignColumns: [exports.staff.id],
        name: "cash_drawer_events_created_by_staff_id_fkey"
    }).onDelete("cascade"),
]);
exports.staffBreakSessions = (0, pg_core_1.pgTable)("staff_break_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id").notNull(),
    timeclockSessionId: (0, pg_core_1.uuid)("timeclock_session_id").notNull(),
    startedAt: (0, pg_core_1.timestamp)("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    endedAt: (0, pg_core_1.timestamp)("ended_at", { withTimezone: true, mode: 'string' }),
    breakType: (0, exports.breakType)("break_type").notNull(),
    status: (0, exports.breakStatus)().default('OPEN').notNull(),
    notes: (0, pg_core_1.text)(),
}, (table) => [
    (0, pg_core_1.index)("idx_staff_break_sessions_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_staff_break_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.index)("idx_staff_break_sessions_timeclock").using("btree", table.timeclockSessionId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "staff_break_sessions_staff_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.timeclockSessionId],
        foreignColumns: [exports.timeclockSessions.id],
        name: "staff_break_sessions_timeclock_session_id_fkey"
    }).onDelete("cascade"),
]);
exports.orders = (0, pg_core_1.pgTable)("orders", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id"),
    registerSessionId: (0, pg_core_1.uuid)("register_session_id"),
    createdByStaffId: (0, pg_core_1.uuid)("created_by_staff_id"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    status: (0, exports.orderStatus)().default('OPEN').notNull(),
    subtotal: (0, pg_core_1.integer)("subtotal").notNull(),
    discount: (0, pg_core_1.integer)("discount").notNull(),
    tax: (0, pg_core_1.integer)("tax").notNull(),
    tip: (0, pg_core_1.integer)("tip").default(0).notNull(),
    total: (0, pg_core_1.integer)("total").notNull(),
    currency: (0, pg_core_1.varchar)({ length: 3 }).default('USD').notNull(),
    metadataJson: (0, pg_core_1.jsonb)("metadata_json"),
}, (table) => [
    (0, pg_core_1.index)("idx_orders_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_orders_created_by").using("btree", table.createdByStaffId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(created_by_staff_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_orders_customer").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(customer_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_orders_register_session").using("btree", table.registerSessionId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(register_session_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_orders_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "orders_customer_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.registerSessionId],
        foreignColumns: [exports.registerSessions.id],
        name: "orders_register_session_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdByStaffId],
        foreignColumns: [exports.staff.id],
        name: "orders_created_by_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.orderLineItems = (0, pg_core_1.pgTable)("order_line_items", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    orderId: (0, pg_core_1.uuid)("order_id").notNull(),
    kind: (0, exports.orderLineItemKind)().notNull(),
    sku: (0, pg_core_1.text)(),
    name: (0, pg_core_1.text)().notNull(),
    quantity: (0, pg_core_1.integer)().notNull(),
    unitPrice: (0, pg_core_1.integer)("unit_price").notNull(),
    discount: (0, pg_core_1.integer)("discount").default(0).notNull(),
    tax: (0, pg_core_1.integer)("tax").default(0).notNull(),
    total: (0, pg_core_1.integer)("total").notNull(),
    metadataJson: (0, pg_core_1.jsonb)("metadata_json"),
}, (table) => [
    (0, pg_core_1.index)("idx_order_line_items_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.orderId],
        foreignColumns: [exports.orders.id],
        name: "order_line_items_order_id_fkey"
    }).onDelete("cascade"),
]);
exports.receipts = (0, pg_core_1.pgTable)("receipts", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    orderId: (0, pg_core_1.uuid)("order_id").notNull(),
    issuedAt: (0, pg_core_1.timestamp)("issued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    receiptNumber: (0, pg_core_1.text)("receipt_number").notNull(),
    receiptJson: (0, pg_core_1.jsonb)("receipt_json").notNull(),
    pdfStorageKey: (0, pg_core_1.text)("pdf_storage_key"),
    metadataJson: (0, pg_core_1.jsonb)("metadata_json"),
}, (table) => [
    (0, pg_core_1.index)("idx_receipts_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.orderId],
        foreignColumns: [exports.orders.id],
        name: "receipts_order_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.unique)("receipts_receipt_number_key").on(table.receiptNumber),
]);
exports.externalProviderRefs = (0, pg_core_1.pgTable)("external_provider_refs", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    provider: (0, pg_core_1.text)().notNull(),
    entityType: (0, exports.externalProviderEntityType)("entity_type").notNull(),
    internalId: (0, pg_core_1.uuid)("internal_id").notNull(),
    externalId: (0, pg_core_1.text)("external_id").notNull(),
    externalVersion: (0, pg_core_1.text)("external_version"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.unique)("external_provider_refs_provider_entity_type_internal_id_key").on(table.provider, table.entityType, table.internalId),
    (0, pg_core_1.unique)("external_provider_refs_provider_entity_type_external_id_key").on(table.provider, table.entityType, table.externalId),
]);
exports.demoState = (0, pg_core_1.pgTable)("demo_state", {
    key: (0, pg_core_1.text)().primaryKey().notNull(),
    valueJson: (0, pg_core_1.jsonb)("value_json").notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
exports.laneFeatureFlags = (0, pg_core_1.pgTable)("lane_feature_flags", {
    laneId: (0, pg_core_1.varchar)("lane_id", { length: 50 }).primaryKey().notNull(),
    lockstepV2Enabled: (0, pg_core_1.boolean)("lockstep_v2_enabled"),
    flowCommandsEnabled: (0, pg_core_1.boolean)("flow_commands_enabled"),
    lanFallbackEnabled: (0, pg_core_1.boolean)("lan_fallback_enabled"),
    lanAuthoritativeEnabled: (0, pg_core_1.boolean)("lan_authoritative_enabled"),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
exports.offlineCommandOutbox = (0, pg_core_1.pgTable)("offline_command_outbox", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    laneId: (0, pg_core_1.varchar)("lane_id", { length: 50 }).notNull(),
    sessionId: (0, pg_core_1.uuid)("session_id").notNull(),
    commandId: (0, pg_core_1.uuid)("command_id").notNull(),
    actor: (0, pg_core_1.varchar)({ length: 20 }).notNull(),
    type: (0, pg_core_1.varchar)({ length: 50 }).notNull(),
    payloadJson: (0, pg_core_1.jsonb)("payload_json"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    replayedAt: (0, pg_core_1.timestamp)("replayed_at", { withTimezone: true, mode: 'string' }),
    replayAttempts: (0, pg_core_1.integer)("replay_attempts").default(0).notNull(),
    lastReplayError: (0, pg_core_1.text)("last_replay_error"),
}, (table) => [
    (0, pg_core_1.index)("idx_offline_command_outbox_pending").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(replayed_at IS NULL)`),
    (0, pg_core_1.unique)("offline_command_outbox_session_command_unique").on(table.sessionId, table.commandId),
]);
exports.customerNotes = (0, pg_core_1.pgTable)("customer_notes", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    createdByStaffId: (0, pg_core_1.uuid)("created_by_staff_id"),
    createdByStaffName: (0, pg_core_1.text)("created_by_staff_name").notNull(),
    sourceApp: (0, pg_core_1.text)("source_app").notNull(),
    note: (0, pg_core_1.text)().notNull(),
    isImportant: (0, pg_core_1.boolean)("is_important").default(false).notNull(),
    deletedAt: (0, pg_core_1.timestamp)("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
    (0, pg_core_1.index)("idx_customer_notes_customer_created").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
    (0, pg_core_1.index)("idx_customer_notes_customer_important").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(is_important = true)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "customer_notes_customer_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdByStaffId],
        foreignColumns: [exports.staff.id],
        name: "customer_notes_created_by_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.customerActivityEvents = (0, pg_core_1.pgTable)("customer_activity_events", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    occurredAt: (0, pg_core_1.timestamp)("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
    actionType: (0, pg_core_1.text)("action_type").notNull(),
    actionCategory: (0, pg_core_1.text)("action_category").notNull(),
    sourceApp: (0, pg_core_1.text)("source_app").notNull(),
    actorType: (0, pg_core_1.text)("actor_type").notNull(),
    actorStaffId: (0, pg_core_1.uuid)("actor_staff_id"),
    actorStaffName: (0, pg_core_1.text)("actor_staff_name"),
    summary: (0, pg_core_1.text)().notNull(),
    metadata: (0, pg_core_1.jsonb)().default({}).notNull(),
    searchBlob: (0, pg_core_1.text)("search_blob").notNull(),
    dedupeKey: (0, pg_core_1.text)("dedupe_key"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_customer_activity_events_action_category").using("btree", table.actionCategory.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
    (0, pg_core_1.index)("idx_customer_activity_events_action_type").using("btree", table.actionType.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
    (0, pg_core_1.index)("idx_customer_activity_events_customer_occurred").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
    (0, pg_core_1.uniqueIndex)("idx_customer_activity_events_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(dedupe_key IS NOT NULL)`),
    (0, pg_core_1.index)("idx_customer_activity_events_occurred").using("btree", table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
    (0, pg_core_1.index)("idx_customer_activity_events_search_trgm").using("gin", table.searchBlob.asc().nullsLast().op("gin_trgm_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "customer_activity_events_customer_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.actorStaffId],
        foreignColumns: [exports.staff.id],
        name: "customer_activity_events_actor_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.customerSpendLedgerEntries = (0, pg_core_1.pgTable)("customer_spend_ledger_entries", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    occurredAt: (0, pg_core_1.timestamp)("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
    visitId: (0, pg_core_1.uuid)("visit_id"),
    entryType: (0, pg_core_1.text)("entry_type").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    amount: (0, pg_core_1.bigint)("amount", { mode: "number" }).notNull(),
    currency: (0, pg_core_1.text)().default('USD').notNull(),
    sourceApp: (0, pg_core_1.text)("source_app").notNull(),
    actorType: (0, pg_core_1.text)("actor_type").notNull(),
    actorStaffId: (0, pg_core_1.uuid)("actor_staff_id"),
    actorStaffName: (0, pg_core_1.text)("actor_staff_name"),
    summary: (0, pg_core_1.text)().notNull(),
    metadata: (0, pg_core_1.jsonb)().default({}).notNull(),
    dedupeKey: (0, pg_core_1.text)("dedupe_key"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_customer_spend_ledger_customer_occurred").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
    (0, pg_core_1.index)("idx_customer_spend_ledger_customer_visit_occurred").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.visitId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
    (0, pg_core_1.uniqueIndex)("idx_customer_spend_ledger_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(dedupe_key IS NOT NULL)`),
    (0, pg_core_1.index)("idx_customer_spend_ledger_entry_type").using("btree", table.entryType.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
    (0, pg_core_1.index)("idx_customer_spend_ledger_visit_occurred").using("btree", table.visitId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops"), table.id.desc().nullsFirst().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(visit_id IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "customer_spend_ledger_entries_customer_id_fkey"
    }).onDelete("restrict"),
    (0, pg_core_1.foreignKey)({
        columns: [table.visitId],
        foreignColumns: [exports.visits.id],
        name: "customer_spend_ledger_entries_visit_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.actorStaffId],
        foreignColumns: [exports.staff.id],
        name: "customer_spend_ledger_entries_actor_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.shiftTemplates = (0, pg_core_1.pgTable)("shift_templates", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    label: (0, pg_core_1.text)().notNull(),
    defaultStartTime: (0, pg_core_1.time)("default_start_time").notNull(),
    defaultEndTime: (0, pg_core_1.time)("default_end_time").notNull(),
    color: (0, pg_core_1.text)().default('#3b82f6').notNull(),
    createdBy: (0, pg_core_1.uuid)("created_by"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    active: (0, pg_core_1.boolean)().default(true).notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_shift_templates_active").using("btree", table.active.asc().nullsLast().op("bool_ops")).where((0, drizzle_orm_1.sql) `(active = true)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdBy],
        foreignColumns: [exports.staff.id],
        name: "shift_templates_created_by_fkey"
    }).onDelete("set null"),
]);
exports.lateCheckoutBanAlerts = (0, pg_core_1.pgTable)("late_checkout_ban_alerts", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    customerId: (0, pg_core_1.uuid)("customer_id").notNull(),
    checkoutRequestId: (0, pg_core_1.uuid)("checkout_request_id"),
    occupancyId: (0, pg_core_1.uuid)("occupancy_id").notNull(),
    visitId: (0, pg_core_1.uuid)("visit_id"),
    lateMinutes: (0, pg_core_1.integer)("late_minutes").notNull(),
    feeAmount: (0, pg_core_1.integer)("fee_amount").notNull(),
    recommendedBanDays: (0, pg_core_1.integer)("recommended_ban_days").default(30).notNull(),
    status: (0, pg_core_1.text)().default('PENDING').notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    createdByStaffId: (0, pg_core_1.uuid)("created_by_staff_id"),
    createdByStaffName: (0, pg_core_1.text)("created_by_staff_name"),
    decidedAt: (0, pg_core_1.timestamp)("decided_at", { withTimezone: true, mode: 'string' }),
    decidedByStaffId: (0, pg_core_1.uuid)("decided_by_staff_id"),
    decidedByStaffName: (0, pg_core_1.text)("decided_by_staff_name"),
    decision: (0, pg_core_1.text)(),
    banDays: (0, pg_core_1.integer)("ban_days"),
    managerNotes: (0, pg_core_1.text)("manager_notes"),
}, (table) => [
    (0, pg_core_1.index)("idx_late_checkout_ban_alerts_customer").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
    (0, pg_core_1.uniqueIndex)("idx_late_checkout_ban_alerts_occupancy_manual").using("btree", table.occupancyId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(checkout_request_id IS NULL)`),
    (0, pg_core_1.uniqueIndex)("idx_late_checkout_ban_alerts_request").using("btree", table.checkoutRequestId.asc().nullsLast().op("uuid_ops")),
    (0, pg_core_1.index)("idx_late_checkout_ban_alerts_status_created").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "late_checkout_ban_alerts_customer_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.checkoutRequestId],
        foreignColumns: [exports.checkoutRequests.id],
        name: "late_checkout_ban_alerts_checkout_request_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.occupancyId],
        foreignColumns: [exports.checkinBlocks.id],
        name: "late_checkout_ban_alerts_occupancy_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.visitId],
        foreignColumns: [exports.visits.id],
        name: "late_checkout_ban_alerts_visit_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdByStaffId],
        foreignColumns: [exports.staff.id],
        name: "late_checkout_ban_alerts_created_by_staff_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.decidedByStaffId],
        foreignColumns: [exports.staff.id],
        name: "late_checkout_ban_alerts_decided_by_staff_id_fkey"
    }).onDelete("set null"),
]);
exports.schedulePatterns = (0, pg_core_1.pgTable)("schedule_patterns", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    employeeId: (0, pg_core_1.uuid)("employee_id").notNull(),
    dayOfWeek: (0, pg_core_1.integer)("day_of_week").notNull(),
    templateId: (0, pg_core_1.uuid)("template_id").notNull(),
    active: (0, pg_core_1.boolean)().default(true).notNull(),
    createdBy: (0, pg_core_1.uuid)("created_by"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.uniqueIndex)("idx_schedule_patterns_employee_day").using("btree", table.employeeId.asc().nullsLast().op("int4_ops"), table.dayOfWeek.asc().nullsLast().op("int4_ops")).where((0, drizzle_orm_1.sql) `(active = true)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.employeeId],
        foreignColumns: [exports.staff.id],
        name: "schedule_patterns_employee_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.templateId],
        foreignColumns: [exports.shiftTemplates.id],
        name: "schedule_patterns_template_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.foreignKey)({
        columns: [table.createdBy],
        foreignColumns: [exports.staff.id],
        name: "schedule_patterns_created_by_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.check)("schedule_patterns_day_of_week_check", (0, drizzle_orm_1.sql) `(day_of_week >= 0) AND (day_of_week <= 6)`),
]);
exports.laneSessions = (0, pg_core_1.pgTable)("lane_sessions", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    laneId: (0, pg_core_1.varchar)("lane_id", { length: 50 }).notNull(),
    status: (0, exports.laneSessionStatus)().default('IDLE').notNull(),
    staffId: (0, pg_core_1.uuid)("staff_id"),
    customerDisplayName: (0, pg_core_1.varchar)("customer_display_name", { length: 255 }),
    membershipNumber: (0, pg_core_1.varchar)("membership_number", { length: 50 }),
    desiredRentalType: (0, exports.rentalType)("desired_rental_type"),
    waitlistDesiredType: (0, exports.rentalType)("waitlist_desired_type"),
    backupRentalType: (0, exports.rentalType)("backup_rental_type"),
    assignedResourceId: (0, pg_core_1.uuid)("assigned_resource_id"),
    assignedResourceType: (0, pg_core_1.varchar)("assigned_resource_type", { length: 20 }),
    priceQuoteJson: (0, pg_core_1.jsonb)("price_quote_json"),
    disclaimersAckJson: (0, pg_core_1.jsonb)("disclaimers_ack_json"),
    paymentIntentId: (0, pg_core_1.uuid)("payment_intent_id"),
    membershipPurchaseIntent: (0, pg_core_1.varchar)("membership_purchase_intent", { length: 20 }),
    membershipPurchaseRequestedAt: (0, pg_core_1.timestamp)("membership_purchase_requested_at", { withTimezone: true, mode: 'string' }),
    membershipChoice: (0, pg_core_1.varchar)("membership_choice", { length: 20 }),
    kioskAcknowledgedAt: (0, pg_core_1.timestamp)("kiosk_acknowledged_at", { withTimezone: true, mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    checkinMode: (0, pg_core_1.varchar)("checkin_mode", { length: 20 }).default('CHECKIN'),
    renewalHours: (0, pg_core_1.integer)("renewal_hours"),
    customerId: (0, pg_core_1.uuid)("customer_id"),
    proposedRentalType: (0, exports.rentalType)("proposed_rental_type"),
    proposedBy: (0, pg_core_1.varchar)("proposed_by", { length: 20 }),
    selectionConfirmed: (0, pg_core_1.boolean)("selection_confirmed").default(false),
    selectionConfirmedBy: (0, pg_core_1.varchar)("selection_confirmed_by", { length: 20 }),
    selectionLockedAt: (0, pg_core_1.timestamp)("selection_locked_at", { withTimezone: true, mode: 'string' }),
    waitlistDesiredTypesJson: (0, pg_core_1.jsonb)("waitlist_desired_types_json"),
    waitlistRequestedResourceNumber: (0, pg_core_1.varchar)("waitlist_requested_resource_number", { length: 20 }),
    waitlistRequestedResourceType: (0, pg_core_1.varchar)("waitlist_requested_resource_type", { length: 20 }),
    flowStep: (0, pg_core_1.varchar)("flow_step", { length: 50 }),
    flowVersion: (0, pg_core_1.integer)("flow_version").default(0).notNull(),
    flowLastCommandId: (0, pg_core_1.uuid)("flow_last_command_id"),
    flowLastActor: (0, pg_core_1.varchar)("flow_last_actor", { length: 20 }),
    agreementBypassPending: (0, pg_core_1.boolean)("agreement_bypass_pending").default(false).notNull(),
    agreementSignedMethod: (0, pg_core_1.varchar)("agreement_signed_method", { length: 16 }),
    pastDueBypassed: (0, pg_core_1.boolean)("past_due_bypassed").default(false).notNull(),
    pastDueBypassedByStaffId: (0, pg_core_1.uuid)("past_due_bypassed_by_staff_id"),
    pastDueBypassedAt: (0, pg_core_1.timestamp)("past_due_bypassed_at", { withTimezone: true, mode: 'string' }),
    lastPaymentDeclineReason: (0, pg_core_1.text)("last_payment_decline_reason"),
    lastPaymentDeclineAt: (0, pg_core_1.timestamp)("last_payment_decline_at", { withTimezone: true, mode: 'string' }),
    lastPastDueDeclineReason: (0, pg_core_1.text)("last_past_due_decline_reason"),
    lastPastDueDeclineAt: (0, pg_core_1.timestamp)("last_past_due_decline_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
    (0, pg_core_1.index)("idx_lane_sessions_checkin_mode").using("btree", table.checkinMode.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_lane_sessions_lane").using("btree", table.laneId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_lane_sessions_lane_active").using("btree", table.laneId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(status = ANY (ARRAY['ACTIVE'::lane_session_status, 'AWAITING_CUSTOMER'::lane_session_status, 'AWAITING_ASSIGNMENT'::lane_session_status, 'AWAITING_PAYMENT'::lane_session_status, 'AWAITING_SIGNATURE'::lane_session_status]))`),
    (0, pg_core_1.index)("idx_lane_sessions_selection_state").using("btree", table.proposedRentalType.asc().nullsLast().op("bool_ops"), table.selectionConfirmed.asc().nullsLast().op("enum_ops")).where((0, drizzle_orm_1.sql) `(proposed_rental_type IS NOT NULL)`),
    (0, pg_core_1.index)("idx_lane_sessions_staff").using("btree", table.staffId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(staff_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_lane_sessions_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.paymentIntentId],
        foreignColumns: [exports.paymentIntents.id],
        name: "fk_lane_sessions_payment_intent"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "lane_sessions_customer_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "lane_sessions_staff_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.pastDueBypassedByStaffId],
        foreignColumns: [exports.staff.id],
        name: "lane_sessions_past_due_bypassed_by_staff_id_fkey"
    }),
    (0, pg_core_1.check)("lane_sessions_membership_choice_check", (0, drizzle_orm_1.sql) `((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL)`),
    (0, pg_core_1.check)("lane_sessions_renewal_hours_check", (0, drizzle_orm_1.sql) `(renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL)`),
    (0, pg_core_1.check)("lane_sessions_proposed_by_check", (0, drizzle_orm_1.sql) `(proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
    (0, pg_core_1.check)("lane_sessions_selection_confirmed_by_check", (0, drizzle_orm_1.sql) `(selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])`),
    (0, pg_core_1.check)("lane_sessions_waitlist_requested_resource_type_check", (0, drizzle_orm_1.sql) `(waitlist_requested_resource_type IS NULL) OR ((waitlist_requested_resource_type)::text = ANY ((ARRAY['room'::character varying, 'locker'::character varying])::text[]))`),
    (0, pg_core_1.check)("lane_sessions_flow_last_actor_check", (0, drizzle_orm_1.sql) `(flow_last_actor IS NULL) OR ((flow_last_actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[]))`),
]);
exports.clubEvents = (0, pg_core_1.pgTable)("club_events", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    occurredAt: (0, pg_core_1.timestamp)("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    eventType: (0, pg_core_1.text)("event_type").notNull(),
    eventDomain: (0, pg_core_1.text)("event_domain").notNull(),
    sourceApp: (0, pg_core_1.text)("source_app").notNull(),
    registerId: (0, pg_core_1.text)("register_id"),
    staffId: (0, pg_core_1.uuid)("staff_id"),
    staffName: (0, pg_core_1.text)("staff_name"),
    customerId: (0, pg_core_1.uuid)("customer_id"),
    customerName: (0, pg_core_1.text)("customer_name"),
    visitId: (0, pg_core_1.uuid)("visit_id"),
    orderId: (0, pg_core_1.uuid)("order_id"),
    amount: (0, pg_core_1.integer)("amount"),
    currency: (0, pg_core_1.varchar)({ length: 3 }).default('USD'),
    summary: (0, pg_core_1.text)().notNull(),
    metadata: (0, pg_core_1.jsonb)().default({}).notNull(),
    searchBlob: (0, pg_core_1.text)("search_blob").notNull(),
    dedupeKey: (0, pg_core_1.text)("dedupe_key"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_club_events_amount").using("btree", table.amount.asc().nullsLast().op("int4_ops"), table.occurredAt.desc().nullsFirst().op("int4_ops")).where((0, drizzle_orm_1.sql) `(amount IS NOT NULL)`),
    (0, pg_core_1.index)("idx_club_events_customer").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")).where((0, drizzle_orm_1.sql) `(customer_id IS NOT NULL)`),
    (0, pg_core_1.uniqueIndex)("idx_club_events_dedupe").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(dedupe_key IS NOT NULL)`),
    (0, pg_core_1.index)("idx_club_events_domain").using("btree", table.eventDomain.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
    (0, pg_core_1.index)("idx_club_events_occurred").using("btree", table.occurredAt.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_club_events_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(order_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_club_events_register").using("btree", table.registerId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")).where((0, drizzle_orm_1.sql) `(register_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_club_events_search_trgm").using("gin", table.searchBlob.asc().nullsLast().op("gin_trgm_ops")),
    (0, pg_core_1.index)("idx_club_events_staff").using("btree", table.staffId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(staff_id IS NOT NULL)`),
    (0, pg_core_1.index)("idx_club_events_type").using("btree", table.eventType.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
    (0, pg_core_1.index)("idx_club_events_visit").using("btree", table.visitId.asc().nullsLast().op("uuid_ops")).where((0, drizzle_orm_1.sql) `(visit_id IS NOT NULL)`),
    (0, pg_core_1.foreignKey)({
        columns: [table.staffId],
        foreignColumns: [exports.staff.id],
        name: "club_events_staff_id_fkey"
    }).onDelete("set null"),
    (0, pg_core_1.foreignKey)({
        columns: [table.customerId],
        foreignColumns: [exports.customers.id],
        name: "club_events_customer_id_fkey"
    }).onDelete("set null"),
]);
exports.products = (0, pg_core_1.pgTable)("products", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    sku: (0, pg_core_1.text)(),
    name: (0, pg_core_1.text)().notNull(),
    price: (0, pg_core_1.integer)("price").default(0).notNull(),
    category: (0, pg_core_1.text)().default('RETAIL').notNull(),
    isActive: (0, pg_core_1.boolean)("is_active").default(true).notNull(),
    sortOrder: (0, pg_core_1.integer)("sort_order").default(0).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_products_category_active").using("btree", table.category.asc().nullsLast().op("text_ops"), table.isActive.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("idx_products_sku").using("btree", table.sku.asc().nullsLast().op("text_ops")).where((0, drizzle_orm_1.sql) `(sku IS NOT NULL)`),
    (0, pg_core_1.unique)("products_sku_key").on(table.sku),
]);
exports.messages = (0, pg_core_1.pgTable)("messages", {
    id: (0, pg_core_1.uuid)().defaultRandom().primaryKey().notNull(),
    sender: (0, pg_core_1.text)().notNull(),
    subject: (0, pg_core_1.text)().notNull(),
    body: (0, pg_core_1.text)().notNull(),
    read: (0, pg_core_1.boolean)().default(false).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("idx_messages_created").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
]);
exports.laneSessionCommands = (0, pg_core_1.pgTable)("lane_session_commands", {
    sessionId: (0, pg_core_1.uuid)("session_id").notNull(),
    commandId: (0, pg_core_1.uuid)("command_id").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    actor: (0, pg_core_1.varchar)({ length: 20 }).notNull(),
    type: (0, pg_core_1.varchar)({ length: 100 }).notNull(),
    payloadJson: (0, pg_core_1.jsonb)("payload_json"),
}, (table) => [
    (0, pg_core_1.foreignKey)({
        columns: [table.sessionId],
        foreignColumns: [exports.laneSessions.id],
        name: "lane_session_commands_session_id_fkey"
    }).onDelete("cascade"),
    (0, pg_core_1.primaryKey)({ columns: [table.sessionId, table.commandId], name: "lane_session_commands_pkey" }),
    (0, pg_core_1.check)("lane_session_commands_actor_check", (0, drizzle_orm_1.sql) `(actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[])`),
]);
