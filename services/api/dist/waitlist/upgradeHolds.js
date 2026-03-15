"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processUpgradeHoldsTick = processUpgradeHoldsTick;
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Periodic tick that expires timed waitlist offers/holds
 * (waitlist.status=OFFERED + offer_expires_at elapsed).
 *
 * Rooms are NO LONGER auto-offered — employees use the Offer Room button.
 */
async function processUpgradeHoldsTick(fastify, options) {
    const expireBatchSize = options?.expireBatchSize ?? 25;
    const result = await db_1.db.transaction(async (tx) => {
        const expired = await tx.execute((0, drizzle_orm_1.sql) `
      SELECT
        w.id as waitlist_id,
        w.desired_tier::text as desired_tier,
        COALESCE(c.name, 'Customer') as customer_name,
        w.resource_id as resource_id,
        COALESCE(r.number, '(unknown)') as room_number
      FROM waitlist w
      JOIN visits v ON v.id = w.visit_id
      JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
      LEFT JOIN customers c ON c.id = v.customer_id
      LEFT JOIN inventory_resources r ON r.id = w.resource_id
      WHERE w.status = 'OFFERED'
        AND w.resource_id IS NOT NULL
        AND w.offer_expires_at IS NOT NULL
        AND w.offer_expires_at <= NOW()
        AND v.ended_at IS NULL
        AND cb.ends_at > NOW()
      ORDER BY w.offer_expires_at ASC
      LIMIT ${expireBatchSize}
      FOR UPDATE OF w SKIP LOCKED
      `);
        const expiredPayloads = [];
        for (const row of expired.rows) {
            // Revert entry back to ACTIVE but keep it in place; record last_offered_at for fair rotation.
            await tx.execute((0, drizzle_orm_1.sql) `
        UPDATE waitlist
        SET status = 'ACTIVE',
            resource_id = NULL,
            offer_expires_at = NULL,
            last_offered_at = NOW(),
            updated_at = NOW()
        WHERE id = ${row.waitlist_id}
        `);
            // Release reservation (best-effort; should exist for UPGRADE_HOLD).
            await tx.execute((0, drizzle_orm_1.sql) `
        UPDATE inventory_reservations
        SET released_at = NOW(),
            release_reason = 'EXPIRED'
        WHERE released_at IS NULL
          AND kind = 'UPGRADE_HOLD'
          AND waitlist_id = ${row.waitlist_id}
        `);
            expiredPayloads.push({
                waitlistId: row.waitlist_id,
                customerName: row.customer_name,
                desiredTier: row.desired_tier,
                resourceId: row.resource_id,
                roomNumber: row.room_number,
            });
        }
        return {
            expiredPayloads,
        };
    }, { isolationLevel: 'serializable' });
    // Broadcast AFTER commit so any refetch-on-event sees updated DB rows.
    for (const payload of result.expiredPayloads) {
        fastify.broadcaster?.broadcast({
            type: 'UPGRADE_OFFER_EXPIRED',
            payload,
            timestamp: new Date().toISOString(),
        });
        fastify.broadcaster?.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: { waitlistId: payload.waitlistId, status: 'ACTIVE' },
            timestamp: new Date().toISOString(),
        });
    }
    return { expired: result.expiredPayloads.length };
}
