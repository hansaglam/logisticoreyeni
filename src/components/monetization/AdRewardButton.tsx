/**
 * Ödüllü reklam butonu — M1 reusable bileşen.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { shouldShowTestAdLabel } from '../../config/adMob';
import { slotIdToPlacement } from '../../config/rewardedPlacements';
import { areAdsFeatureEnabled } from '../../services/adProvider';
import { canRequestAdsAfterConsent } from '../../services/adsConsentService';
import { canGrantAdReward, resetDailyUsageIfNeeded } from '../../simulation/adRewardGrants';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import type { AdRewardGrantContext, AdRewardSlotId } from '../../types/monetization';
import {
  getRewardedPlacementStatusMessage,
  useRewardedPlacement,
} from '../../hooks/useRewardedPlacement';
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

  const trackedPlacement = slotIdToPlacement(slotId);
  const placementState = useRewardedPlacement(trackedPlacement ?? 'daily_operations');
  const placementMessage = trackedPlacement
    ? getRewardedPlacementStatusMessage(placementState)
    : null;

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

  const consentReady = canRequestAdsAfterConsent();
  const adRuntimeBlocked =
    trackedPlacement != null &&
    placementState.status !== 'ready' &&
    placementState.status !== 'showing';

  const baseLabel = shouldShowTestAdLabel() ? `${label} (Test reklam)` : label;
  const buttonLabel = loading
    ? 'Reklam hazırlanıyor…'
    : failed
      ? 'Tekrar Dene'
      : !consentReady
        ? 'Gizlilik tercihi gerekli'
        : adRuntimeBlocked && eligibility.ok
          ? placementMessage ?? 'Reklam hazırlanıyor…'
          : baseLabel;

  const handlePress = async () => {
    if (loading) {
      return;
    }

    if (!consentReady) {
      setErrorText('Reklamları kullanmak için gizlilik tercihini tamamla.');
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
        if (typeof __DEV__ !== 'undefined' && __DEV__ === true) {
          console.warn('[AdRewardButton] applyAdReward failed', {
            slotId,
            reason,
            selectedDeliveryId: fullContext.selectedDeliveryId,
          });
        }
        return;
      }
      setFailed(false);
      if (typeof __DEV__ !== 'undefined' && __DEV__ === true && slotId === 'delivery_boost') {
        const delivery = useGameStore
          .getState()
          .activeDeliveries.find((item) => item.id === fullContext.selectedDeliveryId);
        console.log('[AdRewardButton] delivery_boost granted', {
          selectedDeliveryId: fullContext.selectedDeliveryId,
          progress: delivery?.progress,
        });
      }
      onSuccess?.();
    } catch (error) {
      setFailed(true);
      setErrorText(error instanceof Error ? error.message : 'Reklam şu anda kullanılamıyor.');
    } finally {
      setLoading(false);
    }
  };

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
        disabled={loading || (!eligibility.ok && !failed && !consentReady)}
        variant={variant}
        compact={compact}
        icon={loading ? undefined : 'play'}
        iconSize={13}
        style={styles.button}
      />
      {!consentReady ? (
        <Text style={styles.disabledReason} numberOfLines={2}>
          Reklamları kullanmak için gizlilik tercihini tamamla.
        </Text>
      ) : null}
      {!eligibility.ok && eligibility.reason && !failed ? (
        <Text style={styles.disabledReason} numberOfLines={2}>
          {eligibility.reason}
        </Text>
      ) : null}
      {placementMessage && eligibility.ok && adRuntimeBlocked && !failed ? (
        <Text style={styles.disabledReason} numberOfLines={2}>
          {placementMessage}
        </Text>
      ) : null}
      {errorText ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {errorText}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator size="small" color={colors.accentBlue} style={styles.loader} /> : null}
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
  },
  disabledReason: {
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
