import { useEffect, useState } from 'react';

import type { RewardedPlacement } from '../config/rewardedPlacements';
import {
  getRewardedPlacementState,
  preloadRewardedPlacement,
  subscribeRewardedPlacementState,
  type RewardedPlacementState,
} from '../services/adProvider';

export function useRewardedPlacement(placement: RewardedPlacement): RewardedPlacementState {
  const [state, setState] = useState(() => getRewardedPlacementState(placement));

  useEffect(() => {
    preloadRewardedPlacement(placement);
    const refresh = () => {
      setState(getRewardedPlacementState(placement));
    };
    refresh();
    return subscribeRewardedPlacementState(refresh);
  }, [placement]);

  return state;
}

export function getRewardedPlacementStatusMessage(
  placementState: RewardedPlacementState,
): string | null {
  switch (placementState.status) {
    case 'consent-required':
      return 'Reklamları kullanmak için gizlilik tercihini tamamla.';
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
