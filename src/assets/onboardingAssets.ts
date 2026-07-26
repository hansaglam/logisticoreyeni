import type { OnboardingStepId } from '../types/game';

/**
 * Onboarding adım artwork registry — 5 aşamalı başlangıç rehberi görselleri.
 */

export const onboardingAssets = {
  chooseFirstContract: require('../../assets/onboarding/step-1-choose-contract.png'),
  assignTeam: require('../../assets/onboarding/step-2-assign-team.png'),
  trackDelivery: require('../../assets/onboarding/step-3-track-delivery.png'),
  completeFirstDelivery: require('../../assets/onboarding/step-4-complete-delivery.png'),
  claimFirstReward: require('../../assets/onboarding/step-5-claim-reward.png'),
} as const;

export type OnboardingArtworkKey = keyof typeof onboardingAssets;

export function getOnboardingArtwork(step: OnboardingStepId): number | null {
  switch (step) {
    case 'choose_first_contract':
      return onboardingAssets.chooseFirstContract;
    case 'assign_team':
      return onboardingAssets.assignTeam;
    case 'track_delivery':
      return onboardingAssets.trackDelivery;
    case 'complete_first_delivery':
      return onboardingAssets.completeFirstDelivery;
    case 'claim_first_reward':
      return onboardingAssets.claimFirstReward;
    default:
      return null;
  }
}
