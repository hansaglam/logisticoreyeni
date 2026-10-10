import type { CompactPlayerAirCorridor } from '../geo/playerFacingAirCorridor';
import type { CityAvailabilityState } from './cityProgression';
import { isCityAvailabilityOpen } from './cityProgression';

export const AIR_CORRIDOR_INTERACTION_STATES = [
  'AIR_DEFAULT',
  'AIR_CONNECTED_TO_SELECTED',
  'AIR_DIMMED',
  'AIR_UNAVAILABLE',
] as const;

export type AirCorridorInteractionState = (typeof AIR_CORRIDOR_INTERACTION_STATES)[number];

export const AIR_CORRIDOR_INTERACTION_DRAW_ORDER: readonly AirCorridorInteractionState[] = [
  'AIR_UNAVAILABLE',
  'AIR_DIMMED',
  'AIR_DEFAULT',
  'AIR_CONNECTED_TO_SELECTED',
];

export function airCorridorTouchesGeoCity(
  corridor: Pick<CompactPlayerAirCorridor, 'fromGeoCityId' | 'toGeoCityId'>,
  geoCityId: string | null | undefined,
): boolean {
  if (!geoCityId) return false;
  return corridor.fromGeoCityId === geoCityId || corridor.toGeoCityId === geoCityId;
}

function corridorAvailabilityMuted(
  corridor: CompactPlayerAirCorridor,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): boolean {
  const from = availabilityByGeoCityId?.[corridor.fromGeoCityId] ?? 'UNLOCKED';
  const to = availabilityByGeoCityId?.[corridor.toGeoCityId] ?? 'UNLOCKED';
  return !isCityAvailabilityOpen(from) || !isCityAvailabilityOpen(to);
}

export function resolveAirCorridorInteractionState(input: {
  corridor: CompactPlayerAirCorridor;
  selectedGeoCityId: string | null | undefined;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
}): AirCorridorInteractionState {
  const muted = corridorAvailabilityMuted(input.corridor, input.availabilityByGeoCityId);
  const selected = input.selectedGeoCityId ?? null;
  if (!selected) return muted ? 'AIR_UNAVAILABLE' : 'AIR_DEFAULT';
  const connected = airCorridorTouchesGeoCity(input.corridor, selected);
  if (connected) return muted ? 'AIR_UNAVAILABLE' : 'AIR_CONNECTED_TO_SELECTED';
  return muted ? 'AIR_UNAVAILABLE' : 'AIR_DIMMED';
}

export function groupAirCorridorsByInteractionState(
  corridors: readonly CompactPlayerAirCorridor[],
  selectedGeoCityId: string | null | undefined,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): Record<AirCorridorInteractionState, CompactPlayerAirCorridor[]> {
  const groups: Record<AirCorridorInteractionState, CompactPlayerAirCorridor[]> = {
    AIR_DEFAULT: [],
    AIR_CONNECTED_TO_SELECTED: [],
    AIR_DIMMED: [],
    AIR_UNAVAILABLE: [],
  };
  for (const corridor of corridors) {
    groups[resolveAirCorridorInteractionState({ corridor, selectedGeoCityId, availabilityByGeoCityId })].push(corridor);
  }
  return groups;
}
