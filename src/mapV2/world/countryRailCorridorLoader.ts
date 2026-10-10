import { deltaDecodeQuantized } from '../geo/roadRuntimePackage';
import type { CompactPlayerRailCorridor, PlayerFacingRailCorridorArtifactV1 } from '../geo/playerFacingRailCorridor';
import { PLAYER_RAIL_CORRIDOR_QUANTIZE } from '../geo/playerFacingRailCorridor';
import { inflateProjectedLine } from '../geo/transportGeometry';

let cached: PlayerFacingRailCorridorArtifactV1 | null = null;

export function getTurkeyPlayerRailCorridors(): PlayerFacingRailCorridorArtifactV1 {
  if (cached) return cached;
  // Bundled player artifact. Not the canonical RAIL graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/countryOverview/turkey-rail-corridors.json') as PlayerFacingRailCorridorArtifactV1;
  return cached;
}

export function railCorridorProjectedPoints(corridor: CompactPlayerRailCorridor): { x: number; y: number }[] {
  return inflateProjectedLine(deltaDecodeQuantized(corridor.q), PLAYER_RAIL_CORRIDOR_QUANTIZE);
}
