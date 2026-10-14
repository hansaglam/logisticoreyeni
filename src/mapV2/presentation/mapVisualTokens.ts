/**
 * Premium logistics-map palette. Renderers read these tokens.
 * Command-center chrome stays on mapUiTheme; this is the geographic surface.
 */

export const mapVisualTokens = {
  ocean: '#071624',
  oceanDeep: '#030C16',
  countryInactive: '#102033',
  countryAvailable: '#1B4E70',
  countrySelected: '#226488',
  countryBorder: '#34556E',
  countryBorderSelected: '#7EDAF2',
  countryLocked: '#0A141E',
  countryUnsupported: '#081018',
  cityDefault: '#7EE7F5',
  citySelected: '#F4FBFF',
  cityLocked: '#6E849C',
  cityWarning: '#E2B15A',
  cityHalo: 'rgba(61, 220, 255, 0.28)',
  roadBase: 'rgba(8, 18, 32, 0.9)',
  roadPrimary: '#3DDCFF',
  roadSelected: '#E8F8FF',
  roadGlow: 'rgba(61, 220, 255, 0.55)',
  roadSecondary: '#3A5168',
  railBase: 'rgba(14, 20, 28, 0.9)',
  railPrimary: '#C5D0DC',
  railSelected: '#E7EEF4',
  labelPrimary: '#E7F4FF',
  labelSecondary: '#A9C6DC',
  labelMuted: '#6E849C',
  labelSelected: '#FFFFFF',
  gridMajor: 'rgba(90, 140, 180, 0.045)',
  gridMinor: 'rgba(90, 140, 180, 0.028)',
  selectionHalo: 'rgba(61, 220, 255, 0.22)',
  selectionOutline: '#8EF0FF',
  fleetAvailable: '#3DDCFF',
  fleetOnRoute: '#8EF0FF',
  fleetMaintenance: '#E2B15A',
  fleetOutOfFuel: '#F0A35A',
  fleetTransfer: '#8FB4CC',
  fleetLocked: '#6E849C',
} as const;

/** Enforced geographic draw order. Labels stay above transport. */
export const MAP_DRAW_ORDER = [
  'ocean',
  'grid',
  'country-fill',
  'country-border',
  'road',
  'rail',
  'city-halo',
  'city-marker',
  'label',
] as const;
