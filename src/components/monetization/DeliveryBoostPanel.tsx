import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Delivery, Truck } from '../../types/game';
import { useGameStore } from '../../store/gameStore';
import {
  areAdsFeatureEnabled,
  isRewardedAdShowing,
} from '../../services/adProvider';
import { getEffectiveOfflineGameSpeed } from '../../config/balance';
import { DELIVERY_AD_BOOST_MAX_USES } from '../../config/deliveryAdBoost';
import { formatBoostDurationLabel } from '../../simulation/deliveryAdBoost';
import {
  deliveryBoostDisabledReasonToUserMessage,
  getDeliveryBoostAvailability,
} from '../../simulation/deliveryBoostAvailability';
import { resetDailyUsageIfNeeded, canGrantAdReward } from '../../simulation/adRewardGrants';
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

interface DeliveryBoostPanelProps {
  delivery: Delivery;
  truck?: Truck;
  onSuccess?: (minutesSaved: number) => void;
  compact?: boolean;
  currentGameTime?: number;
}

export default function DeliveryBoostPanel({
  delivery,
  truck,
  onSuccess,
  compact = false,
  currentGameTime: currentGameTimeProp,
}: DeliveryBoostPanelProps) {
  const applyAdReward = useGameStore((state) => state.applyAdReward);
  const monetization = useGameStore((state) => state.monetization);
  const storeCurrentTime = useGameStore((state) => state.currentTime);
  const globalMarketSyncStatus = useGameStore((state) => state.globalMarketSyncStatus);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1),
  );
  const hasCompletedOnboarding = useGameStore((state) => state.onboarding?.completed === true);
  const gameSpeed = useGameStore((state) => getEffectiveOfflineGameSpeed(state));
  const placementState = useRewardedPlacement('delivery_boost');
  const { availability: privacyAvailability, canRequestAds } = useAdPrivacyAvailability();
  const {
    loading: privacyLoading,
    error: privacyError,
    runPrivacyAction,
  } = useAdPrivacyAction();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const currentGameTime = currentGameTimeProp ?? storeCurrentTime;
  const usedCount = delivery.deliveryAdBoost?.usedCount ?? 0;
  const adsFeatureEnabled = areAdsFeatureEnabled();
  const isOnline =
    globalMarketSyncStatus === 'online' ||
    globalMarketSyncStatus === 'idle' ||
    globalMarketSyncStatus === 'syncing';

  const adReady =
    placementState.status === 'ready' ||
    placementState.status === 'showing' ||
    placementState.status === 'loading' ||
    placementState.status === 'idle';

  const availability = useMemo(() => {
    const grant = canGrantAdReward(resetDailyUsageIfNeeded(monetization), 'delivery_boost', {
      currentGameTime,
      playerLevel,
      hasCompletedOnboarding,
      selectedDeliveryId: delivery.id,
    });

    const result = getDeliveryBoostAvailability({
      delivery,
      truck,
      currentGameTime,
      gameSpeed,
      isOnline,
      adState: {
        consentReady: canRequestAds,
        adLoaded: adReady,
        globalProcessing: isRewardedAdShowing() || loading,
        lastBoostAdAt: monetization.lastDeliveryBoostAdAt,
      },
    });

    if (!grant.ok && result.status === 'available') {
      return {
        ...result,
        status: 'disabled' as const,
        reason: 'ad-not-ready' as const,
      };
    }

    return result;
  }, [
    adReady,
    currentGameTime,
    delivery,
    gameSpeed,
    isOnline,
    loading,
    monetization,
    playerLevel,
    hasCompletedOnboarding,
    truck,
    canRequestAds,
  ]);

  const rewardedAvailability = resolveRewardedAdAvailability({
    privacy: privacyAvailability,
    placementStatus: placementState.status,
    isOnline,
  });

  const privacyActionRequired =
    rewardedAvailability === 'privacy-action-required' ||
    rewardedAvailability === 'privacy-error';

  const isAvailable = availability.status === 'available';
  const disabledCopy =
    availability.status === 'disabled' && availability.reason !== 'privacy-required'
      ? deliveryBoostDisabledReasonToUserMessage(availability.reason)
      : null;

  const ctaLabel = privacyLoading
    ? 'Gizlilik tercihleri açılıyor…'
    : rewardedAdAvailabilityToButtonLabel(rewardedAvailability, {
        watchLabel: 'Reklam İzle',
      });

  const helperText =
    rewardedAvailability === 'privacy-action-required'
      ? AD_PRIVACY_ACTION_DESCRIPTION
      : rewardedAdAvailabilityHelperText(rewardedAvailability) ??
        (disabledCopy?.helper && !privacyActionRequired ? disabledCopy.helper : null);

  const isShowingAd = loading || placementState.status === 'showing';

  const canPressCta =
    !privacyLoading &&
    !isShowingAd &&
    (privacyActionRequired
      ? shouldEnableRewardedAdCta(rewardedAvailability)
      : isAvailable && rewardedAvailability === 'ready');

  const durationLabel = formatBoostDurationLabel(
    availability.status === 'available'
      ? availability.estimatedReductionMs
      : availability.estimatedReductionMs,
  );

  const handlePress = useCallback(() => {
    if (privacyLoading || isShowingAd) {
      return;
    }

    if (privacyActionRequired) {
      void runPrivacyAction();
      return;
    }

    if (!isAvailable || rewardedAvailability !== 'ready') {
      if (disabledCopy) {
        setStatusMessage(disabledCopy.body);
      }
      return;
    }
    setConfirmVisible(true);
  }, [
    disabledCopy,
    isAvailable,
    isShowingAd,
    privacyActionRequired,
    privacyLoading,
    rewardedAvailability,
    runPrivacyAction,
  ]);

  const handleConfirm = useCallback(async () => {
    setConfirmVisible(false);
    setLoading(true);
    setStatusMessage(null);
    try {
      const result = await applyAdReward('delivery_boost', {
        selectedDeliveryId: delivery.id,
      });
      if (result.ok) {
        const minutesSaved = Math.max(
          1,
          Math.round(
            (availability.status === 'available'
              ? availability.estimatedReductionMs
              : 0) / 60_000,
          ),
        );
        setStatusMessage(`Teslimat hızlandırıldı · ${durationLabel} kazanıldı`);
        onSuccess?.(minutesSaved);
      } else if (result.reason) {
        setStatusMessage(result.reason);
      }
    } finally {
      setLoading(false);
    }
  }, [
    applyAdReward,
    availability,
    delivery.id,
    durationLabel,
    onSuccess,
  ]);

  const showActiveCta =
    privacyActionRequired ||
    rewardedAvailability === 'privacy-loading' ||
    (isAvailable &&
      (rewardedAvailability === 'ready' ||
        rewardedAvailability === 'loading-ad' ||
        rewardedAvailability === 'showing'));

  const confirmModal = (
    <Modal visible={confirmVisible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Teslimatı Hızlandır</Text>
          <Text style={styles.modalBody}>
            Ödüllü reklam tamamlandığında bu teslimatın kalan süresi yaklaşık {durationLabel}{' '}
            azalacak.
          </Text>
          <Text style={styles.modalMeta}>
            Kullanım: {usedCount}/{DELIVERY_AD_BOOST_MAX_USES}
          </Text>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalPrimary} onPress={handleConfirm}>
              <Text style={styles.modalPrimaryText}>Reklamı İzle</Text>
            </Pressable>
            <Pressable style={styles.modalSecondary} onPress={() => setConfirmVisible(false)}>
              <Text style={styles.modalSecondaryText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (!adsFeatureEnabled) {
    return null;
  }

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <Text style={styles.compactTitle}>Teslimatı Hızlandır</Text>
        <Text style={styles.compactSubtitle} numberOfLines={2}>
          Reklam izle, kalan teslimat süresini %25 azalt.
        </Text>

        {showActiveCta ? (
          <Pressable
            style={({ pressed }) => [
              styles.compactCta,
              !canPressCta && styles.compactCtaDisabled,
              pressed && canPressCta && styles.compactCtaPressed,
            ]}
            onPress={(event) => {
              event.stopPropagation?.();
              handlePress();
            }}
            disabled={!canPressCta}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            {isShowingAd ||
            privacyLoading ||
            rewardedAvailability === 'loading-ad' ||
            rewardedAvailability === 'privacy-loading' ? (
              <ActivityIndicator size="small" color="#38BDF8" />
            ) : (
              <Text style={styles.compactCtaLabel} numberOfLines={2}>
                {ctaLabel}
              </Text>
            )}
          </Pressable>
        ) : (
          <View
            style={styles.compactDisabledPanel}
            accessibilityRole="text"
            accessibilityState={{ disabled: true }}
          >
            <Text style={styles.compactDisabledBody} numberOfLines={3}>
              {disabledCopy?.body ?? 'Hızlandırma şu an kullanılamıyor.'}
            </Text>
          </View>
        )}

        {helperText ? (
          <Text style={styles.compactHint} numberOfLines={3}>
            {helperText}
          </Text>
        ) : null}
        {privacyError ? (
          <Text style={styles.compactError} numberOfLines={2}>
            {AD_PRIVACY_ERROR_MESSAGE}
          </Text>
        ) : null}

        <Text style={styles.compactUsage}>
          {usedCount}/{DELIVERY_AD_BOOST_MAX_USES} kullanıldı
        </Text>
        {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
        {confirmModal}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Teslimatı Hızlandır</Text>
      <Text style={styles.subtitle}>Reklam izle, kalan teslimat süresini %25 azalt.</Text>
      <View style={styles.row}>
        {showActiveCta ? (
          <Pressable
            style={[styles.ctaActive, !canPressCta && styles.ctaActiveDisabled]}
            onPress={(event) => {
              event.stopPropagation?.();
              handlePress();
            }}
            disabled={!canPressCta}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            {isShowingAd ||
            privacyLoading ||
            rewardedAvailability === 'loading-ad' ||
            rewardedAvailability === 'privacy-loading' ? (
              <ActivityIndicator size="small" color="#E0F2FE" />
            ) : (
              <Text style={styles.ctaText} numberOfLines={2}>
                {ctaLabel}
              </Text>
            )}
          </Pressable>
        ) : (
          <View style={styles.ctaDisabled} accessibilityState={{ disabled: true }}>
            <Text style={styles.ctaDisabledText} numberOfLines={2}>
              {disabledCopy?.body ?? 'Hızlandırma şu an kullanılamıyor.'}
            </Text>
          </View>
        )}
        <Text style={styles.usage}>
          {usedCount}/{DELIVERY_AD_BOOST_MAX_USES} kullanıldı
        </Text>
      </View>
      {helperText ? <Text style={styles.hint}>{helperText}</Text> : null}
      {privacyError ? <Text style={styles.privacyError}>{AD_PRIVACY_ERROR_MESSAGE}</Text> : null}
      {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
      {confirmModal}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(56,189,248,0.25)',
    gap: 4,
  },
  compactWrap: {
    marginTop: 6,
    gap: 4,
  },
  title: {
    color: '#E0F2FE',
    fontSize: 13,
    fontWeight: '700',
  },
  compactTitle: {
    color: '#E0F2FE',
    fontSize: 11,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 11.5,
  },
  compactSubtitle: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaActive: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    backgroundColor: 'rgba(37,99,235,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.55)',
  },
  ctaActiveDisabled: {
    opacity: 0.72,
  },
  ctaDisabled: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'rgba(51,65,85,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.35)',
    opacity: 0.88,
  },
  ctaDisabledText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  ctaText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  compactCta: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(37,99,235,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCtaPressed: {
    opacity: 0.9,
  },
  compactCtaDisabled: {
    opacity: 0.72,
  },
  compactCtaLabel: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  compactDisabledPanel: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(51,65,85,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.35)',
    justifyContent: 'center',
    gap: 2,
  },
  compactDisabledBody: {
    color: '#CBD5E1',
    fontSize: 10.5,
    fontWeight: '600',
    lineHeight: 14,
  },
  compactDisabledHelper: {
    color: '#94A3B8',
    fontSize: 9.5,
    lineHeight: 13,
  },
  compactHint: {
    color: '#94A3B8',
    fontSize: 9.5,
    lineHeight: 13,
    paddingLeft: 2,
  },
  compactError: {
    color: '#F87171',
    fontSize: 9.5,
    lineHeight: 13,
    paddingLeft: 2,
  },
  compactUsage: {
    color: '#64748B',
    fontSize: 9.5,
    fontWeight: '600',
    paddingLeft: 2,
  },
  usage: {
    color: '#64748B',
    fontSize: 11,
    minWidth: 72,
    textAlign: 'right',
  },
  hint: {
    color: '#94A3B8',
    fontSize: 10.5,
    marginTop: 2,
  },
  status: {
    color: '#38BDF8',
    fontSize: 11,
    marginTop: 4,
  },
  privacyError: {
    color: '#F87171',
    fontSize: 10.5,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,8,23,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
    gap: 12,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  modalBody: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 19,
  },
  modalMeta: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  modalActions: {
    gap: 8,
    marginTop: 4,
  },
  modalPrimary: {
    backgroundColor: 'rgba(37,99,235,0.45)',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  modalPrimaryText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  modalSecondary: {
    paddingVertical: 8,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  modalSecondaryText: {
    color: '#94A3B8',
  },
});
