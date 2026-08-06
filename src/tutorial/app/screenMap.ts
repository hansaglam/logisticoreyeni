import type { TabKey } from '../../navigation/tabTypes';
import type { AppTutorialId } from './types';

export type ScreenTutorialKey =
  | TabKey
  | 'warehouses'
  | 'finance'
  | 'leaderboard'
  | 'account';

/** Navigation / embedded screen id → tutorial id (null = no screen-level tutorial). */
export const SCREEN_TUTORIAL_MAP: Record<ScreenTutorialKey, AppTutorialId | null> = {
  dashboard: 'dashboard',
  map: 'map',
  contracts: 'contracts',
  market: 'market',
  fleet: 'fleet',
  warehouses: 'warehouses',
  finance: 'finance',
  vehicleMarketplace: 'vehicle-marketplace',
  leaderboard: 'leaderboard',
  account: 'account',
  more: null,
  shop: null,
};

export function resolveScreenTutorialId(screenId: string): AppTutorialId | null {
  if (screenId in SCREEN_TUTORIAL_MAP) {
    return SCREEN_TUTORIAL_MAP[screenId as ScreenTutorialKey];
  }
  return null;
}
