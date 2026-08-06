/**
 * Ödüllü reklam butonu — M1 reusable bileşen.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { shouldShowTestAdLabel } from '../../config/adMob';
import { slotIdToPlacement } from '../../config/rewardedPlacements';
import {
  AD_PRIVACY_ACTION_DESCRIPTION,
  AD_PRIVACY_ERROR_MESSAGE,
} from '../../domain/adPrivacyState';
import {
  resolveRewardedAdAvailability,
  rewardedAdAvailabilityHelperText,
  rewardedAdAvailabilityToButtonLabel,
  shouldEnableRewardedAdCta,
} from '../../domain/rewardedAdAvailability';
import { useAdPrivacyAction } from '../../hooks/useAdPrivacyAction';
import { useAdPrivacyAvailability } from '../../hooks/useAdPrivacyAvailability';
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
  onNavigateToPreferences?: () => void | Promise<void>;
}

export default function AdRewardButton({
  slotId,
  label,
  description,
  context,
  onSuccess,
  variant = 'secondary',
  compact = true,
  onNavigateToPreferences,
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
  const {
    loading: privacyLoading,
    error: privacyError,
    runPrivacyAction,
  } = useAdPrivacyAction({ onNavigateToPreferences });

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

  const buttonLabel = privacyLoading
    ? 'Gizlilik tercihleri açılıyor…'
    : loading
      ? 'Reklam hazırlanıyor…'
      : rewardedAdAvailabilityToButtonLabel(rewardedAvailability, {
          watchLabel: baseWatchLabel,
          retryLabel: failed ? 'Tekrar Dene' : 'Tekrar Dene',
        });

  const helperText =
    rewardedAvailability === 'privacy-action-required'
      ? AD_PRIVACY_ACTION_DESCRIPTION
      : rewardedAdAvailabilityHelperText(rewardedAvailability);

  const handlePress = async () => {
    if (loading || privacyLoading) {
      return;
    }

    if (
      rewardedAvailability === 'privacy-action-required' ||
      rewardedAvailability === 'privacy-error'
    ) {
      await runPrivacyAction();
      return;
    }

    if (rewardedAvailability !== 'ready' && !failed) {
      return;
    }

    if (!eligibility.ok) {
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

    setLoading(true);
    setFailed(false);
    setErrorText(null);
    try {
      const result = await applyAdReward(slotId, context);
      if (!result.ok) {
        const reason =
          result.reason === 'Reklam yüklenemedi.'
            ? 'Reklam şu anda kullanılamıyor.'
            : result.reason ?? 'Reklam ödülü alınamadı.';
        setErrorText(reason);
        setFailed(true);
        return;
      }
      setFailed(false);
      onSuccess?.();
    } catch (error) {
      setFailed(true);
      setErrorText(error instanceof Error ? error.message : 'Reklam şu anda kullanılamıyor.');
    } finally {
      setLoading(false);
    }
  };

  const ctaEnabled =
    shouldEnableRewardedAdCta(rewardedAvailability) &&
    (rewardedAvailability === 'privacy-action-required' ||
      rewardedAvailability === 'privacy-error' ||
      failed ||
      eligibility.ok);

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
        disabled={!ctaEnabled || loading || privacyLoading}
        variant={variant}
        compact={compact}
        icon={loading || privacyLoading ? undefined : 'play'}
        iconSize={13}
        style={styles.button}
      />
      {helperText ? (
        <Text style={styles.infoText} numberOfLines={3}>
          {helperText}
        </Text>
      ) : null}
      {!eligibility.ok && eligibility.reason && rewardedAvailability === 'ready' && !failed ? (
        <Text style={styles.infoText} numberOfLines={2}>
          {eligibility.reason}
        </Text>
      ) : null}
      {privacyError ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {AD_PRIVACY_ERROR_MESSAGE}
        </Text>
      ) : null}
      {errorText ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {errorText}
        </Text>
      ) : null}
      {loading || privacyLoading ? (
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
