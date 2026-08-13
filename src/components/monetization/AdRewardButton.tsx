/**
 * Ödüllü reklam butonu — M1 reusable bileşen.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { shouldShowTestAdLabel } from '../../config/adMob';
import { slotIdToPlacement } from '../../config/rewardedPlacements';
import {
  AD_REWARDED_LOAD_FAILED_MESSAGE,
  AD_REWARDED_UNAVAILABLE_MESSAGE,
} from '../../domain/adPrivacyState';
import {
  resolveRewardedAdAvailability,
  rewardedAdAvailabilityHelperText,
  rewardedAdAvailabilityToButtonLabel,
  shouldEnableRewardedAdCta,
} from '../../domain/rewardedAdAvailability';
import { useAdPrivacyAvailability } from '../../hooks/useAdPrivacyAvailability';
import { useRewardedAdRequest } from '../../hooks/useRewardedAdRequest';
import { useRewardedPlacement } from '../../hooks/useRewardedPlacement';
import { areAdsFeatureEnabled } from '../../services/adProvider';
import { canGrantAdReward, resetDailyUsageIfNeeded } from '../../simulation/adRewardGrants';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import type { AdRewardGrantContext, AdRewardSlotId } from '../../types/monetization';
import { ActionButton } from '../ui';

declare const __DEV__: boolean | undefined;

export interface AdRewardButtonProps {
  slotId: AdRewardSlotId;
  label: string;
  description?: string;
  context: Omit<AdRewardGrantContext, 'currentGameTime' | 'playerLevel' | 'hasCompletedOnboarding'>;
  onSuccess?: () => void;
  variant?: 'primary' | 'secondary';
  compact?: boolean;
}

export default function AdRewardButton({
  slotId,
  label,
  description,
  context,
  onSuccess,
  variant = 'secondary',
  compact = true,
}: AdRewardButtonProps) {
  const applyAdReward = useGameStore((state) => state.applyAdReward);
  const monetization = useGameStore((state) => state.monetization);
  const currentGameTime = useGameStore((state) => state.currentTime);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1),
  );
  const hasCompletedOnboarding = useGameStore((state) => state.onboarding?.completed === true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const { availability: privacyAvailability } = useAdPrivacyAvailability();
  const { checking: privacyChecking, ensureAdsAllowedForReward } = useRewardedAdRequest();

  const trackedPlacement = slotIdToPlacement(slotId);
  const placementState = useRewardedPlacement(trackedPlacement ?? 'daily_operations');

  const fullContext = useMemo(
    (): AdRewardGrantContext => ({
      currentGameTime,
      playerLevel,
      hasCompletedOnboarding,
      ...context,
    }),
    [context, currentGameTime, hasCompletedOnboarding, playerLevel],
  );

  const eligibility = useMemo(() => {
    const normalized = resetDailyUsageIfNeeded(monetization);
    return canGrantAdReward(normalized, slotId, fullContext);
  }, [fullContext, monetization, slotId]);

  if (!areAdsFeatureEnabled()) {
    return null;
  }

  const baseWatchLabel = shouldShowTestAdLabel() ? `${label} (Test reklam)` : label;
  const rewardedAvailability = resolveRewardedAdAvailability({
    privacy: privacyAvailability,
    placementStatus: placementState.status,
  });

  const buttonLabel = privacyChecking
    ? 'Reklam seçenekleri hazırlanıyor…'
    : loading
      ? 'Reklam hazırlanıyor…'
      : rewardedAdAvailabilityToButtonLabel(rewardedAvailability, {
          watchLabel: baseWatchLabel,
          retryLabel: failed ? 'Tekrar Dene' : baseWatchLabel,
        });

  const helperText = rewardedAdAvailabilityHelperText(rewardedAvailability);

  const handlePress = async () => {
    if (loading || privacyChecking) {
      return;
    }

    if (!eligibility.ok && !failed) {
      const reason = eligibility.reason ?? 'Ödül şu an kullanılamıyor.';
      setErrorText(reason);
      if (typeof __DEV__ !== 'undefined' && __DEV__ === true) {
        console.warn('[AdRewardButton] grant blocked', {
          slotId,
          reason,
          context: fullContext,
        });
      }
      return;
    }

    const privacyResult = await ensureAdsAllowedForReward();
    if (!privacyResult.allowed) {
      setErrorText(privacyResult.userMessage ?? AD_REWARDED_UNAVAILABLE_MESSAGE);
      setFailed(true);
      return;
    }

    setLoading(true);
    setFailed(false);
    setErrorText(null);
    try {
      const result = await applyAdReward(slotId, context);
      if (!result.ok) {
        const reason =
          result.reason === 'Reklam yüklenemedi.'
            ? AD_REWARDED_LOAD_FAILED_MESSAGE
            : result.reason ?? AD_REWARDED_UNAVAILABLE_MESSAGE;
        setErrorText(reason);
        setFailed(true);
        return;
      }
      setFailed(false);
      onSuccess?.();
    } catch (error) {
      setFailed(true);
      setErrorText(error instanceof Error ? error.message : AD_REWARDED_UNAVAILABLE_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  const ctaEnabled =
    shouldEnableRewardedAdCta(rewardedAvailability) &&
    (failed || eligibility.ok);

  return (
    <View style={styles.root}>
      {description ? (
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      ) : null}
      <ActionButton
        label={buttonLabel}
        onPress={handlePress}
        disabled={!ctaEnabled || loading || privacyChecking}
        variant={variant}
        compact={compact}
        icon={loading || privacyChecking ? undefined : 'play'}
        iconSize={13}
        style={styles.button}
      />
      {helperText ? (
        <Text style={styles.infoText} numberOfLines={3}>
          {helperText}
        </Text>
      ) : null}
      {!eligibility.ok && eligibility.reason && !failed ? (
        <Text style={styles.infoText} numberOfLines={2}>
          {eligibility.reason}
        </Text>
      ) : null}
      {errorText ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {errorText}
        </Text>
      ) : null}
      {loading || privacyChecking ? (
        <ActivityIndicator size="small" color={colors.accentBlue} style={styles.loader} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
  },
  description: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  button: {
    alignSelf: 'stretch',
    minHeight: 44,
  },
  infoText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  errorText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.danger,
    fontWeight: '700',
  },
  loader: {
    alignSelf: 'flex-start',
  },
});
