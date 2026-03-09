/**
 * Compliance service — business logic for shift compliance metrics.
 *
 * Migrated to Drizzle ORM typed queries.
 */
import { db } from '../db';
import { timeclockSessions } from '../db/schema';
import { eq, and, or, lte, gte, isNull, asc } from 'drizzle-orm';

export interface ComplianceMetrics {
  workedMinutesInWindow: number;
  scheduledMinutes: number;
  compliancePercent: number;
  flags: {
    lateClockIn: boolean;
    earlyClockOut: boolean;
    missingClockOut: boolean;
    noShow: boolean;
  };
  actualClockIn: Date | null;
  actualClockOut: Date | null;
}

interface ShiftRow {
  id: string;
  employee_id: string;
  starts_at: Date;
  ends_at: Date;
  shift_code: string;
  status: string;
}

const GRACE_MINUTES = 5;

/**
 * Compute compliance metrics for a scheduled shift.
 */
export async function computeCompliance(
  shift: ShiftRow,
  employeeId: string
): Promise<ComplianceMetrics> {
  // Find timeclock sessions for this employee that overlap with shift window
  const sessions = await db
    .select({
      id: timeclockSessions.id,
      clockInAt: timeclockSessions.clockInAt,
      clockOutAt: timeclockSessions.clockOutAt,
      shiftId: timeclockSessions.shiftId,
    })
    .from(timeclockSessions)
    .where(
      and(
        eq(timeclockSessions.employeeId, employeeId),
        or(
          and(
            lte(timeclockSessions.clockInAt, shift.ends_at.toISOString()),
            or(
              isNull(timeclockSessions.clockOutAt),
              gte(timeclockSessions.clockOutAt, shift.starts_at.toISOString())
            )
          ),
          and(
            gte(timeclockSessions.clockInAt, shift.starts_at.toISOString()),
            lte(timeclockSessions.clockInAt, shift.ends_at.toISOString())
          )
        )
      )
    )
    .orderBy(asc(timeclockSessions.clockInAt));

  const scheduledMinutes = Math.floor(
    (shift.ends_at.getTime() - shift.starts_at.getTime()) / (1000 * 60)
  );

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

  // Find session that matches this shift (by shift_id or by time overlap)
  type SessionRow = typeof sessions[number];
  let matchingSession: SessionRow | null = null;

  // First, try to find by shift_id
  if (sessions.some((s) => s.shiftId === shift.id)) {
    matchingSession = sessions.find((s) => s.shiftId === shift.id) || null;
  } else {
    // Find session with best overlap
    let maxOverlap = 0;
    for (const session of sessions) {
      const overlap = calculateOverlap(
        shift.starts_at,
        shift.ends_at,
        new Date(session.clockInAt),
        session.clockOutAt ? new Date(session.clockOutAt) : new Date()
      );
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

  const clockInDate = new Date(matchingSession.clockInAt);
  const clockOutDate = matchingSession.clockOutAt ? new Date(matchingSession.clockOutAt) : null;

  // Calculate worked minutes within shift window
  const workedMinutesInWindow = calculateOverlap(
    shift.starts_at,
    shift.ends_at,
    clockInDate,
    clockOutDate || new Date()
  );

  const compliancePercent =
    scheduledMinutes > 0 ? Math.round((workedMinutesInWindow / scheduledMinutes) * 100) : 0;

  // Determine flags
  const clockInTime = clockInDate.getTime();
  const clockOutTime = clockOutDate ? clockOutDate.getTime() : null;
  const shiftStartTime = shift.starts_at.getTime();
  const shiftEndTime = shift.ends_at.getTime();
  const graceMs = GRACE_MINUTES * 60 * 1000;

  const lateClockIn = clockInTime > shiftStartTime + graceMs;
  const earlyClockOut = clockOutTime !== null && clockOutTime < shiftEndTime - graceMs;
  const missingClockOut = clockOutTime === null && shift.ends_at < new Date();

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
function calculateOverlap(
  range1Start: Date,
  range1End: Date,
  range2Start: Date,
  range2End: Date
): number {
  const start = Math.max(range1Start.getTime(), range2Start.getTime());
  const end = Math.min(range1End.getTime(), range2End.getTime());

  if (end <= start) {
    return 0;
  }

  return Math.floor((end - start) / (1000 * 60));
}
