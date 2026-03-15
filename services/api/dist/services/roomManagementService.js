"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listResources = listResources;
exports.createResource = createResource;
exports.updateResource = updateResource;
exports.setResourceStatus = setResourceStatus;
exports.listRoomsAndLockers = listRoomsAndLockers;
exports.createRoom = createRoom;
exports.updateRoom = updateRoom;
exports.setRoomStatus = setRoomStatus;
exports.createLocker = createLocker;
exports.setLockerStatus = setLockerStatus;
/**
 * Resource management service — CRUD and status transitions for inventory resources.
 *
 * Unified handler for rooms and lockers via the `inventory_resources` table.
 * Extracted from routes/admin/room-management.ts. No HTTP/Fastify concepts.
 * Migrated to unified inventory_resources.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function listResources() {
    const rows = await db_1.db
        .select({
        id: schema_1.inventoryResources.id,
        kind: schema_1.inventoryResources.kind,
        number: schema_1.inventoryResources.number,
        tier: schema_1.inventoryResources.tier,
        status: schema_1.inventoryResources.status,
        floor: schema_1.inventoryResources.floor,
        assignedToCustomerId: schema_1.inventoryResources.assignedToCustomerId,
    })
        .from(schema_1.inventoryResources)
        .orderBy((0, drizzle_orm_1.asc)(schema_1.inventoryResources.number));
    const rooms = rows
        .filter((r) => r.kind === 'room')
        .map((r) => ({
        id: r.id,
        number: r.number,
        type: r.tier,
        status: r.status,
        floor: r.floor,
        isOccupied: r.assignedToCustomerId !== null,
    }));
    const lockers = rows
        .filter((r) => r.kind === 'locker')
        .map((l) => ({
        id: l.id,
        number: l.number,
        status: l.status,
        isOccupied: l.assignedToCustomerId !== null,
    }));
    return { rooms, lockers };
}
async function createResource(kind, number, tier, floor) {
    const [inserted] = await db_1.db
        .insert(schema_1.inventoryResources)
        .values({
        kind,
        number,
        tier: (tier ?? (kind === 'locker' ? 'LOCKER' : 'STANDARD')),
        floor: floor ?? null,
        status: 'CLEAN',
    })
        .returning();
    return inserted;
}
async function updateResource(resourceId, tier, floor) {
    const updates = { updatedAt: (0, drizzle_orm_1.sql) `NOW()` };
    if (tier)
        updates.tier = tier;
    if (floor !== undefined)
        updates.floor = floor;
    const [updated] = await db_1.db
        .update(schema_1.inventoryResources)
        .set(updates)
        .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, resourceId))
        .returning();
    if (!updated)
        throw new HttpError_1.HttpError(404, 'Resource not found');
    return updated;
}
async function setResourceStatus(resourceId, status) {
    return db_1.db.transaction(async (tx) => {
        const [current] = await tx
            .select()
            .from(schema_1.inventoryResources)
            .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, resourceId))
            .for('update');
        if (!current)
            throw new HttpError_1.HttpError(404, 'Resource not found');
        const label = current.kind === 'room' ? `Room ${current.number}` : `Locker ${current.number}`;
        if (current.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') {
            throw new HttpError_1.HttpError(409, `Cannot set an occupied ${current.kind} to Out of Service. Check out the customer first.`);
        }
        if (current.status === status)
            return current;
        const [updated] = await tx
            .update(schema_1.inventoryResources)
            .set({
            status: status,
            updatedAt: (0, drizzle_orm_1.sql) `NOW()`,
            lastStatusChange: (0, drizzle_orm_1.sql) `NOW()`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, resourceId))
            .returning();
        return updated;
    });
}
// ── Backward-compat aliases ──
// These maintain the old API surface during migration
async function listRoomsAndLockers() {
    return listResources();
}
async function createRoom(number, type, floor) {
    return createResource('room', number, type, floor);
}
async function updateRoom(roomId, type, floor) {
    return updateResource(roomId, type, floor);
}
async function setRoomStatus(roomId, status) {
    return setResourceStatus(roomId, status);
}
async function createLocker(number) {
    return createResource('locker', number);
}
async function setLockerStatus(lockerId, status) {
    return setResourceStatus(lockerId, status);
}
