"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoomTier = getRoomTier;
exports.computeWaitlistInfo = computeWaitlistInfo;
const shared_1 = require("@the-clubs/shared");
function getRoomTier(roomNumber) {
    return (0, shared_1.getRoomTierFromNumber)(Number.parseInt(roomNumber, 10));
}
/**
 * Compute waitlist position and ETA for a desired tier.
 * Position is 1-based. ETA is computed from Nth occupied block's end time + 15 min buffer.
 */
async function computeWaitlistInfo(client, desiredTier) {
    // Count active waitlist entries for this tier (position = count + 1)
    const waitlistCountResult = await client.query(`SELECT COUNT(*) as count FROM waitlist 
     WHERE desired_tier = $1 AND status = 'ACTIVE'`, [desiredTier]);
    const position = Number.parseInt(waitlistCountResult.rows[0]?.count || '0', 10) + 1;
    // ETA: Find the Nth upcoming ROOM block that could free inventory for the desired tier.
    //
    // IMPORTANT: We must filter by tier. A naive "Nth block by end time" is wrong when multiple
    // tiers are occupied with different end times.
    //
    // We compute tier using facility contract mapping (by room number), not DB room.type.
    const blocksResult = await client.query(`SELECT cb.ends_at, r.number as room_number
     FROM checkin_blocks cb
     JOIN visits v ON v.id = cb.visit_id
     JOIN rooms r ON r.id = cb.room_id
     WHERE cb.ends_at > NOW()
       AND v.ended_at IS NULL
     ORDER BY cb.ends_at ASC`, []);
    let estimatedReadyAt = null;
    // Find the (position)th block of the desired tier.
    const matches = [];
    for (const row of blocksResult.rows) {
        const n = Number.parseInt(String(row.room_number), 10);
        if (!Number.isFinite(n))
            continue;
        if (getRoomTier(String(n)) !== desiredTier)
            continue;
        matches.push({ endsAt: row.ends_at });
        if (matches.length >= position)
            break;
    }
    if (matches.length >= position) {
        // Found Nth matching block - ETA = block end + 15 min buffer
        const nth = matches[position - 1];
        estimatedReadyAt = new Date(nth.endsAt.getTime() + 15 * 60 * 1000);
    }
    return { position, estimatedReadyAt };
}
