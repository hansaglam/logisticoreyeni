import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { getMarketTutorialSteps } from '../components/market/marketTutorialSteps';
import { useAppTutorial } from './useAppTutorial';
import type { ProductId } from '../types/game';
import type { MarketTutorialMarketState, MarketTutorialPersistence } from '../tutorial/marketTutorialState';

export interface UseMarketTutorialOptions {
  persistence: MarketTutorialPersistence;
  marketState: MarketTutorialMarketState;
  layoutReady: boolean;
  isOnboarding: boolean;
  blockingModals: boolean;
  hasPendingOfflineSummary: boolean;
  hasPendingDeliveryIncident: boolean;
  anchorProductId?: ProductId | null;
  scrollRef: React.RefObject<ScrollView | null>;
  scrollYRef: React.MutableRefObject<number>;
  onCompletePersistence: () => void;
}

export function useMarketTutorial(options: UseMarketTutorialOptions) {
  const [snapshotProductId, setSnapshotProductId] = useState<ProductId | null>(null);
  const anchorProductIdRef = useRef<ProductId | null | undefined>(options.anchorProductId ?? null);
  anchorProductIdRef.current = options.anchorProductId ?? null;

  const steps = useMemo(
    () => getMarketTutorialSteps(options.marketState, snapshotProductId),
    [options.marketState, snapshotProductId],
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

  useEffect(() => {
    if (tutorial.visible) {
      if (!snapshotProductId && anchorProductIdRef.current) {
        setSnapshotProductId(anchorProductIdRef.current);
      }
      return;
    }
    if (snapshotProductId) {
      setSnapshotProductId(null);
    }
  }, [snapshotProductId, tutorial.visible]);

  return tutorial;
}

export { resolveMarketTutorialMarketState } from '../tutorial/marketTutorialState';
export type { MarketTutorialMarketState } from '../tutorial/marketTutorialState';
