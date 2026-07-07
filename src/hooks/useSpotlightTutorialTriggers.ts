import { useEffect } from 'react';

import type { TabKey } from '../components/BottomTabBar';
import type { SpotlightTutorialId } from '../tutorial/types';
import {
  canAutoStartSpotlightTutorial,
  useSpotlightTutorialStore,
} from '../store/spotlightTutorialStore';
import { useGameStore } from '../store/gameStore';

interface UseSpotlightTutorialTriggersOptions {
  activeTab: TabKey;
  isGameReady: boolean;
}

export function useSpotlightTutorialTriggers({
  activeTab,
  isGameReady,
}: UseSpotlightTutorialTriggersOptions) {
  const setActiveTab = useSpotlightTutorialStore((state) => state.setActiveTab);
  const startTutorial = useSpotlightTutorialStore((state) => state.startTutorial);
  const isSpotlightActive = useSpotlightTutorialStore((state) => state.isActive);

  const currentTime = useGameStore((state) => state.currentTime);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries);
  const spotlightTutorial = useGameStore((state) => state.spotlightTutorial);

  useEffect(() => {
    setActiveTab(activeTab);
    void useSpotlightTutorialStore.getState().tryCompletePendingAdvance();
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    if (!isGameReady || isSpotlightActive) {
      return;
    }

    if (
      canAutoStartSpotlightTutorial('first_contract') &&
      activeTab === 'dashboard' &&
      currentTime < 2
    ) {
      const timeoutId = setTimeout(() => {
        if (!useSpotlightTutorialStore.getState().isActive) {
          useGameStore.getState().ensureStarterContractsForTutorial();
          startTutorial('first_contract');
        }
      }, 700);
      return () => clearTimeout(timeoutId);
    }
  }, [activeTab, currentTime, isGameReady, isSpotlightActive, startTutorial]);

  useEffect(() => {
    if (!isGameReady || isSpotlightActive) {
      return;
    }
    if ((activeDeliveries?.length ?? 0) === 0) {
      return;
    }
    if (!canAutoStartSpotlightTutorial('track_delivery')) {
      return;
    }
    if (activeTab !== 'dashboard' && activeTab !== 'map') {
      return;
    }
    const timeoutId = setTimeout(() => {
      if (!useSpotlightTutorialStore.getState().isActive) {
        startTutorial('track_delivery');
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [activeDeliveries?.length, activeTab, isGameReady, isSpotlightActive, startTutorial]);

  useEffect(() => {
    if (!isGameReady || isSpotlightActive) {
      return;
    }
    if (activeTab !== 'market') {
      return;
    }
    if (!canAutoStartSpotlightTutorial('market_basics')) {
      return;
    }
    const timeoutId = setTimeout(() => {
      if (!useSpotlightTutorialStore.getState().isActive) {
        startTutorial('market_basics');
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [activeTab, isGameReady, isSpotlightActive, spotlightTutorial, startTutorial]);
}

export function restartSpotlightTutorial(tutorialId: SpotlightTutorialId): void {
  useGameStore.getState().clearSpotlightTutorialProgress(tutorialId);
  useSpotlightTutorialStore.getState().startTutorial(tutorialId, { force: true });
}
