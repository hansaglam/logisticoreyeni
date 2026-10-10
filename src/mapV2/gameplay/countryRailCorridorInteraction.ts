import type { CompactPlayerRailCorridor } from '../geo/playerFacingRailCorridor';
import type { CityAvailabilityState } from './cityProgression';
import { isCityAvailabilityOpen } from './cityProgression';

export const RAIL_CORRIDOR_INTERACTION_STATES = [
  'RAIL_DEFAULT',
  'RAIL_CONNECTED_TO_SELECTED',
  'RAIL_DIMMED',
  'RAIL_UNAVAILABLE',
] as const;

export type RailCorridorInteractionState = (typeof RAIL_CORRIDOR_INTERACTION_STATES)[number];

export const RAIL_CORRIDOR_INTERACTION_DRAW_ORDER: readonly RailCorridorInteractionState[] = [
  'RAIL_UNAVAILABLE',
  'RAIL_DIMMED',
  'RAIL_DEFAULT',
  'RAIL_CONNECTED_TO_SELECTED',
];

export const RAIL_CORRIDOR_SELECTION_FADE_MS = 220;

export function railCorridorTouchesGeoCity(
  corridor: Pick<CompactPlayerRailCorridor, 'fromGeoCityId' | 'toGeoCityId'>,
  geoCityId: string | null | undefined,
): boolean {
  if (!geoCityId) return false;
  return corridor.fromGeoCityId === geoCityId || corridor.toGeoCityId === geoCityId;
}

function corridorAvailabilityMuted(
  corridor: CompactPlayerRailCorridor,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): boolean {
  const from = availabilityByGeoCityId?.[corridor.fromGeoCityId] ?? 'UNLOCKED';
  const to = availabilityByGeoCityId?.[corridor.toGeoCityId] ?? 'UNLOCKED';
  return !isCityAvailabilityOpen(from) || !isCityAvailabilityOpen(to);
}

export function resolveRailCorridorInteractionState(input: {
  corridor: CompactPlayerRailCorridor;
  selectedGeoCityId: string | null | undefined;
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>;
}): RailCorridorInteractionState {
  const muted = corridorAvailabilityMuted(input.corridor, input.availabilityByGeoCityId);
  const selected = input.selectedGeoCityId ?? null;
  if (!selected) return muted ? 'RAIL_UNAVAILABLE' : 'RAIL_DEFAULT';
  const connected = railCorridorTouchesGeoCity(input.corridor, selected);
  if (connected) return muted ? 'RAIL_UNAVAILABLE' : 'RAIL_CONNECTED_TO_SELECTED';
  return muted ? 'RAIL_UNAVAILABLE' : 'RAIL_DIMMED';
}

export function groupRailCorridorsByInteractionState(
  corridors: readonly CompactPlayerRailCorridor[],
  selectedGeoCityId: string | null | undefined,
  availabilityByGeoCityId?: Readonly<Record<string, CityAvailabilityState>>,
): Record<RailCorridorInteractionState, CompactPlayerRailCorridor[]> {
  const groups: Record<RailCorridorInteractionState, CompactPlayerRailCorridor[]> = {
    RAIL_DEFAULT: [],
    RAIL_CONNECTED_TO_SELECTED: [],
    RAIL_DIMMED: [],
    RAIL_UNAVAILABLE: [],
  };
  for (const corridor of corridors) {
    groups[resolveRailCorridorInteractionState({ corridor, selectedGeoCityId, availabilityByGeoCityId })].push(
      corridor,
    );
  }
  return groups;
}

export function railConnectedNeighborGeoCityIds(
  corridors: readonly CompactPlayerRailCorridor[],
  selectedGeoCityId: string | null | undefined,
): ReadonlySet<string> {
  const next = new Set<string>();
  if (!selectedGeoCityId) return next;
  for (const corridor of corridors) {
    if (!railCorridorTouchesGeoCity(corridor, selectedGeoCityId)) continue;
    if (corridor.fromGeoCityId !== selectedGeoCityId) next.add(corridor.fromGeoCityId);
    if (corridor.toGeoCityId !== selectedGeoCityId) next.add(corridor.toGeoCityId);
  }
  return next;
}
