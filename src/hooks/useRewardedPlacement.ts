import { useEffect, useState } from 'react';

import type { RewardedPlacement } from '../config/rewardedPlacements';
import { subscribeAdsConsentState } from '../services/adsConsentService';
import {
  getRewardedPlacementState,
  preloadRewardedPlacement,
  subscribeRewardedPlacementState,
  type RewardedPlacementState,
} from '../services/adProvider';

export function useRewardedPlacement(placement: RewardedPlacement): RewardedPlacementState {
  const [state, setState] = useState(() => getRewardedPlacementState(placement));

  useEffect(() => {
    const refresh = () => {
      setState(getRewardedPlacementState(placement));
    };
    preloadRewardedPlacement(placement);
    refresh();
    const unsubPlacement = subscribeRewardedPlacementState(refresh);
    const unsubConsent = subscribeAdsConsentState(() => {
      preloadRewardedPlacement(placement);
      refresh();
    });
    return () => {
      unsubPlacement();
      unsubConsent();
    };
  }, [placement]);

  return state;
}

export function getRewardedPlacementStatusMessage(
  placementState: RewardedPlacementState,
): string | null {
  switch (placementState.status) {
    case 'consent-required':
      return null;
    case 'loading':
    case 'idle':
      return 'Reklam hazırlanıyor…';
    case 'no-fill':
      return 'Şu anda uygun reklam bulunamadı. Biraz sonra tekrar dene.';
    case 'network-error':
      return 'Bağlantı sorunu. Biraz sonra tekrar dene.';
    case 'failed':
      return 'Reklam şu an kullanılamıyor.';
    case 'showing':
      return 'Reklam açılıyor…';
    case 'cooldown':
      return 'Kısa süre sonra tekrar deneyebilirsin.';
    default:
      return null;
  }
}
