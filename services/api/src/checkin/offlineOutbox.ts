import type { PoolClient } from 'pg';

export async function writeOfflineOutboxRecord(
  client: PoolClient,
  params: {
    laneId: string;
    sessionId: string;
    commandId: string;
    actor: string;
    type: string;
    payload: unknown;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO offline_command_outbox (lane_id, session_id, command_id, actor, type, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, command_id) DO NOTHING`,
    [
      params.laneId,
      params.sessionId,
      params.commandId,
      params.actor,
      params.type,
      params.payload != null ? JSON.stringify(params.payload) : null,
    ]
  );
}

