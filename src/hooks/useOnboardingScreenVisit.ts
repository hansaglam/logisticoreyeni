import { useEffect } from 'react';

import type { OnboardingScreenId } from '../types/game';
import { useGameStore } from '../store/gameStore';

/** Tracks screen visits for background onboarding progression (no UI). */
export function useOnboardingScreenVisit(screenId: OnboardingScreenId): void {
  const markVisited = useGameStore((state) => state.markOnboardingScreenVisited);

  useEffect(() => {
    markVisited(screenId);
  }, [markVisited, screenId]);
}
