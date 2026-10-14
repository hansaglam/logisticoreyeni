import { mapVisualTokens } from './mapVisualTokens';

export type CityMarkerState =
  | 'DEFAULT'
  | 'AVAILABLE'
  | 'SELECTED'
  | 'LOCKED'
  | 'ACTIVE_OPERATION'
  | 'WARNING'
  | 'HUB';

export type CityMarkerVisual = {
  state: CityMarkerState;
  fill: string;
  core: string;
  ring: string;
  halo: string;
  radiusScale: number;
};

export function resolveCityMarkerState(input: {
  selected?: boolean;
  locked?: boolean;
  capital?: boolean;
  active?: boolean;
  warning?: boolean;
  available?: boolean;
}): CityMarkerState {
  if (input.selected) return 'SELECTED';
  if (input.warning) return 'WARNING';
  if (input.locked) return 'LOCKED';
  if (input.active) return 'ACTIVE_OPERATION';
  if (input.capital) return 'HUB';
  if (input.available) return 'AVAILABLE';
  return 'DEFAULT';
}

export function cityMarkerPriority(state: CityMarkerState): number {
  if (state === 'SELECTED') return 100;
  if (state === 'ACTIVE_OPERATION') return 80;
  if (state === 'HUB') return 70;
  if (state === 'AVAILABLE') return 60;
  if (state === 'WARNING') return 50;
  if (state === 'DEFAULT') return 40;
  return 10;
}

export function resolveCityMarkerVisual(state: CityMarkerState): CityMarkerVisual {
  if (state === 'SELECTED') {
    return {
      state,
      fill: mapVisualTokens.citySelected,
      core: '#FFFFFF',
      ring: mapVisualTokens.selectionOutline,
      halo: mapVisualTokens.cityHalo,
      radiusScale: 1.18,
    };
  }
  if (state === 'LOCKED') {
    return {
      state,
      fill: '#1A2A3A',
      core: mapVisualTokens.cityLocked,
      ring: 'rgba(110, 132, 156, 0.45)',
      halo: 'transparent',
      radiusScale: 0.92,
    };
  }
  if (state === 'WARNING') {
    return {
      state,
      fill: mapVisualTokens.cityWarning,
      core: '#FFF6E4',
      ring: 'rgba(226, 177, 90, 0.7)',
      halo: 'rgba(226, 177, 90, 0.18)',
      radiusScale: 1,
    };
  }
  if (state === 'ACTIVE_OPERATION') {
    return {
      state,
      fill: mapVisualTokens.roadPrimary,
      core: '#F4FBFF',
      ring: 'rgba(61, 220, 255, 0.85)',
      halo: 'transparent',
      radiusScale: 1.04,
    };
  }
  if (state === 'HUB') {
    return {
      state,
      fill: mapVisualTokens.cityDefault,
      core: '#F4FBFF',
      ring: 'rgba(186, 236, 255, 0.8)',
      halo: 'transparent',
      radiusScale: 1.08,
    };
  }
  if (state === 'AVAILABLE') {
    return {
      state,
      fill: mapVisualTokens.cityDefault,
      core: '#F4FBFF',
      ring: 'rgba(126, 231, 245, 0.72)',
      halo: 'transparent',
      radiusScale: 1,
    };
  }
  return {
    state,
    fill: mapVisualTokens.cityDefault,
    core: '#F4FBFF',
    ring: 'rgba(126, 231, 245, 0.55)',
    halo: 'transparent',
    radiusScale: 1,
  };
}
