import { useMemo } from 'react';
import type { ScrollView } from 'react-native';

import { getMarketTutorialSteps } from '../components/market/marketTutorialSteps';
import { useAppTutorial } from './useAppTutorial';
import type { MarketTutorialMarketState, MarketTutorialPersistence } from '../tutorial/marketTutorialState';

export interface UseMarketTutorialOptions {
  persistence: MarketTutorialPersistence;
  marketState: MarketTutorialMarketState;
  layoutReady: boolean;
  isOnboarding: boolean;
  blockingModals: boolean;
  hasPendingOfflineSummary: boolean;
  hasPendingDeliveryIncident: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollYRef: React.MutableRefObject<number>;
  onCompletePersistence: () => void;
}

export function useMarketTutorial(options: UseMarketTutorialOptions) {
  const steps = useMemo(
    () => getMarketTutorialSteps(options.marketState),
    [options.marketState],
  );

  const tutorial = useAppTutorial({
    tutorialId: 'market',
    steps,
    legacyMarket: options.persistence,
    layoutReady: options.layoutReady,
    isOnboarding: options.isOnboarding,
    blockingModals: options.blockingModals,
    hasPendingOfflineSummary: options.hasPendingOfflineSummary,
    hasPendingDeliveryIncident: options.hasPendingDeliveryIncident,
    scrollRef: options.scrollRef,
    scrollYRef: options.scrollYRef,
    onCompletePersistence: options.onCompletePersistence,
  });

  return tutorial;
}

export { resolveMarketTutorialMarketState } from '../tutorial/marketTutorialState';
export type { MarketTutorialMarketState } from '../tutorial/marketTutorialState';
