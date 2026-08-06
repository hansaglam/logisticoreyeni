import { useEffect, useMemo, useState } from 'react';

import {
  resolveAdPrivacyAvailability,
  resolveAdPrivacyState,
  type AdPrivacyAvailability,
  type AdPrivacyState,
} from '../domain/adPrivacyState';
import { isAdsEnabled } from '../config/adMob';
import {
  getAdsConsentSnapshot,
  subscribeAdsConsentState,
} from '../services/adsConsentService';

export function useAdPrivacyAvailability(): {
  state: AdPrivacyState;
  availability: AdPrivacyAvailability;
  canRequestAds: boolean;
} {
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeAdsConsentState(() => setTick((value) => value + 1)), []);

  return useMemo(() => {
    const snapshot = getAdsConsentSnapshot();
    const availability = resolveAdPrivacyAvailability(snapshot, isAdsEnabled());
    return {
      state: resolveAdPrivacyState(snapshot, isAdsEnabled()),
      availability,
      canRequestAds: availability.status === 'ready' && availability.canRequestAds,
    };
  }, [tick]);
}
