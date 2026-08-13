import { MARKET_TUTORIAL_VERSION } from '../config/marketTutorial';
import { hasTutorialBeenPresented } from './app/persistence';
import type { TutorialProgressState } from './app/types';

export type MarketTutorialMarketState = 'live' | 'cached' | 'unavailable';

export interface MarketTutorialPersistence {
  marketTutorialCompleted?: boolean;
  marketTutorialVersion?: number;
}

export function normalizeMarketTutorialState(
  raw: Partial<MarketTutorialPersistence> | null | undefined,
): MarketTutorialPersistence {
  return {
    marketTutorialCompleted: raw?.marketTutorialCompleted === true,
    marketTutorialVersion:
      typeof raw?.marketTutorialVersion === 'number' &&
      Number.isFinite(raw.marketTutorialVersion)
        ? Math.max(0, Math.floor(raw.marketTutorialVersion))
        : 0,
  };
}

export function shouldAutoStartMarketTutorial(
  state: MarketTutorialPersistence,
  progress?: TutorialProgressState,
): boolean {
  return !hasTutorialBeenPresented('market', progress, state);
}

export function createCompletedMarketTutorialState(): MarketTutorialPersistence {
  return {
    marketTutorialCompleted: true,
    marketTutorialVersion: MARKET_TUTORIAL_VERSION,
  };
}

export function resolveMarketTutorialMarketState(params: {
  citiesAvailable: boolean;
  hasSnapshot: boolean;
  fetchUiStatus: 'idle' | 'loading' | 'success' | 'stale' | 'error';
}): MarketTutorialMarketState {
  if (!params.citiesAvailable) {
    return 'unavailable';
  }
  if (params.fetchUiStatus === 'error' && !params.hasSnapshot) {
    return 'unavailable';
  }
  if (params.fetchUiStatus === 'stale' || params.fetchUiStatus === 'error') {
    return 'cached';
  }
  return 'live';
}
