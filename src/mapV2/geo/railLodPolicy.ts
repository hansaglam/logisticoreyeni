import type { TransportNetworkLod } from './transportNetwork';
import { isRailServiceDetail, OSM_RAIL_USAGE_HIGH } from './railClassPolicy';

export const RAIL_LOD_POLICY_ID = 'tur-osm-rail-lod-v1' as const;

/**
 * LOW: mainline / nationally relevant (usage=main, or untagged operational rail).
 * MEDIUM: + branch.
 * HIGH: industrial/military/tourism + yard/siding/spur detail.
 */
export function railLodForAttributes(usage: string | null | undefined, service: string | null | undefined): TransportNetworkLod {
  if (isRailServiceDetail(service)) return 'NETWORK_HIGH';
  if (usage && (OSM_RAIL_USAGE_HIGH as readonly string[]).includes(usage)) return 'NETWORK_HIGH';
  if (usage === 'branch') return 'NETWORK_MEDIUM';
  return 'NETWORK_LOW';
}

/** Normalized-world DP tolerances. Endpoints always kept. */
export const RAIL_SIMPLIFY_TOLERANCE: Record<TransportNetworkLod, number> = {
  NETWORK_LOW: 0.000001,
  NETWORK_MEDIUM: 0.0000006,
  NETWORK_HIGH: 0.0000003,
};
