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
import { canRequestAdsAfterConsent } from '../../services/adsConsentService';
import { getEffectiveOfflineGameSpeed } from '../../config/balance';
import { DELIVERY_AD_BOOST_MAX_USES } from '../../config/deliveryAdBoost';
import {
  eligibilityReasonToUserMessage,
  formatBoostDurationLabel,
  getDeliveryAdBoostEligibility,
} from '../../simulation/deliveryAdBoost';
import { resetDailyUsageIfNeeded, canGrantAdReward } from '../../simulation/adRewardGrants';
import {
  getRewardedPlacementStatusMessage,
  useRewardedPlacement,
} from '../../hooks/useRewardedPlacement';

interface DeliveryBoostPanelProps {
  delivery: Delivery;
  truck?: Truck;
  onSuccess?: (minutesSaved: number) => void;
  compact?: boolean;
}

export default function DeliveryBoostPanel({
  delivery,
  truck,
  onSuccess,
  compact = false,
}: DeliveryBoostPanelProps) {
  const applyAdReward = useGameStore((state) => state.applyAdReward);
  const monetization = useGameStore((state) => state.monetization);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1),
  );
  const hasCompletedOnboarding = useGameStore((state) => state.onboarding?.completed === true);
  const gameSpeed = useGameStore((state) => getEffectiveOfflineGameSpeed(state));
  const placementState = useRewardedPlacement('delivery_boost');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const usedCount = delivery.deliveryAdBoost?.usedCount ?? 0;
  const adsFeatureEnabled = areAdsFeatureEnabled();

  const eligibility = useMemo(() => {
    const base = canGrantAdReward(resetDailyUsageIfNeeded(monetization), 'delivery_boost', {
      currentGameTime: 0,
      playerLevel,
      hasCompletedOnboarding,
      selectedDeliveryId: delivery.id,
    });
    if (!base.ok) {
      return {
        eligible: false,
        message: base.reason ?? 'Hızlandırma kullanılamıyor.',
        estimatedReductionMs: 0,
        usesRemaining: Math.max(0, DELIVERY_AD_BOOST_MAX_USES - usedCount),
      };
    }

    const adReady =
      placementState.status === 'ready' ||
      placementState.status === 'showing' ||
      placementState.status === 'loading' ||
      placementState.status === 'idle';

    const result = getDeliveryAdBoostEligibility({
      delivery,
      truck,
      gameSpeed,
      adState: {
        consentReady: canRequestAdsAfterConsent(),
        adLoaded: adReady,
        globalProcessing: isRewardedAdShowing() || loading,
        lastBoostAdAt: monetization.lastDeliveryBoostAdAt,
      },
    });
    return {
      eligible: result.eligible,
      message: eligibilityReasonToUserMessage(result),
      estimatedReductionMs: result.estimatedReductionMs,
      usesRemaining: result.usesRemaining,
    };
  }, [
    delivery,
    gameSpeed,
    hasCompletedOnboarding,
    loading,
    monetization,
    placementState.status,
    playerLevel,
    truck,
    usedCount,
  ]);

  const durationLabel = formatBoostDurationLabel(eligibility.estimatedReductionMs);
  const placementMessage = getRewardedPlacementStatusMessage(placementState);
  const buttonDisabled = !eligibility.eligible || loading || placementState.status === 'showing';

  const ctaLabel = useMemo(() => {
    if (loading || placementState.status === 'showing') {
      return 'Reklam açılıyor…';
    }
    if (placementState.status === 'loading' || placementState.status === 'idle') {
      return 'Reklam hazırlanıyor…';
    }
    if (eligibility.eligible) {
      return `Reklam İzle · -${durationLabel}`;
    }
    return eligibility.message ?? placementMessage ?? 'Kullanılamıyor';
  }, [
    durationLabel,
    eligibility.eligible,
    eligibility.message,
    loading,
    placementMessage,
    placementState.status,
  ]);

  const handlePress = useCallback(() => {
    if (!eligibility.eligible) {
      setStatusMessage(eligibility.message ?? placementMessage);
      return;
    }
    setConfirmVisible(true);
  }, [eligibility.eligible, eligibility.message, placementMessage]);

  const handleConfirm = useCallback(async () => {
    setConfirmVisible(false);
    setLoading(true);
    setStatusMessage(null);
    try {
      const result = await applyAdReward('delivery_boost', {
        selectedDeliveryId: delivery.id,
      });
      if (result.ok) {
        const minutesSaved = Math.max(1, Math.round(eligibility.estimatedReductionMs / 60_000));
        setStatusMessage(`Teslimat hızlandırıldı · ${durationLabel} kazanıldı`);
        onSuccess?.(minutesSaved);
      } else if (result.reason) {
        setStatusMessage(result.reason);
      }
    } finally {
      setLoading(false);
    }
  }, [applyAdReward, delivery.id, durationLabel, eligibility.estimatedReductionMs, onSuccess]);

  if (!adsFeatureEnabled) {
    return null;
  }

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <Pressable
          style={({ pressed }) => [
            styles.compactCta,
            buttonDisabled && styles.compactCtaDisabled,
            pressed && !buttonDisabled && styles.compactCtaPressed,
          ]}
          onPress={handlePress}
          disabled={buttonDisabled}
          accessibilityRole="button"
          accessibilityLabel="Teslimatı hızlandır"
        >
          {loading || placementState.status === 'loading' ? (
            <ActivityIndicator size="small" color="#38BDF8" />
          ) : (
            <>
              <Text style={styles.compactCtaTitle} numberOfLines={1}>
                Teslimatı Hızlandır
              </Text>
              <Text style={styles.compactCtaLabel} numberOfLines={1}>
                {ctaLabel}
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.compactUsage}>
          {usedCount}/{DELIVERY_AD_BOOST_MAX_USES} kullanıldı
        </Text>
        {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}

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
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Teslimatı Hızlandır</Text>
      <Text style={styles.subtitle}>Reklam izle, kalan süreyi %25 azalt.</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.cta, buttonDisabled ? styles.ctaDisabled : styles.ctaActive]}
          onPress={handlePress}
          disabled={buttonDisabled}
        >
          {loading || placementState.status === 'loading' ? (
            <ActivityIndicator size="small" color="#E0F2FE" />
          ) : (
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          )}
        </Pressable>
        <Text style={styles.usage}>
          {usedCount}/{DELIVERY_AD_BOOST_MAX_USES} kullanıldı
        </Text>
      </View>
      {placementMessage && !eligibility.eligible && placementState.status !== 'ready' ? (
        <Text style={styles.hint}>{placementMessage}</Text>
      ) : null}
      {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}

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
    gap: 3,
  },
  title: {
    color: '#E0F2FE',
    fontSize: 13,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 11.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  cta: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  ctaActive: {
    backgroundColor: 'rgba(37,99,235,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.55)',
  },
  ctaDisabled: {
    backgroundColor: 'rgba(51,65,85,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.35)',
    opacity: 0.82,
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
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(8,20,38,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.45)',
    justifyContent: 'center',
    gap: 1,
  },
  compactCtaDisabled: {
    opacity: 0.72,
    borderColor: 'rgba(100,116,139,0.35)',
  },
  compactCtaPressed: {
    opacity: 0.9,
  },
  compactCtaTitle: {
    color: '#E0F2FE',
    fontSize: 10.5,
    fontWeight: '800',
  },
  compactCtaLabel: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '700',
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
