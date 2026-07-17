import { useEffect, useMemo } from 'react';

import { getOnboardingStepById } from '../onboarding/onboardingConfig';
import type { OnboardingHintBadge } from '../components/onboarding/OnboardingHintCard';
import { shouldShowOnboardingHint } from '../onboarding/onboardingProgress';
import type { GameIconName } from '../theme/icons';
import type { OnboardingScreenId, OnboardingStepId } from '../types/game';
import { useGameStore } from '../store/gameStore';

export function useOnboardingScreenVisit(screenId: OnboardingScreenId): void {
  const markVisited = useGameStore((state) => state.markOnboardingScreenVisited);

  useEffect(() => {
    markVisited(screenId);
  }, [markVisited, screenId]);
}

export function useActiveOnboardingHint(stepIds: OnboardingStepId[]) {
  const onboarding = useGameStore((state) => state.onboarding);
  const dismissHint = useGameStore((state) => state.dismissOnboardingHint);

  return useMemo(() => {
    if (!onboarding) {
      return null;
    }

    for (const stepId of stepIds) {
      const step = getOnboardingStepById(stepId);
      if (
        step?.hintId &&
        step.hintTitle &&
        step.hintDescription &&
        shouldShowOnboardingHint(onboarding, step.hintId, stepId)
      ) {
        const isMarketStep = stepId === 'market_intro' || stepId === 'first_trade';
        return {
          hintId: step.hintId,
          title: step.hintTitle,
          description: step.hintDescription,
          icon: step.icon as GameIconName,
          badgeLabel: (isMarketStep ? 'İPUCU' : 'REHBER') as OnboardingHintBadge,
          accentVariant: step.variant === 'reward' ? ('reward' as const) : ('guide' as const),
          onDismiss: () => dismissHint(step.hintId!),
        };
      }
    }

    return null;
  }, [onboarding, dismissHint, stepIds.join('|')]);
}
