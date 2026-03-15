import { type PoolClient, type LaneSessionRow, LANE_SESSION_COLS } from './types';
import { HttpError } from '../errors/HttpError';

/**
 * Active lane-session statuses used for typical "find the current session" lookups.
 */
const ACTIVE_STATUSES = `'ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE'`;

/**
 * Resolve the most-recent non-terminal lane session for a lane.
 *
 * @param client    Postgres transaction client
 * @param laneId    Lane identifier
 * @param opts.sessionId  If supplied, the session is fetched by ID (still validates lane).
 *                        Falls back to lane-based lookup when the specific session isn't found.
 * @param opts.statuses   Override the default active-status filter (raw SQL fragment).
 * @param opts.forUpdate  When true, adds `FOR UPDATE` row-level lock.
 * @throws          `{ statusCode: 404, message: 'No active session found' }`
 */
export async function resolveActiveSession(
  client: PoolClient,
  laneId: string,
  opts?: {
    sessionId?: string;
    statuses?: string;
    forUpdate?: boolean;
  },
): Promise<LaneSessionRow> {
  const statuses = opts?.statuses ?? ACTIVE_STATUSES;
  const lock = opts?.forUpdate ? ' FOR UPDATE' : '';

  // If sessionId is given, try explicit lookup first.
  if (opts?.sessionId) {
    const byId = await client.query<LaneSessionRow>(
      `SELECT ${LANE_SESSION_COLS} FROM lane_sessions WHERE id = $1 AND lane_id = $2${lock} LIMIT 1`,
      [opts.sessionId, laneId],
    );
    if (byId.rows.length > 0) return byId.rows[0]!;
  }

  // Fallback: most recent active session on the lane.
  const result = await client.query<LaneSessionRow>(
    `SELECT ${LANE_SESSION_COLS} FROM lane_sessions
     WHERE lane_id = $1 AND status IN (${statuses})
     ORDER BY created_at DESC
     LIMIT 1${lock}`,
    [laneId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, 'No active session found');
  }

  return result.rows[0]!;
}

/**
 * Validate and lock a resource (room or locker) for assignment to a lane session.
 * Checks availability, double-assignment, and double-selection across sessions.
 *
 * @returns The resource row (room or locker) with its number and type info.
 * @throws  statusCode 404 | 409 when the resource is unavailable.
 */
export async function validateAndLockResource(
  client: PoolClient,
  params: {
    resourceType: 'room' | 'locker';
    resourceId: string;
    sessionId: string;
  },
): Promise<{
  resourceRow: { id: string; number: string; status: string; assigned_to_customer_id: string | null; type?: string };
}> {
  const { resourceType, resourceId, sessionId } = params;
  const table = 'inventory_resources';
  const label = resourceType === 'room' ? 'Room' : 'Locker';
  const selectCols = resourceType === 'room'
    ? 'id, number, tier as type, status, assigned_to_customer_id'
    : 'id, number, status, assigned_to_customer_id';

  // 1. Lock the resource row.
  const result = await client.query<{ id: string; number: string; type?: string; status: string; assigned_to_customer_id: string | null }>(
    `SELECT ${selectCols} FROM ${table} WHERE id = $1 AND kind = $2 FOR UPDATE`,
    [resourceId, resourceType],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, `${label} not found`);
  }

  const resource = result.rows[0]!;

  // 2. Room-specific: must be CLEAN.
  if (resourceType === 'room' && resource.status !== 'CLEAN') {
    throw new HttpError(400, `${label} ${resource.number} is not available (status: ${resource.status})`);
  }

  // 3. Already assigned to a customer?
  if (resource.assigned_to_customer_id) {
    throw new HttpError(409, `${label} ${resource.number} is already assigned (race condition)`);
  }

  // 4. Already selected by another in-progress lane session?
  const selectedByOther = await client.query<{ id: string }>(
    `SELECT id
     FROM lane_sessions
     WHERE id <> $1
       AND assigned_resource_type = $2
       AND assigned_resource_id = $3
       AND status = ANY (
         ARRAY[
           'ACTIVE'::public.lane_session_status,
           'AWAITING_CUSTOMER'::public.lane_session_status,
           'AWAITING_ASSIGNMENT'::public.lane_session_status,
           'AWAITING_PAYMENT'::public.lane_session_status,
           'AWAITING_SIGNATURE'::public.lane_session_status
         ]
       )
     LIMIT 1`,
    [sessionId, resourceType, resourceId],
  );

  if (selectedByOther.rows.length > 0) {
    throw new HttpError(409, `${label} ${resource.number} is already selected by another lane session (race condition)`);
  }

  return { resourceRow: resource };
}

/**
 * Record the selected resource on the lane session (without actually assigning to customers table).
 */
export async function recordResourceSelection(
  client: PoolClient,
  params: { sessionId: string; resourceType: 'room' | 'locker'; resourceId: string },
): Promise<void> {
  await client.query(
    `UPDATE lane_sessions
     SET assigned_resource_id = $1,
         assigned_resource_type = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [params.resourceId, params.resourceType, params.sessionId],
  );
}
