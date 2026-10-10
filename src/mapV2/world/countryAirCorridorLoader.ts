import { deltaDecodeQuantized } from '../geo/roadRuntimePackage';
import type { CompactPlayerAirCorridor, PlayerFacingAirCorridorArtifactV1 } from '../geo/playerFacingAirCorridor';
import { PLAYER_AIR_CORRIDOR_QUANTIZE } from '../geo/playerFacingAirCorridor';
import { inflateProjectedLine } from '../geo/transportGeometry';

let cached: PlayerFacingAirCorridorArtifactV1 | null = null;

/** Player preview only. Does not load turkey-airports.json or cargo QA. */
export function getTurkeyPlayerAirCorridors(): PlayerFacingAirCorridorArtifactV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/countryOverview/turkey-air-corridors.json') as PlayerFacingAirCorridorArtifactV1;
  return cached;
}

export function airCorridorProjectedPoints(corridor: CompactPlayerAirCorridor): { x: number; y: number }[] {
  return inflateProjectedLine(deltaDecodeQuantized(corridor.q), PLAYER_AIR_CORRIDOR_QUANTIZE);
}
