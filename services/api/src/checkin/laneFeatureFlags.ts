import type { DrizzleTx } from '../db';
import { eq } from 'drizzle-orm';
import { laneFeatureFlags } from '../db/schema/schema';

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
  tx: DrizzleTx,
  laneId: string
): Promise<LaneFeatureFlags> {
  const globalLockstep = process.env.LOCKSTEP_V2 === 'true';
  const globalFlowCommands = process.env.FLOW_COMMANDS === 'true';
  const globalLanFallback = process.env.LAN_FALLBACK === 'true';
  const globalLanAuthoritative = process.env.LAN_AUTHORITATIVE === 'true';

  const result = await tx
    .select({
      lockstepV2Enabled: laneFeatureFlags.lockstepV2Enabled,
      flowCommandsEnabled: laneFeatureFlags.flowCommandsEnabled,
      lanFallbackEnabled: laneFeatureFlags.lanFallbackEnabled,
      lanAuthoritativeEnabled: laneFeatureFlags.lanAuthoritativeEnabled,
    })
    .from(laneFeatureFlags)
    .where(eq(laneFeatureFlags.laneId, laneId))
    .limit(1);

  if (result.length === 0) {
    return {
      ...DEFAULT_FLAGS,
      lockstepV2Enabled: globalLockstep,
      flowCommandsEnabled: globalFlowCommands,
      lanFallbackEnabled: globalLanFallback,
      lanAuthoritativeEnabled: globalLanAuthoritative,
    };
  }

  const row = result[0]!;
  return {
    lockstepV2Enabled: row.lockstepV2Enabled ?? globalLockstep,
    flowCommandsEnabled: row.flowCommandsEnabled ?? globalFlowCommands,
    lanFallbackEnabled: row.lanFallbackEnabled ?? globalLanFallback,
    lanAuthoritativeEnabled: row.lanAuthoritativeEnabled ?? globalLanAuthoritative,
  };
}
