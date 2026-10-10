import type { RailCorridorInteractionState } from '../gameplay/countryRailCorridorInteraction';

/** Cool pale steel. Distinct from warm ROAD corridors. Not cyan. Not a river. */
export const COUNTRY_RAIL_CORRIDOR_BASE = 'rgba(14, 20, 28, 0.9)';
export const COUNTRY_RAIL_CORRIDOR_MAIN = '#B7C2CC';
export const COUNTRY_RAIL_CORRIDOR_HIGHLIGHT = 'rgba(186, 198, 210, 0.22)';
export const COUNTRY_RAIL_CORRIDOR_CONNECTED = '#C5D0D8';
export const COUNTRY_RAIL_CORRIDOR_UNAVAILABLE = '#5A6570';
export const COUNTRY_RAIL_CORRIDOR_WIDTH_BASE = 0.0002;
export const COUNTRY_RAIL_CORRIDOR_WIDTH_MAIN = 0.00011;
export const COUNTRY_RAIL_CORRIDOR_WIDTH_CONNECTED = 0.00013;
export const COUNTRY_RAIL_CORRIDOR_WIDTH_HIGHLIGHT = 0.00005;
export const COUNTRY_RAIL_CORRIDOR_DIMMED_OPACITY = 0.42;

export type CountryRailCorridorStrokeLayer = { color: string; width: number };

export function railCorridorInteractionPaint(state: RailCorridorInteractionState): {
  opacity: number;
  strokes: readonly CountryRailCorridorStrokeLayer[];
} {
  if (state === 'RAIL_CONNECTED_TO_SELECTED') {
    return {
      opacity: 1,
      strokes: [
        { color: COUNTRY_RAIL_CORRIDOR_BASE, width: COUNTRY_RAIL_CORRIDOR_WIDTH_BASE },
        { color: COUNTRY_RAIL_CORRIDOR_CONNECTED, width: COUNTRY_RAIL_CORRIDOR_WIDTH_CONNECTED },
        { color: COUNTRY_RAIL_CORRIDOR_HIGHLIGHT, width: COUNTRY_RAIL_CORRIDOR_WIDTH_HIGHLIGHT },
      ],
    };
  }
  if (state === 'RAIL_DIMMED') {
    return {
      opacity: COUNTRY_RAIL_CORRIDOR_DIMMED_OPACITY,
      strokes: [{ color: COUNTRY_RAIL_CORRIDOR_MAIN, width: COUNTRY_RAIL_CORRIDOR_WIDTH_MAIN }],
    };
  }
  if (state === 'RAIL_UNAVAILABLE') {
    return {
      opacity: 0.72,
      strokes: [{ color: COUNTRY_RAIL_CORRIDOR_UNAVAILABLE, width: COUNTRY_RAIL_CORRIDOR_WIDTH_MAIN }],
    };
  }
  return {
    opacity: 1,
    strokes: [
      { color: COUNTRY_RAIL_CORRIDOR_BASE, width: COUNTRY_RAIL_CORRIDOR_WIDTH_BASE },
      { color: COUNTRY_RAIL_CORRIDOR_MAIN, width: COUNTRY_RAIL_CORRIDOR_WIDTH_MAIN },
      { color: COUNTRY_RAIL_CORRIDOR_HIGHLIGHT, width: COUNTRY_RAIL_CORRIDOR_WIDTH_HIGHLIGHT },
    ],
  };
}
