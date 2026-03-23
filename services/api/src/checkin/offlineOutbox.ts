import type { DrizzleTx } from '../db';
import { offlineCommandOutbox } from '../db/schema/index';

export async function writeOfflineOutboxRecord(
  tx: DrizzleTx,
  params: {
    laneId: string;
    sessionId: string;
    commandId: string;
    actor: string;
    type: string;
    payload: unknown;
  }
): Promise<void> {
  await tx
    .insert(offlineCommandOutbox)
    .values({
      laneId: params.laneId,
      sessionId: params.sessionId,
      commandId: params.commandId,
      actor: params.actor,
      type: params.type,
      payloadJson: params.payload,
    })
    .onConflictDoNothing({
      target: [offlineCommandOutbox.sessionId, offlineCommandOutbox.commandId],
    });
}
