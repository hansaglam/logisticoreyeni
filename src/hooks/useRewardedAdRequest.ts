import { useCallback, useRef, useState } from 'react';

import { AD_REWARDED_UNAVAILABLE_MESSAGE } from '../domain/adPrivacyState';
import {
  handleRewardedAdRequest,
  openAccountPrivacyOptions,
  subscribeAdsConsentState,
} from '../services/adsConsentService';

/** Rewarded surfaces — consent gate before ad show. */
export function useRewardedAdRequest() {
  const [checking, setChecking] = useState(false);
  const inFlightRef = useRef(false);

  const ensureAdsAllowedForReward = useCallback(async (): Promise<{
    allowed: boolean;
    userMessage?: string;
  }> => {
    if (inFlightRef.current) {
      return { allowed: false, userMessage: AD_REWARDED_UNAVAILABLE_MESSAGE };
    }
    inFlightRef.current = true;
    setChecking(true);
    try {
      const result = await handleRewardedAdRequest();
      if (result.allowed) {
        return { allowed: true };
      }
      return {
        allowed: false,
        userMessage: result.userMessage ?? AD_REWARDED_UNAVAILABLE_MESSAGE,
      };
    } finally {
      inFlightRef.current = false;
      setChecking(false);
    }
  }, []);

  return {
    checking,
    ensureAdsAllowedForReward,
    subscribeRefresh: subscribeAdsConsentState,
  };
}

/** Account Center privacy options — separate from rewarded CTA. */
export function useAccountPrivacyOptions() {
  const [loading, setLoading] = useState(false);

  const openPrivacyOptions = useCallback(async (): Promise<{
    ok: boolean;
    userMessage?: string;
  }> => {
    setLoading(true);
    try {
      const result = await openAccountPrivacyOptions();
      if (result.ok) {
        return { ok: true };
      }
      return { ok: false, userMessage: result.userMessage };
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, openPrivacyOptions };
}
