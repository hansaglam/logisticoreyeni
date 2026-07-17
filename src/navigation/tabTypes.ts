import type { GameIconName } from '../theme/icons';

export type TabKey = 'dashboard' | 'map' | 'contracts' | 'fleet' | 'market' | 'more';

/** Alt tab bar'da görünen ana sekmeler */
export const MAIN_TAB_KEYS = ['dashboard', 'map', 'contracts', 'market'] as const satisfies readonly TabKey[];

export type MainTabKey = (typeof MAIN_TAB_KEYS)[number];

export interface TabDefinition {
  key: TabKey;
  label: string;
  icon: GameIconName;
}
