import type { CompactPlayerSeaCorridor } from '../geo/playerFacingSeaCorridor';
import type { CityAvailabilityState } from './cityProgression';
import { isCityAvailabilityOpen } from './cityProgression';

export const SEA_CORRIDOR_INTERACTION_STATES = [
  'SEA_DEFAULT',
  'SEA_CONNECTED_TO_SELECTED',
  'SEA_DIMMED',
  'SEA_UNAVAILABLE',
] as const;

export type SeaCorridorInteractionState = (typeof SEA_CORRIDOR_INTERACTION_STATES)[number];

export const SEA_CORRIDOR_INTERACTION_DRAW_ORDER: readonly SeaCorridorInteractionState[] = [
  'SEA_UNAVAILABLE',
  'SEA_DIMMED',
  'SEA_DEFAULT',
  'SEA_CONNECTED_TO_SELECTED',
];

export const SEA_CORRIDOR_SELECTION_FADE_MS = 220;

export function seaCorridorTouchesGeoCity(
  corridor: Pick<CompactPlayerSeaCorridor, 'fromGeoCityId' | 'toGeoCityId'>,
  geoCityId: string | null | undefined,
): boolean {
  if (!geoCityId) return false;
  return corridor.fromGeoCityId === geoCityId || corridor.toGeoCityId === geoCityId;
}

function corridorAvailabilityMuted(
  corridor: CompactPlayerSeaCorridor,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): boolean {
  const from = availabilityByGeoCityId?.[corridor.fromGeoCityId] ?? 'UNLOCKED';
  const to = availabilityByGeoCityId?.[corridor.toGeoCityId] ?? 'UNLOCKED';
  return !isCityAvailabilityOpen(from) || !isCityAvailabilityOpen(to);
}

export function resolveSeaCorridorInteractionState(input: {
  corridor: CompactPlayerSeaCorridor;
  selectedGeoCityId: string | null | undefined;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
}): SeaCorridorInteractionState {
  const muted = corridorAvailabilityMuted(input.corridor, input.availabilityByGeoCityId);
  const selected = input.selectedGeoCityId ?? null;
  if (!selected) return muted ? 'SEA_UNAVAILABLE' : 'SEA_DEFAULT';
  const connected = seaCorridorTouchesGeoCity(input.corridor, selected);
  if (connected) return muted ? 'SEA_UNAVAILABLE' : 'SEA_CONNECTED_TO_SELECTED';
  return muted ? 'SEA_UNAVAILABLE' : 'SEA_DIMMED';
}

export function groupSeaCorridorsByInteractionState(
  corridors: readonly CompactPlayerSeaCorridor[],
  selectedGeoCityId: string | null | undefined,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): Record<SeaCorridorInteractionState, CompactPlayerSeaCorridor[]> {
  const groups: Record<SeaCorridorInteractionState, CompactPlayerSeaCorridor[]> = {
    SEA_DEFAULT: [],
    SEA_CONNECTED_TO_SELECTED: [],
    SEA_DIMMED: [],
    SEA_UNAVAILABLE: [],
  };
  for (const corridor of corridors) {
    groups[resolveSeaCorridorInteractionState({ corridor, selectedGeoCityId, availabilityByGeoCityId })].push(corridor);
  }
  return groups;
}
