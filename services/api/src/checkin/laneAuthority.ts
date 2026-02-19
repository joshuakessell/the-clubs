import type { PoolClient } from 'pg';

import { getLaneFeatureFlags } from './laneFeatureFlags';

export type LaneAuthority = {
  allowed: boolean;
  reason?: string;
};

export async function assertLaneWriteAuthority(params: {
  client: PoolClient;
  laneId: string;
}): Promise<LaneAuthority> {
  const globalLanFallback = process.env.LAN_FALLBACK === 'true';
  const globalLanAuthoritative = process.env.LAN_AUTHORITATIVE === 'true';

  if (!globalLanFallback) {
    return { allowed: true };
  }

  const flags = await getLaneFeatureFlags(params.client, params.laneId);

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
