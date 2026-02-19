"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLaneFeatureFlags = getLaneFeatureFlags;
const DEFAULT_FLAGS = {
    lockstepV2Enabled: false,
    flowCommandsEnabled: false,
    lanFallbackEnabled: false,
    lanAuthoritativeEnabled: false,
};
async function getLaneFeatureFlags(client, laneId) {
    const globalLockstep = process.env.LOCKSTEP_V2 === 'true';
    const globalFlowCommands = process.env.FLOW_COMMANDS === 'true';
    const globalLanFallback = process.env.LAN_FALLBACK === 'true';
    const globalLanAuthoritative = process.env.LAN_AUTHORITATIVE === 'true';
    const result = await client.query(`SELECT lockstep_v2_enabled, flow_commands_enabled, lan_fallback_enabled, lan_authoritative_enabled
     FROM lane_feature_flags
     WHERE lane_id = $1
     LIMIT 1`, [laneId]);
    if (result.rows.length === 0) {
        return {
            ...DEFAULT_FLAGS,
            lockstepV2Enabled: globalLockstep,
            flowCommandsEnabled: globalFlowCommands,
            lanFallbackEnabled: globalLanFallback,
            lanAuthoritativeEnabled: globalLanAuthoritative,
        };
    }
    const row = result.rows[0];
    return {
        lockstepV2Enabled: row.lockstep_v2_enabled ?? globalLockstep,
        flowCommandsEnabled: row.flow_commands_enabled ?? globalFlowCommands,
        lanFallbackEnabled: row.lan_fallback_enabled ?? globalLanFallback,
        lanAuthoritativeEnabled: row.lan_authoritative_enabled ?? globalLanAuthoritative,
    };
}
