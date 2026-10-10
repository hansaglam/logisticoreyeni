import type { SeaCorridorInteractionState } from '../gameplay/countrySeaCorridorInteraction';

/** Restrained desaturated maritime blue. Distinct from ROAD steel, RAIL pale steel, and water fill. */
export const COUNTRY_SEA_CORRIDOR_BASE = 'rgba(18, 28, 36, 0.88)';
export const COUNTRY_SEA_CORRIDOR_MAIN = '#7E93A3';
export const COUNTRY_SEA_CORRIDOR_HIGHLIGHT = 'rgba(126, 147, 163, 0.18)';
export const COUNTRY_SEA_CORRIDOR_CONNECTED = '#8FA4B3';
export const COUNTRY_SEA_CORRIDOR_UNAVAILABLE = '#4E5C66';
export const COUNTRY_SEA_CORRIDOR_WIDTH_BASE = 0.00022;
export const COUNTRY_SEA_CORRIDOR_WIDTH_MAIN = 0.00012;
export const COUNTRY_SEA_CORRIDOR_WIDTH_CONNECTED = 0.00014;
export const COUNTRY_SEA_CORRIDOR_WIDTH_HIGHLIGHT = 0.000045;
export const COUNTRY_SEA_CORRIDOR_DIMMED_OPACITY = 0.4;

export type CountrySeaCorridorStrokeLayer = { color: string; width: number };

export function seaCorridorInteractionPaint(state: SeaCorridorInteractionState): {
  opacity: number;
  strokes: readonly CountrySeaCorridorStrokeLayer[];
} {
  if (state === 'SEA_CONNECTED_TO_SELECTED') {
    return {
      opacity: 1,
      strokes: [
        { color: COUNTRY_SEA_CORRIDOR_BASE, width: COUNTRY_SEA_CORRIDOR_WIDTH_BASE },
        { color: COUNTRY_SEA_CORRIDOR_CONNECTED, width: COUNTRY_SEA_CORRIDOR_WIDTH_CONNECTED },
        { color: COUNTRY_SEA_CORRIDOR_HIGHLIGHT, width: COUNTRY_SEA_CORRIDOR_WIDTH_HIGHLIGHT },
      ],
    };
  }
  if (state === 'SEA_DIMMED') {
    return {
      opacity: COUNTRY_SEA_CORRIDOR_DIMMED_OPACITY,
      strokes: [{ color: COUNTRY_SEA_CORRIDOR_MAIN, width: COUNTRY_SEA_CORRIDOR_WIDTH_MAIN }],
    };
  }
  if (state === 'SEA_UNAVAILABLE') {
    return {
      opacity: 0.7,
      strokes: [{ color: COUNTRY_SEA_CORRIDOR_UNAVAILABLE, width: COUNTRY_SEA_CORRIDOR_WIDTH_MAIN }],
    };
  }
  return {
    opacity: 1,
    strokes: [
      { color: COUNTRY_SEA_CORRIDOR_BASE, width: COUNTRY_SEA_CORRIDOR_WIDTH_BASE },
      { color: COUNTRY_SEA_CORRIDOR_MAIN, width: COUNTRY_SEA_CORRIDOR_WIDTH_MAIN },
      { color: COUNTRY_SEA_CORRIDOR_HIGHLIGHT, width: COUNTRY_SEA_CORRIDOR_WIDTH_HIGHLIGHT },
    ],
  };
}
