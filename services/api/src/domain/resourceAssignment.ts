/**
 * Resource assignment helpers — inventory resource assignment within Drizzle transactions.
 *
 * Performs SELECT ... FOR UPDATE → validate → UPDATE.
 * Unified handler for both rooms and lockers via the `inventory_resources` table.
 *
 * Migrated to unified inventory_resources in Phase 3.
 */
import { HttpError } from '../errors/HttpError';
import { inventoryResources } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { type DrizzleTx } from '../db';

// Drizzle transaction type — flexible enough to accept any tx from db.transaction()


/**
 * Assign an inventory resource (room or locker) to a customer within a Drizzle transaction.
 *
 * @param tx - Drizzle transaction scope
 * @param resourceId - Resource UUID to assign
 * @param customerId - Customer UUID to assign to
 * @param opts.allowReassignToSame - If true, skip if already assigned to this customer (renewal flow)
 * @returns The assigned resource ID
 */
export async function assignResource(
  tx: DrizzleTx,
  resourceId: string,
  customerId: string,
  opts?: { allowReassignToSame?: boolean }
): Promise<string> {
  // SELECT ... FOR UPDATE — native Drizzle locking
  const rows = await tx
    .select({
      id: inventoryResources.id,
      number: inventoryResources.number,
      kind: inventoryResources.kind,
      status: inventoryResources.status,
      assignedToCustomerId: inventoryResources.assignedToCustomerId,
    })
    .from(inventoryResources)
    .where(eq(inventoryResources.id, resourceId))
    .for('update');

  if (rows.length === 0) {
    throw new HttpError(404, 'Resource not found');
  }

  const resource = rows[0]!;
  const label = resource.kind === 'room' ? `Room ${resource.number}` : `Locker ${resource.number}`;

  // Rooms must be CLEAN to assign; lockers only check assignment
  if (resource.kind === 'room' && resource.status !== 'CLEAN') {
    throw new HttpError(400, `${label} is not available (status: ${resource.status})`);
  }

  if (resource.assignedToCustomerId) {
    if (opts?.allowReassignToSame && resource.assignedToCustomerId === customerId) {
      return resourceId;
    }
    throw new HttpError(409, `${label} is already assigned`);
  }

  await tx
    .update(inventoryResources)
    .set({
      assignedToCustomerId: customerId,
      updatedAt: sql`NOW()`,
    })
    .where(eq(inventoryResources.id, resourceId));

  return resourceId;
}
