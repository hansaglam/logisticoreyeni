import type { CompactPlayerCorridor } from '../geo/playerFacingRoadCorridor';
import type { CityAvailabilityState } from './cityProgression';
import { corridorVisualState } from '../world/countryRoadCorridorLoader';

export const COUNTRY_CORRIDOR_INTERACTION_STATES = [
  'DEFAULT',
  'CONNECTED_TO_SELECTED',
  'DIMMED',
  'LOCKED_OR_MIXED',
  'LOCKED_AND_SELECTED_CONTEXT',
] as const;

export type CountryCorridorInteractionState = (typeof COUNTRY_CORRIDOR_INTERACTION_STATES)[number];

/** Dimmed / locked first; connected last so emphasis stays under city nodes. */
export const COUNTRY_CORRIDOR_INTERACTION_DRAW_ORDER: readonly CountryCorridorInteractionState[] = [
  'DIMMED',
  'LOCKED_OR_MIXED',
  'DEFAULT',
  'LOCKED_AND_SELECTED_CONTEXT',
  'CONNECTED_TO_SELECTED',
];

export const COUNTRY_CORRIDOR_SELECTION_FADE_MS = 220;

export function corridorTouchesGeoCity(
  corridor: Pick<CompactPlayerCorridor, 'fromGeoCityId' | 'toGeoCityId'>,
  geoCityId: string | null | undefined,
): boolean {
  if (!geoCityId) return false;
  return corridor.fromGeoCityId === geoCityId || corridor.toGeoCityId === geoCityId;
}

/**
 * Availability is resolved first. Selection only emphasizes or dims.
 * A locked corridor never receives the unlocked connected style.
 */
export function resolveCountryCorridorInteractionState(input: {
  corridor: CompactPlayerCorridor;
  selectedGeoCityId: string | null | undefined;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
}): CountryCorridorInteractionState {
  const availability = corridorVisualState(input.corridor, input.availabilityByGeoCityId);
  const lockedLike = availability === 'mixed' || availability === 'locked';
  const selected = input.selectedGeoCityId ?? null;
  if (!selected) return lockedLike ? 'LOCKED_OR_MIXED' : 'DEFAULT';
  const connected = corridorTouchesGeoCity(input.corridor, selected);
  if (connected) return lockedLike ? 'LOCKED_AND_SELECTED_CONTEXT' : 'CONNECTED_TO_SELECTED';
  return lockedLike ? 'LOCKED_OR_MIXED' : 'DIMMED';
}

export function groupCorridorsByInteractionState(
  corridors: readonly CompactPlayerCorridor[],
  selectedGeoCityId: string | null | undefined,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): Record<CountryCorridorInteractionState, CompactPlayerCorridor[]> {
  const groups: Record<CountryCorridorInteractionState, CompactPlayerCorridor[]> = {
    DEFAULT: [],
    CONNECTED_TO_SELECTED: [],
    DIMMED: [],
    LOCKED_OR_MIXED: [],
    LOCKED_AND_SELECTED_CONTEXT: [],
  };
  for (const corridor of corridors) {
    groups[resolveCountryCorridorInteractionState({ corridor, selectedGeoCityId, availabilityByGeoCityId })].push(corridor);
  }
  return groups;
}

export function connectedNeighborGeoCityIds(
  corridors: readonly CompactPlayerCorridor[],
  selectedGeoCityId: string | null | undefined,
): ReadonlySet<string> {
  const next = new Set<string>();
  if (!selectedGeoCityId) return next;
  for (const corridor of corridors) {
    if (!corridorTouchesGeoCity(corridor, selectedGeoCityId)) continue;
    if (corridor.fromGeoCityId !== selectedGeoCityId) next.add(corridor.fromGeoCityId);
    if (corridor.toGeoCityId !== selectedGeoCityId) next.add(corridor.toGeoCityId);
  }
  return next;
}
