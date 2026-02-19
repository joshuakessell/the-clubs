import type { PoolClient } from 'pg';

export type LaneFeatureFlags = {
  lockstepV2Enabled: boolean;
  flowCommandsEnabled: boolean;
  lanFallbackEnabled: boolean;
  lanAuthoritativeEnabled: boolean;
};

const DEFAULT_FLAGS: LaneFeatureFlags = {
  lockstepV2Enabled: false,
  flowCommandsEnabled: false,
  lanFallbackEnabled: false,
  lanAuthoritativeEnabled: false,
};

export async function getLaneFeatureFlags(
  client: PoolClient,
  laneId: string
): Promise<LaneFeatureFlags> {
  const globalLockstep = process.env.LOCKSTEP_V2 === 'true';
  const globalFlowCommands = process.env.FLOW_COMMANDS === 'true';
  const globalLanFallback = process.env.LAN_FALLBACK === 'true';
  const globalLanAuthoritative = process.env.LAN_AUTHORITATIVE === 'true';

  const result = await client.query<{
    lockstep_v2_enabled: boolean | null;
    flow_commands_enabled: boolean | null;
    lan_fallback_enabled: boolean | null;
    lan_authoritative_enabled: boolean | null;
  }>(
    `SELECT lockstep_v2_enabled, flow_commands_enabled, lan_fallback_enabled, lan_authoritative_enabled
     FROM lane_feature_flags
     WHERE lane_id = $1
     LIMIT 1`,
    [laneId]
  );

  if (result.rows.length === 0) {
    return {
      ...DEFAULT_FLAGS,
      lockstepV2Enabled: globalLockstep,
      flowCommandsEnabled: globalFlowCommands,
      lanFallbackEnabled: globalLanFallback,
      lanAuthoritativeEnabled: globalLanAuthoritative,
    };
  }

  const row = result.rows[0]!;
  return {
    lockstepV2Enabled: row.lockstep_v2_enabled ?? globalLockstep,
    flowCommandsEnabled: row.flow_commands_enabled ?? globalFlowCommands,
    lanFallbackEnabled: row.lan_fallback_enabled ?? globalLanFallback,
    lanAuthoritativeEnabled: row.lan_authoritative_enabled ?? globalLanAuthoritative,
  };
}
