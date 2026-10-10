import type { TransportNetworkLod } from './transportNetwork';
import { highwayBase } from './roadClassPolicy';

export const ROAD_LOD_POLICY_ID = 'tur-osm-road-lod-v1' as const;

/** LOW = motorway/trunk. MEDIUM adds primary. HIGH adds secondary. */
export function roadLodForHighway(highway: string | undefined): TransportNetworkLod {
  const base = highwayBase(highway);
  if (base === 'motorway' || base === 'trunk') return 'NETWORK_LOW';
  if (base === 'primary') return 'NETWORK_MEDIUM';
  return 'NETWORK_HIGH';
}

/** Normalized-world DP tolerances (~40 m / 24 m / 12 m). Coarser values collapsed parallel carriageways. */
export const ROAD_SIMPLIFY_TOLERANCE: Record<TransportNetworkLod, number> = {
  NETWORK_LOW: 0.000001,
  NETWORK_MEDIUM: 0.0000006,
  NETWORK_HIGH: 0.0000003,
};
