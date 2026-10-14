/**
 * UI-only command center mode. Not gameplay authority and not saved.
 */

import type { GameIconName } from '../../../theme/icons';

export const MAP_COMMAND_MODES = [
  'overview',
  'fleet',
  'contracts',
  'warehouses',
  'market',
  'road',
  'rail',
  'sea',
  'air',
] as const;

export type MapCommandMode = (typeof MAP_COMMAND_MODES)[number];

export type MapInspectorPanel =
  | 'NONE'
  | 'OVERVIEW'
  | 'CITY'
  | 'VEHICLE'
  | 'CONTRACT'
  | 'WAREHOUSE'
  | 'MARKET'
  | 'ALERT';

export type MapModeAvailability = 'active' | 'foundation' | 'locked';

export interface MapCommandModeDefinition {
  mode: MapCommandMode;
  section: 'operations' | 'transport';
  label: string;
  accessibilityLabel: string;
  icon: GameIconName;
  availability: MapModeAvailability;
  /** True only when this mode is a production transport layer the player can operate. */
  productionEnabled: boolean;
}

const MODE_SET = new Set<string>(MAP_COMMAND_MODES);

export const MAP_COMMAND_MODE_DEFINITIONS: readonly MapCommandModeDefinition[] = [
  {
    mode: 'overview',
    section: 'operations',
    label: 'Genel',
    accessibilityLabel: 'Operasyon özeti',
    icon: 'dashboard',
    availability: 'active',
    productionEnabled: false,
  },
  {
    mode: 'fleet',
    section: 'operations',
    label: 'Filo',
    accessibilityLabel: 'Filo',
    icon: 'truck',
    availability: 'active',
    productionEnabled: false,
  },
  {
    mode: 'contracts',
    section: 'operations',
    label: 'İşler',
    accessibilityLabel: 'İşler',
    icon: 'contract',
    availability: 'active',
    productionEnabled: false,
  },
  {
    mode: 'warehouses',
    section: 'operations',
    label: 'Depolar',
    accessibilityLabel: 'Depolar',
    icon: 'warehouse',
    availability: 'active',
    productionEnabled: false,
  },
  {
    mode: 'market',
    section: 'operations',
    label: 'Pazar',
    accessibilityLabel: 'Pazar',
    icon: 'market',
    availability: 'active',
    productionEnabled: false,
  },
  {
    mode: 'road',
    section: 'transport',
    label: 'Kara',
    accessibilityLabel: 'Kara taşımacılığı',
    icon: 'route',
    availability: 'active',
    productionEnabled: true,
  },
  {
    mode: 'rail',
    section: 'transport',
    label: 'Demir',
    accessibilityLabel: 'Demiryolu temeli, üretim oyunu kapalı',
    icon: 'train',
    availability: 'foundation',
    productionEnabled: false,
  },
  {
    mode: 'sea',
    section: 'transport',
    label: 'Deniz',
    accessibilityLabel: 'Deniz taşımacılığı, henüz kapalı',
    icon: 'lock',
    availability: 'locked',
    productionEnabled: false,
  },
  {
    mode: 'air',
    section: 'transport',
    label: 'Hava',
    accessibilityLabel: 'Hava taşımacılığı, henüz kapalı',
    icon: 'lock',
    availability: 'locked',
    productionEnabled: false,
  },
];

const BY_MODE = new Map(MAP_COMMAND_MODE_DEFINITIONS.map((definition) => [definition.mode, definition]));

export function getMapCommandModeDefinition(mode: MapCommandMode): MapCommandModeDefinition {
  return BY_MODE.get(mode) ?? MAP_COMMAND_MODE_DEFINITIONS[0];
}

/** Unknown and locked modes fall back to overview. SEA and AIR stay disabled. */
export function resolveMapCommandMode(value: unknown): MapCommandMode {
  if (typeof value !== 'string' || !MODE_SET.has(value)) {
    return 'overview';
  }
  const mode = value as MapCommandMode;
  if (getMapCommandModeDefinition(mode).availability === 'locked') {
    return 'overview';
  }
  return mode;
}

/**
 * Fleet mode inside a country shows the fleet summary or the selected vehicle.
 * A selected city still wins for every other mode.
 * WORLD scope shows the overview inspector while the rail mode stays as it was.
 */
export function resolveCommandInspectorPanel(input: {
  mode: MapCommandMode;
  citySelected: boolean;
  scope?: 'WORLD' | 'COUNTRY';
}): MapInspectorPanel {
  if (input.mode === 'fleet' && input.scope !== 'WORLD') return 'VEHICLE';
  if (input.citySelected) return 'CITY';
  if (input.scope === 'WORLD') return 'OVERVIEW';
  return inspectorPanelForMode(input.mode);
}

/** Map-scope changes do not pick a new command mode. */
export function commandModeAfterMapScopeChange(mode: MapCommandMode): MapCommandMode {
  return resolveMapCommandMode(mode);
}

export function inspectorPanelForMode(mode: MapCommandMode): MapInspectorPanel {
  switch (resolveMapCommandMode(mode)) {
    case 'fleet':
      return 'VEHICLE';
    case 'contracts':
      return 'CONTRACT';
    case 'warehouses':
      return 'WAREHOUSE';
    case 'market':
      return 'MARKET';
    case 'overview':
    case 'road':
    case 'rail':
      return 'OVERVIEW';
    case 'sea':
    case 'air':
      return 'NONE';
    default:
      return 'OVERVIEW';
  }
}
