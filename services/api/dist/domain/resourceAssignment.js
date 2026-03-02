"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignRoom = assignRoom;
exports.assignLocker = assignLocker;
/**
 * Resource assignment helpers — room/locker assignment within Drizzle transactions.
 *
 * Performs SELECT ... FOR UPDATE → validate → UPDATE.
 * Replaces the duplicated assignment logic previously in visits.ts (3 copies each).
 *
 * Migrated to Drizzle ORM in Phase 3.
 */
const HttpError_1 = require("../errors/HttpError");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Assign a room to a customer within a Drizzle transaction.
 *
 * @param tx - Drizzle transaction scope
 * @param roomId - Room UUID to assign
 * @param customerId - Customer UUID to assign to
 * @param opts.allowReassignToSame - If true, skip if already assigned to this customer (renewal flow)
 * @returns The assigned room ID
 */
async function assignRoom(tx, roomId, customerId, opts) {
    // SELECT ... FOR UPDATE requires raw SQL — Drizzle builder doesn't support locking clauses
    const result = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, status, assigned_to_customer_id
     FROM rooms
     WHERE id = ${roomId}
     FOR UPDATE`);
    if (result.rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'Room not found');
    }
    const room = result.rows[0];
    if (room.status !== 'CLEAN') {
        throw new HttpError_1.HttpError(400, `Room ${room.number} is not available (status: ${room.status})`);
    }
    if (room.assigned_to_customer_id) {
        if (opts?.allowReassignToSame && room.assigned_to_customer_id === customerId) {
            return roomId;
        }
        throw new HttpError_1.HttpError(409, `Room ${room.number} is already assigned`);
    }
    await tx
        .update(schema_1.rooms)
        .set({
        assignedToCustomerId: customerId,
        updatedAt: (0, drizzle_orm_1.sql) `NOW()`,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.rooms.id, roomId));
    return roomId;
}
/**
 * Assign a locker to a customer within a Drizzle transaction.
 *
 * @param tx - Drizzle transaction scope
 * @param lockerId - Locker UUID to assign
 * @param customerId - Customer UUID to assign to
 * @param opts.allowReassignToSame - If true, skip if already assigned to this customer (renewal flow)
 * @returns The assigned locker ID
 */
async function assignLocker(tx, lockerId, customerId, opts) {
    const result = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, status, assigned_to_customer_id
     FROM lockers
     WHERE id = ${lockerId}
     FOR UPDATE`);
    if (result.rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'Locker not found');
    }
    const locker = result.rows[0];
    if (locker.assigned_to_customer_id) {
        if (opts?.allowReassignToSame && locker.assigned_to_customer_id === customerId) {
            return lockerId;
        }
        throw new HttpError_1.HttpError(409, `Locker ${locker.number} is already assigned`);
    }
    await tx
        .update(schema_1.lockers)
        .set({
        assignedToCustomerId: customerId,
        updatedAt: (0, drizzle_orm_1.sql) `NOW()`,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.lockers.id, lockerId));
    return lockerId;
}
