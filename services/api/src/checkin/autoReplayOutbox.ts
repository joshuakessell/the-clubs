import { Pool } from 'pg';

type OutboxRow = {
  id: string;
  lane_id: string;
  session_id: string;
  command_id: string;
  actor: string;
  type: string;
  payload_json: unknown;
  replay_attempts: number;
};

const HEALTH_CHECK_BASE_MS = 30_000;
const HEALTH_CHECK_MAX_MS = 300_000;
const REPLAY_BATCH_SIZE = 50;
const REPLAY_INTERVAL_MS = 5_000;
const MAX_REPLAY_ATTEMPTS = 10;

/**
 * Auto-replay background service for the edge stack.
 *
 * Runs on the edge server when EDGE_STACK=true and CLOUD_API_BASE_URL is set.
 * Periodically checks cloud health and, when cloud is reachable, replays
 * pending offline_command_outbox rows to the cloud API.
 */
export function startAutoReplayOutbox(params: {
  pool: Pool;
  cloudApiBase: string;
  kioskToken: string;
  signal?: AbortSignal;
  log?: (...args: unknown[]) => void;
}): void {
  const { pool, cloudApiBase, kioskToken, signal } = params;
  const log = params.log ?? ((...args: unknown[]) => console.log('[auto-replay]', ...args));

  const POOL_CONNECT_TIMEOUT_MS = 10_000;

  let consecutiveHealthFailures = 0;
  let healthTimerId: ReturnType<typeof setTimeout> | null = null;
  let replayTimerId: ReturnType<typeof setTimeout> | null = null;
  let cloudHealthy = false;

  const getHealthInterval = () => {
    if (consecutiveHealthFailures === 0) return HEALTH_CHECK_BASE_MS;
    return Math.min(
      HEALTH_CHECK_MAX_MS,
      HEALTH_CHECK_BASE_MS * Math.pow(2, consecutiveHealthFailures - 1)
    );
  };

  const checkCloudHealth = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${cloudApiBase}/health`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const replayBatch = async (): Promise<number> => {
    // B-5: Timeout pool.connect to prevent hanging when pool is exhausted.
    const connectAbort = AbortSignal.timeout(POOL_CONNECT_TIMEOUT_MS);
    const client = await pool.connect();
    connectAbort.throwIfAborted?.(); // no-op but makes intent clear
    let replayed = 0;
    try {
      const pending = await client.query<OutboxRow>(
        `SELECT id, lane_id, session_id, command_id, actor, type, payload_json, replay_attempts
         FROM offline_command_outbox
         WHERE replayed_at IS NULL
           AND replay_attempts < $2
         ORDER BY created_at ASC
         LIMIT $1`,
        [REPLAY_BATCH_SIZE, MAX_REPLAY_ATTEMPTS]
      );

      for (const row of pending.rows) {
        if (signal?.aborted) break;

        const url = `${cloudApiBase}/v1/checkin/lane/${encodeURIComponent(row.lane_id)}/flow-command`;

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-kiosk-token': kioskToken,
            },
            body: JSON.stringify({
              sessionId: row.session_id,
              commandId: row.command_id,
              actor: row.actor,
              type: row.type,
              payload: row.payload_json ?? undefined,
            }),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
          }

          log(JSON.stringify({ event: 'replay_success', laneId: row.lane_id, sessionId: row.session_id, commandId: row.command_id, type: row.type, attempt: row.replay_attempts + 1 }));
          await client.query(
            `UPDATE offline_command_outbox
             SET replayed_at = NOW(),
                 replay_attempts = replay_attempts + 1,
                 last_replay_error = NULL
             WHERE id = $1`,
            [row.id]
          );
          replayed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(JSON.stringify({ event: 'replay_failed', laneId: row.lane_id, sessionId: row.session_id, commandId: row.command_id, type: row.type, attempt: row.replay_attempts + 1, error: message }));
          await client.query(
            `UPDATE offline_command_outbox
             SET replay_attempts = replay_attempts + 1,
                 last_replay_error = $2
             WHERE id = $1`,
            [row.id, message]
          );
          // Network-level errors (DNS, connection refused, timeout) throw TypeError in the
          // Fetch spec. If we see one, stop the batch — cloud is likely unreachable again.
          if (error instanceof TypeError) {
            break;
          }
        }
      }
    } finally {
      client.release();
    }
    return replayed;
  };

  const replayLoop = async () => {
    if (signal?.aborted) return;

    try {
      const count = await replayBatch();
      if (count > 0) {
        log(`replayed ${count} commands, checking for more...`);
        // If we replayed some, check again quickly for more pending.
        replayTimerId = setTimeout(() => void replayLoop(), REPLAY_INTERVAL_MS);
        return;
      }
    } catch (error) {
      log('replay batch error:', error instanceof Error ? error.message : String(error));
    }

    // No more pending or error — go back to health polling.
    cloudHealthy = false;
    scheduleHealthCheck();
  };

  const healthLoop = async () => {
    if (signal?.aborted) return;

    const healthy = await checkCloudHealth();
    if (healthy) {
      consecutiveHealthFailures = 0;
      if (!cloudHealthy) {
        cloudHealthy = true;
        log('cloud is reachable, starting outbox replay...');
      }
      void replayLoop();
    } else {
      consecutiveHealthFailures++;
      scheduleHealthCheck();
    }
  };

  const scheduleHealthCheck = () => {
    if (signal?.aborted) return;
    healthTimerId = setTimeout(() => void healthLoop(), getHealthInterval());
  };

  // Cleanup on abort.
  signal?.addEventListener('abort', () => {
    if (healthTimerId) clearTimeout(healthTimerId);
    if (replayTimerId) clearTimeout(replayTimerId);
  }, { once: true });

  log(`started (cloud=${cloudApiBase}, interval=${HEALTH_CHECK_BASE_MS}ms)`);
  scheduleHealthCheck();
}
