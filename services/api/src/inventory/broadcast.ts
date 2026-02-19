import type { Broadcaster } from '../realtime/broadcaster';
import { query } from '../db';
import { computeInventoryAvailable } from './available';

/**
 * Helper to broadcast current inventory state.
 */
export async function broadcastInventoryUpdate(broadcaster: Broadcaster): Promise<void> {
  const result = await query<{ status: string; room_type: string; count: string }>(
    `SELECT status, type as room_type, COUNT(*) as count
     FROM rooms
     WHERE type != 'LOCKER'
     GROUP BY status, type`
  );

  const lockerResult = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM lockers
     GROUP BY status`
  );

  // Build detailed inventory
  const byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number }> =
    {};
  let overallClean = 0,
    overallCleaning = 0,
    overallDirty = 0;

  for (const row of result.rows) {
    if (!byType[row.room_type]) {
      byType[row.room_type] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
    }
    const count = parseInt(row.count, 10);
    const status = row.status.toLowerCase();
    if (status === 'clean' || status === 'cleaning' || status === 'dirty') {
      byType[row.room_type]![status] = count;
      byType[row.room_type]!.total += count;
      if (status === 'clean') overallClean += count;
      else if (status === 'cleaning') overallCleaning += count;
      else overallDirty += count;
    }
  }

  let lockerClean = 0,
    lockerCleaning = 0,
    lockerDirty = 0;
  for (const row of lockerResult.rows) {
    const count = parseInt(row.count, 10);
    const status = row.status.toLowerCase();
    if (status === 'clean') lockerClean = count;
    else if (status === 'cleaning') lockerCleaning = count;
    else if (status === 'dirty') lockerDirty = count;
  }

  let available: Awaited<ReturnType<typeof computeInventoryAvailable>> | undefined;
  try {
    available = await computeInventoryAvailable(query);
  } catch {
    available = undefined;
  }

  broadcaster.broadcast({
    type: 'INVENTORY_UPDATED',
    payload: {
      inventory: {
        byType,
        overall: {
          clean: overallClean,
          cleaning: overallCleaning,
          dirty: overallDirty,
          total: overallClean + overallCleaning + overallDirty,
        },
        lockers: {
          clean: lockerClean,
          cleaning: lockerCleaning,
          dirty: lockerDirty,
          total: lockerClean + lockerCleaning + lockerDirty,
        },
      },
      available,
    },
    timestamp: new Date().toISOString(),
  });
}
