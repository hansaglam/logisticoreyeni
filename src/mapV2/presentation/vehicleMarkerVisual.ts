import type { TruckStatus } from '../../types/game';
import type { MapLod } from './mapLodPolicy';
import { mapVisualTokens } from './mapVisualTokens';

export type FleetMarkerVisualState =
  | 'AVAILABLE'
  | 'ON_ROUTE'
  | 'MAINTENANCE'
  | 'OUT_OF_FUEL'
  | 'TRANSFERRING'
  | 'MARKETPLACE_LOCKED'
  | 'SELECTED';

const COLORS: Record<Exclude<FleetMarkerVisualState, 'SELECTED'>, string> = {
  AVAILABLE: mapVisualTokens.fleetAvailable,
  ON_ROUTE: mapVisualTokens.fleetOnRoute,
  MAINTENANCE: mapVisualTokens.fleetMaintenance,
  OUT_OF_FUEL: mapVisualTokens.fleetOutOfFuel,
  TRANSFERRING: mapVisualTokens.fleetTransfer,
  MARKETPLACE_LOCKED: mapVisualTokens.fleetLocked,
};

export function markerStateForTruckStatus(status: TruckStatus): Exclude<FleetMarkerVisualState, 'SELECTED'> {
  switch (status) {
    case 'on_route':
      return 'ON_ROUTE';
    case 'maintenance':
      return 'MAINTENANCE';
    case 'out_of_fuel':
      return 'OUT_OF_FUEL';
    case 'transferring':
      return 'TRANSFERRING';
    case 'marketplace_locked':
      return 'MARKETPLACE_LOCKED';
    case 'idle':
    default:
      return 'AVAILABLE';
  }
}

export function resolveVehicleMarkerPaint(input: {
  state: Exclude<FleetMarkerVisualState, 'SELECTED'>;
  lod: MapLod;
  selected: boolean;
  muted: boolean;
}): { color: string; radius: number; ring: string | null; opacity: number } {
  const radius =
    input.lod === 'COUNTRY_DETAIL' ? 5.2 : input.lod === 'COUNTRY_OPERATIONS' ? 4.6 : input.lod === 'COUNTRY_OVERVIEW' ? 3.6 : 6.4;
  return {
    color: COLORS[input.state],
    radius: input.selected ? radius + 0.8 : radius,
    ring: input.selected ? mapVisualTokens.selectionOutline : null,
    opacity: input.muted ? 0.38 : 1,
  };
}
