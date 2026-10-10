/**
 * DEV fixture planner: enumerates valid high-level mode sequences.
 * No cost/time/profit ranking. Max 4 transport-leg tokens in a sequence.
 */
import type { MapV2TransportMode } from '../domain/transport';
import {
  formatModeSequence,
  MULTIMODAL_MAX_TRANSPORT_LEGS,
  type MultimodalFoundationView,
  type TransferCapability,
} from '../domain/multimodal';
import { cityHasCapability, cityModeRow } from './multimodalFoundation';

const MODE_TO_TRANSFER: Record<Exclude<MapV2TransportMode, 'ROAD'>, TransferCapability> = {
  RAIL: 'ROAD_TO_RAIL',
  SEA: 'ROAD_TO_SEA',
  AIR: 'ROAD_TO_AIR',
};

function cityHasMode(
  view: MultimodalFoundationView,
  cityId: string,
  mode: MapV2TransportMode,
): boolean {
  const row = cityModeRow(view, cityId);
  if (!row) return false;
  if (mode === 'ROAD') return row.ROAD === 'ACTIVE' || row.ROAD === 'PROVISIONAL';
  if (mode === 'RAIL') return row.RAIL === 'PROVISIONAL' || row.RAIL === 'ACTIVE';
  if (mode === 'SEA') return row.SEA === 'PROVISIONAL' || row.SEA === 'ACTIVE';
  return row.AIR === 'PROVISIONAL' || row.AIR === 'ACTIVE';
}

export type MultimodalPlanSequence = {
  sequence: string;
  modes: readonly MapV2TransportMode[];
  intercityLegs: number;
};

function canUseHop(
  view: MultimodalFoundationView,
  cityId: string,
  mode: Exclude<MapV2TransportMode, 'ROAD'>,
): boolean {
  return cityHasMode(view, cityId, mode) && cityHasCapability(view, cityId, MODE_TO_TRANSFER[mode]);
}

/**
 * Topological possibilities only. Direct ROAD remains valid.
 * Does not score, recommend, or persist plans.
 */
export function enumerateMultimodalModeSequences(input: {
  foundation: MultimodalFoundationView;
  originCityId: string;
  destinationCityId: string;
  allowedModes?: readonly MapV2TransportMode[];
}): MultimodalPlanSequence[] {
  const { foundation, originCityId, destinationCityId } = input;
  const allowed = new Set(input.allowedModes ?? (['ROAD', 'RAIL', 'SEA', 'AIR'] as const));
  if (originCityId === destinationCityId) return [];

  const out: MultimodalPlanSequence[] = [];
  const push = (modes: MapV2TransportMode[], intercityLegs: number) => {
    if (modes.length > MULTIMODAL_MAX_TRANSPORT_LEGS) return;
    if (modes.some((mode) => !allowed.has(mode))) return;
    out.push({ sequence: formatModeSequence(modes), modes, intercityLegs });
  };

  if (
    allowed.has('ROAD') &&
    cityHasMode(foundation, originCityId, 'ROAD') &&
    cityHasMode(foundation, destinationCityId, 'ROAD')
  ) {
    push(['ROAD'], 1);
  }

  for (const mode of ['RAIL', 'SEA', 'AIR'] as const) {
    if (!allowed.has(mode) || !allowed.has('ROAD')) continue;
    if (canUseHop(foundation, originCityId, mode) && canUseHop(foundation, destinationCityId, mode)) {
      push(['ROAD', mode, 'ROAD'], 1);
    }
  }

  out.sort((a, b) => a.sequence.localeCompare(b.sequence));
  return out;
}
