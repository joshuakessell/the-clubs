"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWaitlistEntries = listWaitlistEntries;
exports.offerUpgrade = offerUpgrade;
exports.cancelWaitlistEntry = cancelWaitlistEntry;
exports.revokeWaitlistOffer = revokeWaitlistOffer;
/**
 * Waitlist service — business logic for waitlist management and upgrade offers.
 *
 * Extracted from routes/waitlist.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const auditLog_1 = require("../audit/auditLog");
const expireWaitlist_1 = require("../waitlist/expireWaitlist");
const HttpError_1 = require("../errors/HttpError");
// ── Service Methods ──
async function listWaitlistEntries(status, fastifyInstance) {
    // Best-effort: expire stale entries first
    if (fastifyInstance) {
        try {
            await (0, expireWaitlist_1.expireWaitlistEntries)(fastifyInstance);
        }
        catch { /* non-critical */ }
    }
    const baseQuery = (0, drizzle_orm_1.sql) `SELECT w.*, w.resource_id AS offered_resource_id, cb.resource_id AS current_resource_id, cb.rental_type as current_rental_type, cb.starts_at as checkin_starts_at, cb.ends_at as checkin_ends_at, offered_res.number as offered_resource_number, current_res.number as current_resource_number, current_res.tier as current_resource_tier, current_res.kind as current_resource_kind, v.customer_id, c.name as customer_name, c.membership_number FROM waitlist w JOIN checkin_blocks cb ON w.checkin_block_id = cb.id JOIN visits v ON w.visit_id = v.id LEFT JOIN customers c ON v.customer_id = c.id LEFT JOIN inventory_resources offered_res ON w.resource_id = offered_res.id LEFT JOIN inventory_resources current_res ON cb.resource_id = current_res.id`;
    const fullQuery = status
        ? (0, drizzle_orm_1.sql) `${baseQuery} WHERE w.status = ${status} ORDER BY w.created_at ASC`
        : (0, drizzle_orm_1.sql) `${baseQuery} ORDER BY w.created_at ASC`;
    const result = await db_1.db.execute(fullQuery);
    const rows = result.rows;
    return rows.map((row) => ({
        id: row.id, visitId: row.visit_id, checkinBlockId: row.checkin_block_id, customerId: row.customer_id,
        desiredTier: row.desired_tier, desiredTiers: row.desired_tiers ?? [row.desired_tier], backupTier: row.backup_tier,
        status: row.status, createdAt: row.created_at, checkinAt: row.checkin_starts_at, checkoutAt: row.checkin_ends_at,
        offeredAt: row.offered_at, completedAt: row.completed_at, resourceId: row.offered_resource_id,
        offeredRoomNumber: row.offered_resource_number,
        offerExpiresAt: row.offer_expires_at,
        displayIdentifier: row.current_resource_number || `***${row.id.substring(0, 8)}`,
        currentRentalType: row.current_rental_type, currentRoomTier: row.current_resource_tier ?? null, customerName: row.customer_name || 'Customer',
    }));
}
async function offerUpgrade(waitlistId, roomId, staffId) {
    return db_1.db.transaction(async (tx) => {
        const waitlistResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT w.*, v.ended_at as visit_ended_at, cb.ends_at as block_ends_at FROM waitlist w JOIN visits v ON v.id = w.visit_id JOIN checkin_blocks cb ON cb.id = w.checkin_block_id WHERE w.id = ${waitlistId} FOR UPDATE`);
        if (waitlistResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Waitlist entry not found');
        const waitlist = waitlistResult.rows[0];
        if (waitlist.status !== 'ACTIVE' && waitlist.status !== 'OFFERED')
            throw new HttpError_1.HttpError(409, `Waitlist entry must be ACTIVE or OFFERED (current status: ${waitlist.status})`);
        if (waitlist.status === 'OFFERED' && waitlist.resource_id && waitlist.resource_id !== roomId)
            throw new HttpError_1.HttpError(409, 'Waitlist entry already has an active hold for a different resource');
        if (waitlist.visit_ended_at)
            throw new HttpError_1.HttpError(409, 'Waitlist entry is no longer valid (visit ended)');
        if (new Date(waitlist.block_ends_at).getTime() <= Date.now())
            throw new HttpError_1.HttpError(409, 'Waitlist entry is no longer valid (block ended)');
        const roomResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${roomId} FOR UPDATE`);
        if (roomResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Resource not found');
        const room = roomResult.rows[0];
        if (room.status !== 'CLEAN')
            throw new HttpError_1.HttpError(409, `Resource ${room.number} is not available (status: ${room.status})`);
        if (room.assigned_to_customer_id)
            throw new HttpError_1.HttpError(409, `Resource ${room.number} is already assigned`);
        const reservationConflict = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM inventory_reservations WHERE resource_type = 'room' AND resource_id = ${roomId} AND released_at IS NULL AND (waitlist_id IS NULL OR waitlist_id <> ${waitlistId}) LIMIT 1`);
        if (reservationConflict.rows.length > 0)
            throw new HttpError_1.HttpError(409, `Room ${room.number} is reserved`);
        let validTiers;
        if (Array.isArray(waitlist.desired_tiers) && waitlist.desired_tiers.length > 0) {
            validTiers = waitlist.desired_tiers.map(String);
        }
        else if (typeof waitlist.desired_tiers === 'string' && waitlist.desired_tiers.startsWith('{')) {
            validTiers = waitlist.desired_tiers.slice(1, -1).split(',').filter(Boolean);
        }
        else {
            validTiers = [];
        }
        if (validTiers.length === 0) {
            validTiers = [String(waitlist.desired_tier)];
        }
        if (!validTiers.includes(String(room.tier)))
            throw new HttpError_1.HttpError(409, `Resource ${room.number} is ${room.tier}, but waitlist accepts ${validTiers.join(', ')}`);
        const reserved = await tx.execute((0, drizzle_orm_1.sql) `SELECT w.id FROM waitlist w JOIN visits v ON v.id = w.visit_id JOIN checkin_blocks cb ON cb.id = w.checkin_block_id WHERE w.status = 'OFFERED' AND w.resource_id = ${roomId} AND w.id <> ${waitlistId} AND v.ended_at IS NULL AND cb.ends_at > NOW() LIMIT 1`);
        if (reserved.rows.length > 0)
            throw new HttpError_1.HttpError(409, `Resource ${room.number} is reserved for another offer`);
        const desiredExpiryRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT offer_expires_at FROM waitlist WHERE id = ${waitlistId} FOR UPDATE`);
        const existingExpiresAt = desiredExpiryRes.rows[0]?.offer_expires_at ?? null;
        const tenFromNow = new Date(Date.now() + 10 * 60 * 1000);
        const nextExpiresAt = existingExpiresAt && new Date(existingExpiresAt).getTime() > tenFromNow.getTime() ? existingExpiresAt : tenFromNow;
        await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO inventory_reservations (resource_type, resource_id, kind, waitlist_id, expires_at) VALUES ('room', ${roomId}, 'UPGRADE_HOLD', ${waitlistId}, ${nextExpiresAt}) ON CONFLICT DO NOTHING`);
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE inventory_reservations SET expires_at = ${nextExpiresAt} WHERE released_at IS NULL AND kind = 'UPGRADE_HOLD' AND waitlist_id = ${waitlistId}`);
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE waitlist SET status = 'OFFERED', offered_at = COALESCE(offered_at, NOW()), resource_id = ${roomId}, offer_expires_at = ${nextExpiresAt}, last_offered_at = NOW(), offer_attempts = offer_attempts + CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END, updated_at = NOW() WHERE id = ${waitlistId}`);
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'WAITLIST_OFFERED', entityType: 'waitlist', entityId: waitlistId, oldValue: { status: 'ACTIVE' }, newValue: { status: 'OFFERED', resource_id: roomId, resource_number: room.number } });
        return { waitlistId, status: 'OFFERED', resourceId: roomId, roomNumber: room.number };
    }, { isolationLevel: 'serializable' });
}
async function cancelWaitlistEntry(waitlistId, staffId, reason) {
    return db_1.db.transaction(async (tx) => {
        const waitlistResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, visit_id, checkin_block_id, desired_tier, desired_tiers, backup_tier, resource_id, status, created_at, offered_at, completed_at FROM waitlist WHERE id = ${waitlistId} FOR UPDATE`);
        if (waitlistResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Waitlist entry not found');
        const waitlist = waitlistResult.rows[0];
        if (waitlist.status === 'COMPLETED' || waitlist.status === 'CANCELLED')
            throw new HttpError_1.HttpError(400, `Cannot cancel waitlist entry with status ${waitlist.status}`);
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = ${staffId}, updated_at = NOW() WHERE id = ${waitlistId}`);
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'WAITLIST_CANCELLED', entityType: 'waitlist', entityId: waitlistId, oldValue: { status: waitlist.status }, newValue: { status: 'CANCELLED', reason: reason || 'Cancelled by staff' } });
        return { waitlistId, status: 'CANCELLED' };
    });
}
/**
 * Revoke an active offer — un-reserve the room and revert the waitlist entry
 * back to ACTIVE. The customer stays on the waitlist but the room is freed.
 */
async function revokeWaitlistOffer(waitlistId, staffId) {
    return db_1.db.transaction(async (tx) => {
        const waitlistResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, visit_id, checkin_block_id, desired_tier, resource_id, status FROM waitlist WHERE id = ${waitlistId} FOR UPDATE`);
        if (waitlistResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Waitlist entry not found');
        const waitlist = waitlistResult.rows[0];
        if (waitlist.status !== 'OFFERED')
            throw new HttpError_1.HttpError(400, `Cannot revoke — entry must be OFFERED (current: ${waitlist.status})`);
        // Revert to ACTIVE, clear the offered room
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE waitlist SET status = 'ACTIVE', resource_id = NULL, offer_expires_at = NULL, last_offered_at = NOW(), updated_at = NOW() WHERE id = ${waitlistId}`);
        // Release any inventory reservations for this waitlist hold
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE inventory_reservations SET released_at = NOW(), release_reason = 'REVOKED' WHERE released_at IS NULL AND kind = 'UPGRADE_HOLD' AND waitlist_id = ${waitlistId}`);
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'WAITLIST_OFFERED', entityType: 'waitlist', entityId: waitlistId, oldValue: { status: 'OFFERED', resourceId: waitlist.resource_id }, newValue: { status: 'ACTIVE', reason: 'Offer revoked by staff' } });
        return { waitlistId, status: 'ACTIVE' };
    });
}
