"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertLaneWriteAuthority = assertLaneWriteAuthority;
const laneFeatureFlags_1 = require("./laneFeatureFlags");
async function assertLaneWriteAuthority(params) {
    const globalLanFallback = process.env.LAN_FALLBACK === 'true';
    const globalLanAuthoritative = process.env.LAN_AUTHORITATIVE === 'true';
    if (!globalLanFallback) {
        return { allowed: true };
    }
    const flags = await (0, laneFeatureFlags_1.getLaneFeatureFlags)(params.client, params.laneId);
    // If a lane isn't participating in LAN fallback, don't apply authority checks.
    if (!flags.lanFallbackEnabled) {
        return { allowed: true };
    }
    const authoritativeEnabled = flags.lanAuthoritativeEnabled || globalLanAuthoritative;
    if (!authoritativeEnabled) {
        return { allowed: true };
    }
    // Minimal enforceable rule:
    // - When LAN fallback is active and the lane is configured as authoritative, only the edge stack should accept
    //   writes for that lane.
    // - The edge stack identifies itself via EDGE_STACK=true.
    const isEdge = process.env.EDGE_STACK === 'true';
    if (!isEdge) {
        return {
            allowed: false,
            reason: 'Lane is LAN-authoritative; cloud writes are disabled for this lane while LAN fallback is enabled.',
        };
    }
    return { allowed: true };
}
