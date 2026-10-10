import type { CityAvailabilityState } from '../gameplay/cityProgression';
import { isCityAvailabilityOpen } from '../gameplay/cityProgression';
import { deltaDecodeQuantized } from '../geo/roadRuntimePackage';
import type { CompactPlayerCorridor, PlayerFacingRoadCorridorArtifactV1 } from '../geo/playerFacingRoadCorridor';
import { PLAYER_ROAD_CORRIDOR_QUANTIZE } from '../geo/playerFacingRoadCorridor';
import { inflateProjectedLine } from '../geo/transportGeometry';

let cached: PlayerFacingRoadCorridorArtifactV1 | null = null;

export function getTurkeyPlayerRoadCorridors(): PlayerFacingRoadCorridorArtifactV1 {
  if (cached) return cached;
  // Bundled player artifact. Not the canonical ROAD graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/countryOverview/turkey-road-corridors.json') as PlayerFacingRoadCorridorArtifactV1;
  return cached;
}

export type PlayerCorridorVisualState = 'open' | 'mixed' | 'locked';

export function corridorVisualState(
  corridor: CompactPlayerCorridor,
  availabilityByGeoCityId: Readonly<Record<string, CityAvailabilityState>> | undefined,
): PlayerCorridorVisualState {
  const from = availabilityByGeoCityId?.[corridor.fromGeoCityId] ?? 'UNLOCKED';
  const to = availabilityByGeoCityId?.[corridor.toGeoCityId] ?? 'UNLOCKED';
  const fromOpen = isCityAvailabilityOpen(from);
  const toOpen = isCityAvailabilityOpen(to);
  if (fromOpen && toOpen) return 'open';
  if (!fromOpen && !toOpen) return 'locked';
  return 'mixed';
}

export function corridorProjectedPoints(corridor: CompactPlayerCorridor): { x: number; y: number }[] {
  return inflateProjectedLine(deltaDecodeQuantized(corridor.q), PLAYER_ROAD_CORRIDOR_QUANTIZE);
}
