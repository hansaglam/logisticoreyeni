import type { CountryCorridorInteractionState } from '../gameplay/countryCorridorInteraction';

import { resolveRoadVisualStyle } from './transportVisualStyle';
import { mapVisualTokens } from './mapVisualTokens';

/** Curated player ROAD corridors. Cyan operational network, not a beige prototype. */
const CANONICAL_ROAD = resolveRoadVisualStyle('COUNTRY_OVERVIEW', 'CANONICAL_GAMEPLAY_ROAD');
const SECONDARY_ROAD = resolveRoadVisualStyle('COUNTRY_OVERVIEW', 'SECONDARY');

export const COUNTRY_CORRIDOR_BASE = mapVisualTokens.roadBase;
export const COUNTRY_CORRIDOR_MAIN = CANONICAL_ROAD.core;
export const COUNTRY_CORRIDOR_HIGHLIGHT = mapVisualTokens.roadGlow;
export const COUNTRY_CORRIDOR_CONNECTED = mapVisualTokens.roadSelected;
export const COUNTRY_CORRIDOR_CONNECTED_TINT = 'rgba(232, 248, 255, 0.28)';
export const COUNTRY_CORRIDOR_MIXED = SECONDARY_ROAD.core;
export const COUNTRY_CORRIDOR_LOCKED = '#3A4A5C';
export const COUNTRY_CORRIDOR_LOCKED_SELECTED = '#5A6E82';
export const COUNTRY_CORRIDOR_WIDTH_BASE = 0.0005 * CANONICAL_ROAD.widthScale;
export const COUNTRY_CORRIDOR_WIDTH_MAIN = 0.0003 * CANONICAL_ROAD.widthScale;
export const COUNTRY_CORRIDOR_WIDTH_CONNECTED = 0.00036 * CANONICAL_ROAD.widthScale;
export const COUNTRY_CORRIDOR_WIDTH_HIGHLIGHT = 0.00014 * CANONICAL_ROAD.widthScale;
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
