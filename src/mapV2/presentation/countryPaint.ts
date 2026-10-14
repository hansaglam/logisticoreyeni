import type { CountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { mapVisualTokens } from './mapVisualTokens';

export type CountryPaint = {
  fill: string;
  border: string;
  strokeWidth: number;
};

const PAINT: Record<CountryGameplayAvailability, CountryPaint> = {
  STARTER_AVAILABLE: {
    fill: mapVisualTokens.countryAvailable,
    border: mapVisualTokens.countryBorderSelected,
    strokeWidth: 0.00072,
  },
  UNLOCKED: {
    fill: '#123044',
    border: '#3A7C9A',
    strokeWidth: 0.00048,
  },
  LOCKED: {
    fill: mapVisualTokens.countryLocked,
    border: mapVisualTokens.countryBorder,
    strokeWidth: 0.00026,
  },
  NOT_GAMEPLAY_SUPPORTED: {
    fill: mapVisualTokens.countryUnsupported,
    border: '#1A2A38',
    strokeWidth: 0.00018,
  },
};

const SELECTED: Record<CountryGameplayAvailability, CountryPaint> = {
  STARTER_AVAILABLE: {
    fill: mapVisualTokens.countrySelected,
    border: mapVisualTokens.selectionOutline,
    strokeWidth: 0.00115,
  },
  UNLOCKED: {
    fill: '#184868',
    border: mapVisualTokens.countryBorderSelected,
    strokeWidth: 0.00105,
  },
  LOCKED: {
    fill: '#122838',
    border: '#7A93A8',
    strokeWidth: 0.0009,
  },
  NOT_GAMEPLAY_SUPPORTED: {
    fill: '#101C28',
    border: '#5A7184',
    strokeWidth: 0.0008,
  },
};

const CONTEXT: CountryPaint = {
  fill: mapVisualTokens.countryInactive,
  border: 'rgba(42, 66, 86, 0.28)',
  strokeWidth: 0.00022,
};

/** Isolated COUNTRY scene: one primary country, not a zoomed world highlight. */
export function paintForCountryFocus(): CountryPaint {
  return {
    fill: '#1A5C86',
    border: '#5EEAD4',
    strokeWidth: 0.00042,
  };
}

/** Player operations dashboard: richer fill; coastline still verified geometry. */
export function paintForCountryDashboard(): CountryPaint {
  return {
    fill: mapVisualTokens.countrySelected,
    border: mapVisualTokens.countryBorderSelected,
    strokeWidth: 0.00034,
  };
}

export function paintForCountryAvailability(
  availability: CountryGameplayAvailability,
  selected: boolean,
): CountryPaint {
  return selected ? SELECTED[availability] : PAINT[availability];
}

export function paintForCountryContext(): CountryPaint {
  return CONTEXT;
}

export const MAP_V2_OCEAN = mapVisualTokens.ocean;
export const MAP_V2_OCEAN_DEEP = mapVisualTokens.oceanDeep;
export const MAP_V2_STARTER_GLOW = mapVisualTokens.selectionHalo;
