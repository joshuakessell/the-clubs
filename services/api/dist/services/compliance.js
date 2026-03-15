"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCompliance = computeCompliance;
/**
 * Compliance service — business logic for shift compliance metrics.
 *
 * Migrated to Drizzle ORM typed queries.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const GRACE_MINUTES = 5;
/**
 * Compute compliance metrics for a scheduled shift.
 */
async function computeCompliance(shift, employeeId) {
    // Find timeclock sessions for this employee that overlap with shift window
    const sessions = await db_1.db
        .select({
        id: schema_1.timeclockSessions.id,
        clockInAt: schema_1.timeclockSessions.clockInAt,
        clockOutAt: schema_1.timeclockSessions.clockOutAt,
        shiftId: schema_1.timeclockSessions.shiftId,
    })
        .from(schema_1.timeclockSessions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.employeeId, employeeId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.lte)(schema_1.timeclockSessions.clockInAt, shift.ends_at), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.timeclockSessions.clockOutAt), (0, drizzle_orm_1.gte)(schema_1.timeclockSessions.clockOutAt, shift.starts_at))), (0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_1.timeclockSessions.clockInAt, shift.starts_at), (0, drizzle_orm_1.lte)(schema_1.timeclockSessions.clockInAt, shift.ends_at)))))
        .orderBy((0, drizzle_orm_1.asc)(schema_1.timeclockSessions.clockInAt));
    const scheduledMinutes = Math.floor((new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / (1000 * 60));
    // If no sessions found, it's a no-show
    if (sessions.length === 0) {
        return {
            workedMinutesInWindow: 0,
            scheduledMinutes,
            compliancePercent: 0,
            flags: {
                lateClockIn: false,
                earlyClockOut: false,
                missingClockOut: false,
                noShow: true,
            },
            actualClockIn: null,
            actualClockOut: null,
        };
    }
    let matchingSession = null;
    // First, try to find by shift_id
    if (sessions.some((s) => s.shiftId === shift.id)) {
        matchingSession = sessions.find((s) => s.shiftId === shift.id) || null;
    }
    else {
        // Find session with best overlap
        let maxOverlap = 0;
        for (const session of sessions) {
            const overlap = calculateOverlap(shift.starts_at, shift.ends_at, session.clockInAt, session.clockOutAt ?? new Date());
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                matchingSession = session;
            }
        }
    }
    if (!matchingSession) {
        return {
            workedMinutesInWindow: 0,
            scheduledMinutes,
            compliancePercent: 0,
            flags: {
                lateClockIn: false,
                earlyClockOut: false,
                missingClockOut: false,
                noShow: true,
            },
            actualClockIn: null,
            actualClockOut: null,
        };
    }
    const clockInDate = matchingSession.clockInAt;
    const clockOutDate = matchingSession.clockOutAt ?? null;
    // Calculate worked minutes within shift window
    const workedMinutesInWindow = calculateOverlap(shift.starts_at, shift.ends_at, clockInDate, clockOutDate || new Date());
    const compliancePercent = scheduledMinutes > 0 ? Math.round((workedMinutesInWindow / scheduledMinutes) * 100) : 0;
    // Determine flags
    const clockInTime = clockInDate.getTime();
    const clockOutTime = clockOutDate ? clockOutDate.getTime() : null;
    const shiftStartTime = new Date(shift.starts_at).getTime();
    const shiftEndTime = new Date(shift.ends_at).getTime();
    const graceMs = GRACE_MINUTES * 60 * 1000;
    const lateClockIn = clockInTime > shiftStartTime + graceMs;
    const earlyClockOut = clockOutTime !== null && clockOutTime < shiftEndTime - graceMs;
    const missingClockOut = clockOutTime === null && new Date(shift.ends_at) < new Date();
    return {
        workedMinutesInWindow,
        scheduledMinutes,
        compliancePercent,
        flags: {
            lateClockIn,
            earlyClockOut,
            missingClockOut,
            noShow: false,
        },
        actualClockIn: clockInDate,
        actualClockOut: clockOutDate,
    };
}
/**
 * Calculate overlap in minutes between two time ranges.
 */
function calculateOverlap(range1Start, range1End, range2Start, range2End) {
    const start = Math.max(range1Start.getTime(), range2Start.getTime());
    const end = Math.min(range1End.getTime(), range2End.getTime());
    if (end <= start) {
        return 0;
    }
    return Math.floor((end - start) / (1000 * 60));
}
