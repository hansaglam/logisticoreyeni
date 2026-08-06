import { MARKET_TUTORIAL_VERSION } from '../../config/marketTutorial';
import type { AppTutorialId } from './types';

export const APP_TUTORIAL_VERSIONS: Record<AppTutorialId, number> = {
  dashboard: 1,
  map: 1,
  contracts: 1,
  market: MARKET_TUTORIAL_VERSION,
  fleet: 1,
  warehouses: 1,
  finance: 1,
  'vehicle-marketplace': 1,
  leaderboard: 1,
  account: 1,
  reputation: 1,
};
