"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignResource = assignResource;
/**
 * Resource assignment helpers — inventory resource assignment within Drizzle transactions.
 *
 * Performs SELECT ... FOR UPDATE → validate → UPDATE.
 * Unified handler for both rooms and lockers via the `inventory_resources` table.
 *
 * Migrated to unified inventory_resources in Phase 3.
 */
const HttpError_1 = require("../errors/HttpError");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
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
async function assignResource(tx, resourceId, customerId, opts) {
    // SELECT ... FOR UPDATE — native Drizzle locking
    const rows = await tx
        .select({
        id: schema_1.inventoryResources.id,
        number: schema_1.inventoryResources.number,
        kind: schema_1.inventoryResources.kind,
        status: schema_1.inventoryResources.status,
        assignedToCustomerId: schema_1.inventoryResources.assignedToCustomerId,
    })
        .from(schema_1.inventoryResources)
        .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, resourceId))
        .for('update');
    if (rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'Resource not found');
    }
    const resource = rows[0];
    const label = resource.kind === 'room' ? `Room ${resource.number}` : `Locker ${resource.number}`;
    // Rooms must be CLEAN to assign; lockers only check assignment
    if (resource.kind === 'room' && resource.status !== 'CLEAN') {
        throw new HttpError_1.HttpError(400, `${label} is not available (status: ${resource.status})`);
    }
    if (resource.assignedToCustomerId) {
        if (opts?.allowReassignToSame && resource.assignedToCustomerId === customerId) {
            return resourceId;
        }
        throw new HttpError_1.HttpError(409, `${label} is already assigned`);
    }
    await tx
        .update(schema_1.inventoryResources)
        .set({
        assignedToCustomerId: customerId,
        updatedAt: (0, drizzle_orm_1.sql) `NOW()`,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, resourceId));
    return resourceId;
}
