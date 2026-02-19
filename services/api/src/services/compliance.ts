import { query } from '../db';

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

interface TimeclockRow {
  id: string;
  clock_in_at: Date;
  clock_out_at: Date | null;
  shift_id: string | null;
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
  const sessions = await query<TimeclockRow>(
    `SELECT id, clock_in_at, clock_out_at, shift_id
     FROM timeclock_sessions
     WHERE employee_id = $1
     AND (
       (clock_in_at <= $2 AND (clock_out_at IS NULL OR clock_out_at >= $3))
       OR (clock_in_at >= $3 AND clock_in_at <= $2)
     )
     ORDER BY clock_in_at`,
    [employeeId, shift.ends_at, shift.starts_at]
  );

  const scheduledMinutes = Math.floor(
    (shift.ends_at.getTime() - shift.starts_at.getTime()) / (1000 * 60)
  );

  // If no sessions found, it's a no-show
  if (sessions.rows.length === 0) {
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
  let matchingSession: TimeclockRow | null = null;

  // First, try to find by shift_id
  if (sessions.rows.some((s) => s.shift_id === shift.id)) {
    matchingSession = sessions.rows.find((s) => s.shift_id === shift.id) || null;
  } else {
    // Find session with best overlap
    let maxOverlap = 0;
    for (const session of sessions.rows) {
      const overlap = calculateOverlap(
        shift.starts_at,
        shift.ends_at,
        session.clock_in_at,
        session.clock_out_at || new Date()
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

  // Calculate worked minutes within shift window
  const workedMinutesInWindow = calculateOverlap(
    shift.starts_at,
    shift.ends_at,
    matchingSession.clock_in_at,
    matchingSession.clock_out_at || new Date()
  );

  const compliancePercent =
    scheduledMinutes > 0 ? Math.round((workedMinutesInWindow / scheduledMinutes) * 100) : 0;

  // Determine flags
  const clockInTime = matchingSession.clock_in_at.getTime();
  const clockOutTime = matchingSession.clock_out_at ? matchingSession.clock_out_at.getTime() : null;
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
    actualClockIn: matchingSession.clock_in_at,
    actualClockOut: matchingSession.clock_out_at,
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
