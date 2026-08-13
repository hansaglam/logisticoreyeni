/**
 * @deprecated Account Center only — use useAccountPrivacyOptions from useRewardedAdRequest.
 */
import { useAccountPrivacyOptions } from './useRewardedAdRequest';

export function useAdPrivacyAction() {
  const { loading, openPrivacyOptions } = useAccountPrivacyOptions();

  return {
    loading,
    error: null as string | null,
    runPrivacyAction: async (): Promise<boolean> => {
      const result = await openPrivacyOptions();
      return result.ok;
    },
    clearError: () => undefined,
  };
}
