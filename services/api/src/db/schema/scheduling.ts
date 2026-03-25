import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import * as enums from './enums';
import { staff } from './identity';

export const employeeShifts = pgTable("employee_shifts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }).notNull(),
	shiftCode: text("shift_code").notNull(),
	role: text(),
	status: enums.shiftStatus().default('SCHEDULED').notNull(),
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

export const timeOffRequests = pgTable("time_off_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	employeeId: uuid("employee_id").notNull(),
	day: date().notNull(),
	reason: text(),
	status: enums.timeOffRequestStatus().default('PENDING').notNull(),
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

export const staffBreakSessions = pgTable("staff_break_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	staffId: uuid("staff_id").notNull(),
	timeclockSessionId: uuid("timeclock_session_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'date' }),
	breakType: enums.breakType("break_type").notNull(),
	status: enums.breakStatus().default('OPEN').notNull(),
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
