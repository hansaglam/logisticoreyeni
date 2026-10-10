import { colors } from '../../theme/colors';
import type { CountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';

export type CountryPaint = {
  fill: string;
  border: string;
  strokeWidth: number;
};

const PAINT: Record<CountryGameplayAvailability, CountryPaint> = {
  STARTER_AVAILABLE: {
    fill: '#1A6F96',
    border: '#5EC8FF',
    strokeWidth: 0.0009,
  },
  UNLOCKED: {
    fill: '#155A7A',
    border: '#3A8FBF',
    strokeWidth: 0.00055,
  },
  LOCKED: {
    fill: '#0C1D2E',
    border: '#2A4258',
    strokeWidth: 0.00028,
  },
  NOT_GAMEPLAY_SUPPORTED: {
    fill: '#09141F',
    border: '#1C2C3A',
    strokeWidth: 0.0002,
  },
};

const SELECTED: Record<CountryGameplayAvailability, CountryPaint> = {
  STARTER_AVAILABLE: {
    fill: '#2284B0',
    border: colors.primaryLight,
    strokeWidth: 0.0016,
  },
  UNLOCKED: {
    fill: '#1B6A90',
    border: colors.primaryLight,
    strokeWidth: 0.0015,
  },
  LOCKED: {
    fill: '#143044',
    border: '#7A93A8',
    strokeWidth: 0.0012,
  },
  NOT_GAMEPLAY_SUPPORTED: {
    fill: '#102030',
    border: '#5A7184',
    strokeWidth: 0.001,
  },
};

const CONTEXT: CountryPaint = {
  fill: '#071018',
  border: 'rgba(44, 66, 86, 0.35)',
  strokeWidth: 0.00025,
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
    fill: '#165A78',
    border: '#8EF0DC',
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

export const MAP_V2_OCEAN = '#031225';
export const MAP_V2_OCEAN_DEEP = '#020B14';
export const MAP_V2_STARTER_GLOW = 'rgba(94, 200, 255, 0.22)';
