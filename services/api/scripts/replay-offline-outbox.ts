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

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

function getApiBaseUrl(): string {
  const url = process.env.CLOUD_API_BASE_URL;
  if (!url) throw new Error('CLOUD_API_BASE_URL is required');
  return url.replace(/\/$/, '');
}

function getKioskToken(): string {
  const token = process.env.KIOSK_TOKEN;
  if (!token) throw new Error('KIOSK_TOKEN is required');
  return token;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  const apiBase = getApiBaseUrl();
  const kioskToken = getKioskToken();
  const limit = Number(process.env.REPLAY_LIMIT ?? 100);

  const client = await pool.connect();
  try {
    const pending = await client.query<OutboxRow>(
      `SELECT id, lane_id, session_id, command_id, actor, type, payload_json, replay_attempts
       FROM offline_command_outbox
       WHERE replayed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );

    for (const row of pending.rows) {
      const url = `${apiBase}/v1/checkin/lane/${encodeURIComponent(row.lane_id)}/flow-command`;

      const logPrefix = `[offline:replay] lane=${row.lane_id} session=${row.session_id} command=${row.command_id} type=${row.type}`;

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
            // We intentionally omit expectedFlowVersion here; cloud will version-guard on its own.
            type: row.type,
            payload: row.payload_json ?? undefined,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        }

        console.log(`${logPrefix} ok`);
        await client.query(
          `UPDATE offline_command_outbox
           SET replayed_at = NOW(),
               replay_attempts = replay_attempts + 1,
               last_replay_error = NULL
           WHERE id = $1`,
          [row.id]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`${logPrefix} failed: ${message}`);
        await client.query(
          `UPDATE offline_command_outbox
           SET replay_attempts = replay_attempts + 1,
               last_replay_error = $2
           WHERE id = $1`,
          [row.id, message]
        );
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
