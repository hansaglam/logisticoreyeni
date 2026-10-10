import type { CountryCorridorInteractionState } from '../gameplay/countryCorridorInteraction';

/** Curated player ROAD corridors. Not debug ROAD paint. Not city cyan. */
export const COUNTRY_CORRIDOR_BASE = 'rgba(10, 18, 28, 0.92)';
export const COUNTRY_CORRIDOR_MAIN = '#C9C0AE';
export const COUNTRY_CORRIDOR_HIGHLIGHT = 'rgba(236, 228, 214, 0.28)';
export const COUNTRY_CORRIDOR_CONNECTED = '#DDD4C2';
export const COUNTRY_CORRIDOR_CONNECTED_TINT = 'rgba(186, 214, 222, 0.22)';
export const COUNTRY_CORRIDOR_MIXED = '#8B93A0';
export const COUNTRY_CORRIDOR_LOCKED = '#4A5562';
export const COUNTRY_CORRIDOR_LOCKED_SELECTED = '#6A7684';
export const COUNTRY_CORRIDOR_WIDTH_BASE = 0.00026;
export const COUNTRY_CORRIDOR_WIDTH_MAIN = 0.00015;
export const COUNTRY_CORRIDOR_WIDTH_CONNECTED = 0.000175;
export const COUNTRY_CORRIDOR_WIDTH_HIGHLIGHT = 0.00007;
export const COUNTRY_CORRIDOR_DIMMED_OPACITY = 0.45;

export type CountryCorridorStrokeLayer = { color: string; width: number };

export function corridorInteractionPaint(state: CountryCorridorInteractionState): {
  opacity: number;
  strokes: readonly CountryCorridorStrokeLayer[];
} {
  if (state === 'CONNECTED_TO_SELECTED') {
    return {
      opacity: 1,
      strokes: [
        { color: COUNTRY_CORRIDOR_BASE, width: COUNTRY_CORRIDOR_WIDTH_BASE },
        { color: COUNTRY_CORRIDOR_CONNECTED, width: COUNTRY_CORRIDOR_WIDTH_CONNECTED },
        { color: COUNTRY_CORRIDOR_CONNECTED_TINT, width: COUNTRY_CORRIDOR_WIDTH_HIGHLIGHT },
      ],
    };
  }
  if (state === 'DIMMED') {
    return {
      opacity: COUNTRY_CORRIDOR_DIMMED_OPACITY,
      strokes: [{ color: COUNTRY_CORRIDOR_MAIN, width: COUNTRY_CORRIDOR_WIDTH_MAIN }],
    };
  }
  if (state === 'LOCKED_OR_MIXED') {
    return {
      opacity: 0.78,
      strokes: [{ color: COUNTRY_CORRIDOR_LOCKED, width: COUNTRY_CORRIDOR_WIDTH_MAIN }],
    };
  }
  if (state === 'LOCKED_AND_SELECTED_CONTEXT') {
    return {
      opacity: 0.92,
      strokes: [{ color: COUNTRY_CORRIDOR_LOCKED_SELECTED, width: COUNTRY_CORRIDOR_WIDTH_CONNECTED }],
    };
  }
  return {
    opacity: 1,
    strokes: [
      { color: COUNTRY_CORRIDOR_BASE, width: COUNTRY_CORRIDOR_WIDTH_BASE },
      { color: COUNTRY_CORRIDOR_MAIN, width: COUNTRY_CORRIDOR_WIDTH_MAIN },
      { color: COUNTRY_CORRIDOR_HIGHLIGHT, width: COUNTRY_CORRIDOR_WIDTH_HIGHLIGHT },
    ],
  };
}
