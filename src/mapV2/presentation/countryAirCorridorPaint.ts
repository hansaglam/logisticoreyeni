import type { AirCorridorInteractionState } from '../gameplay/countryAirCorridorInteraction';

/** Pale sky-steel. Distinct from ROAD, RAIL, and SEA. Not bright cyan. */
export const COUNTRY_AIR_CORRIDOR_BASE = 'rgba(24, 32, 40, 0.55)';
export const COUNTRY_AIR_CORRIDOR_MAIN = '#A7B3BE';
export const COUNTRY_AIR_CORRIDOR_HIGHLIGHT = 'rgba(214, 222, 228, 0.14)';
export const COUNTRY_AIR_CORRIDOR_CONNECTED = '#B7C3CC';
export const COUNTRY_AIR_CORRIDOR_UNAVAILABLE = '#5A646C';
export const COUNTRY_AIR_CORRIDOR_WIDTH_BASE = 0.00016;
export const COUNTRY_AIR_CORRIDOR_WIDTH_MAIN = 0.000085;
export const COUNTRY_AIR_CORRIDOR_WIDTH_CONNECTED = 0.0001;
export const COUNTRY_AIR_CORRIDOR_WIDTH_HIGHLIGHT = 0.000035;
export const COUNTRY_AIR_CORRIDOR_DIMMED_OPACITY = 0.32;

export type CountryAirCorridorStrokeLayer = { color: string; width: number };

export function airCorridorInteractionPaint(state: AirCorridorInteractionState): {
  opacity: number;
  strokes: readonly CountryAirCorridorStrokeLayer[];
} {
  if (state === 'AIR_CONNECTED_TO_SELECTED') {
    return {
      opacity: 1,
      strokes: [
        { color: COUNTRY_AIR_CORRIDOR_BASE, width: COUNTRY_AIR_CORRIDOR_WIDTH_BASE },
        { color: COUNTRY_AIR_CORRIDOR_CONNECTED, width: COUNTRY_AIR_CORRIDOR_WIDTH_CONNECTED },
        { color: COUNTRY_AIR_CORRIDOR_HIGHLIGHT, width: COUNTRY_AIR_CORRIDOR_WIDTH_HIGHLIGHT },
      ],
    };
  }
  if (state === 'AIR_DIMMED') {
    return {
      opacity: COUNTRY_AIR_CORRIDOR_DIMMED_OPACITY,
      strokes: [{ color: COUNTRY_AIR_CORRIDOR_MAIN, width: COUNTRY_AIR_CORRIDOR_WIDTH_MAIN }],
    };
  }
  if (state === 'AIR_UNAVAILABLE') {
    return {
      opacity: 0.55,
      strokes: [{ color: COUNTRY_AIR_CORRIDOR_UNAVAILABLE, width: COUNTRY_AIR_CORRIDOR_WIDTH_MAIN }],
    };
  }
  return {
    opacity: 0.92,
    strokes: [
      { color: COUNTRY_AIR_CORRIDOR_BASE, width: COUNTRY_AIR_CORRIDOR_WIDTH_BASE },
      { color: COUNTRY_AIR_CORRIDOR_MAIN, width: COUNTRY_AIR_CORRIDOR_WIDTH_MAIN },
    ],
  };
}
