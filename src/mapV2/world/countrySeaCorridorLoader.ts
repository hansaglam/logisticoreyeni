import { deltaDecodeQuantized } from '../geo/roadRuntimePackage';
import type { CompactPlayerSeaCorridor, PlayerFacingSeaCorridorArtifactV1 } from '../geo/playerFacingSeaCorridor';
import { PLAYER_SEA_CORRIDOR_QUANTIZE } from '../geo/playerFacingSeaCorridor';
import { inflateProjectedLine } from '../geo/transportGeometry';

let cached: PlayerFacingSeaCorridorArtifactV1 | null = null;

export function getTurkeyPlayerSeaCorridors(): PlayerFacingSeaCorridorArtifactV1 {
  if (cached) return cached;
  // Bundled player artifact. Not the canonical SEA graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/countryOverview/turkey-sea-corridors.json') as PlayerFacingSeaCorridorArtifactV1;
  return cached;
}

export function seaCorridorProjectedPoints(corridor: CompactPlayerSeaCorridor): { x: number; y: number }[] {
  return inflateProjectedLine(deltaDecodeQuantized(corridor.q), PLAYER_SEA_CORRIDOR_QUANTIZE);
}
