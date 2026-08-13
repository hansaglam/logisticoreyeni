import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { getMarketTutorialSteps } from '../components/market/marketTutorialSteps';
import { APP_TUTORIALS_ENABLED } from '../tutorial/app/featureFlags';
import { normalizeTutorialProgress } from '../tutorial/app/persistence';
import { isTutorialSessionDisabled } from '../tutorial/app/controller';
import { useGameStore } from '../store/gameStore';
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
}

export function useMarketTutorial(options: UseMarketTutorialOptions) {
  const [snapshotProductId, setSnapshotProductId] = useState<ProductId | null>(null);
  const anchorProductIdRef = useRef<ProductId | null | undefined>(options.anchorProductId ?? null);
  anchorProductIdRef.current = options.anchorProductId ?? null;

  const rawTutorialProgress = useGameStore((state) => state.tutorialProgress);
  const tutorialProgress = useMemo(
    () => normalizeTutorialProgress(rawTutorialProgress),
    [rawTutorialProgress],
  );
  const isGameReady = useGameStore((state) => state.isGameReady);
  const markTutorialPresented = useGameStore((state) => state.markTutorialPresented);
  const completeMarketTutorial = useGameStore((state) => state.completeMarketTutorial);
  const recordTutorialOutcome = useGameStore((state) => state.recordTutorialOutcome);
  const recordTutorialManualReplay = useGameStore((state) => state.recordTutorialManualReplay);

  const steps = useMemo(
    () => getMarketTutorialSteps(options.marketState, snapshotProductId),
    [options.marketState, snapshotProductId],
  );

  const sessionDisabled = !APP_TUTORIALS_ENABLED || isTutorialSessionDisabled('market');

  const onPresentPersistence = useCallback(() => {
    markTutorialPresented('market');
  }, [markTutorialPresented]);

  const onTutorialOutcome = useCallback(
    (outcome: Parameters<typeof recordTutorialOutcome>[1]) => {
      if (outcome === 'completed') {
        completeMarketTutorial();
        return;
      }
      recordTutorialOutcome('market', outcome);
    },
    [completeMarketTutorial, recordTutorialOutcome],
  );

  const onManualReplayPersistence = useCallback(() => {
    recordTutorialManualReplay('market');
  }, [recordTutorialManualReplay]);

  const tutorial = useAppTutorial({
    tutorialId: 'market',
    steps,
    enabled: !sessionDisabled && steps.length > 0,
    legacyMarket: options.persistence,
    tutorialProgress,
    layoutReady: options.layoutReady,
    gameHydrated: isGameReady,
    sessionDisabled,
    isOnboarding: options.isOnboarding,
    blockingModals: options.blockingModals,
    hasPendingOfflineSummary: options.hasPendingOfflineSummary,
    hasPendingDeliveryIncident: options.hasPendingDeliveryIncident,
    scrollRef: options.scrollRef,
    scrollYRef: options.scrollYRef,
    onPresentPersistence,
    onTutorialOutcome,
    onManualReplayPersistence,
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
