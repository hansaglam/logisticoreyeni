import { useCallback, useRef, useState } from 'react';

import { AD_PRIVACY_ERROR_MESSAGE } from '../domain/adPrivacyState';
import {
  completeAdPrivacyAction,
  getAdsConsentSnapshot,
  subscribeAdsConsentState,
} from '../services/adsConsentService';

export function useAdPrivacyAction(options?: {
  onNavigateToPreferences?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const runPrivacyAction = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) {
      return false;
    }
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await completeAdPrivacyAction({
        onNavigateToPreferences: options?.onNavigateToPreferences,
      });
      if (!result.canRequestAds && !result.ok) {
        setError(AD_PRIVACY_ERROR_MESSAGE);
        return false;
      }
      return result.canRequestAds;
    } catch {
      setError(AD_PRIVACY_ERROR_MESSAGE);
      return false;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [options?.onNavigateToPreferences]);

  return {
    loading,
    error,
    runPrivacyAction,
    clearError: () => setError(null),
    subscribeRefresh: subscribeAdsConsentState,
    getSnapshot: getAdsConsentSnapshot,
  };
}
