/**
 * Dashboard — günlük operasyon desteği (daily_ops_bonus) reklam kartı.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { shouldShowTestAdLabel } from '../../config/adMob';
import { calculateDailyOperationSupportReward } from '../../domain/dailyOperationSupportReward';
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
import { colors, formatMoney } from '../../theme';
import { GameIcon } from '../ui';
import type { AdRewardGrantContext } from '../../types/monetization';

const CTA_MIN_HEIGHT = 42;
const STACKED_FONT_SCALE = 1.3;

interface DashboardDailyOpsBonusCardProps {
  onboardingCompleted: boolean;
  onSuccess?: (amount: number) => void;
}

function resolveAdStatusLabel(params: {
  privacyChecking: boolean;
  loading: boolean;
  eligibilityOk: boolean;
  rewardedAvailability: ReturnType<typeof resolveRewardedAdAvailability>;
  failed: boolean;
  showTestLabel: boolean;
}): string {
  const { privacyChecking, loading, eligibilityOk, rewardedAvailability, failed, showTestLabel } =
    params;
  const testPrefix = showTestLabel ? 'Test reklamı · ' : '';

  if (!eligibilityOk) {
    return `${testPrefix}Günlük destek bugün kullanıldı.`;
  }
  if (privacyChecking || loading) {
    return `${testPrefix}Reklam hazırlanıyor`;
  }
  if (failed || rewardedAvailability === 'unavailable') {
    return `${testPrefix}Reklam yüklenemedi`;
  }
  if (rewardedAvailability === 'ready' || rewardedAvailability === 'loading-ad') {
    return `${testPrefix}Reklam izleyerek al`;
  }
  return `${testPrefix}${rewardedAdAvailabilityHelperText(rewardedAvailability) ?? 'Reklam izleyerek al'}`;
}

export default function DashboardDailyOpsBonusCard({
  onboardingCompleted,
  onSuccess,
}: DashboardDailyOpsBonusCardProps) {
  const { width } = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const stackedLayout = fontScale >= STACKED_FONT_SCALE;
  const useTicketArt = dashboardAssetFlags.useDailySupportTicket;
  const player = useGameStore((state) => state.player);
  const applyAdReward = useGameStore((state) => state.applyAdReward);
  const monetization = useGameStore((state) => state.monetization);
  const currentGameTime = useGameStore((state) => state.currentTime);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1),
  );
  const hasCompletedOnboarding = useGameStore((state) => state.onboarding?.completed === true);
  const placementState = useRewardedPlacement('daily_operations');
  const { availability: privacyAvailability } = useAdPrivacyAvailability();
  const { checking: privacyChecking, ensureAdsAllowedForReward } = useRewardedAdRequest();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const fullContext = useMemo(
    (): AdRewardGrantContext => ({
      currentGameTime,
      playerLevel,
      hasCompletedOnboarding,
      playerFleet: player
        ? {
            drivers: player.drivers,
            warehouses: player.warehouses,
            trucks: player.trucks,
          }
        : undefined,
    }),
    [currentGameTime, hasCompletedOnboarding, player, playerLevel],
  );

  const eligibility = useMemo(() => {
    const normalized = resetDailyUsageIfNeeded(monetization);
    return canGrantAdReward(normalized, 'daily_ops_bonus', fullContext);
  }, [fullContext, monetization]);

  const rewardedAvailability = resolveRewardedAdAvailability({
    privacy: privacyAvailability,
    placementStatus: placementState.status,
  });

  if (!onboardingCompleted || !areAdsFeatureEnabled()) {
    return null;
  }

  const rewardAmount = player ? calculateDailyOperationSupportReward(player) : 0;
  const showTestLabel = shouldShowTestAdLabel();

  const buttonLabel = privacyChecking
    ? 'Hazırlanıyor…'
    : loading
      ? 'Hazırlanıyor…'
      : !eligibility.ok
        ? 'Yarın'
        : rewardedAdAvailabilityToButtonLabel(rewardedAvailability, {
            watchLabel: failed ? 'Tekrar Dene' : 'Ödülü Al',
            retryLabel: 'Tekrar Dene',
          });

  const adStatusLabel = resolveAdStatusLabel({
    privacyChecking,
    loading,
    eligibilityOk: eligibility.ok,
    rewardedAvailability,
    failed,
    showTestLabel,
  });

  const isDisabled =
    loading ||
    privacyChecking ||
    !eligibility.ok ||
    (!shouldEnableRewardedAdCta(rewardedAvailability) && !failed);

  const handlePress = async () => {
    if (loading || privacyChecking) {
      return;
    }

    if (!eligibility.ok) {
      setErrorText(eligibility.reason ?? 'Ödül şu an kullanılamıyor.');
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
      const result = await applyAdReward('daily_ops_bonus', {});
      if (!result.ok) {
        const reason =
          result.reason === 'Reklam yüklenemedi.'
            ? AD_REWARDED_LOAD_FAILED_MESSAGE
            : result.reason ?? AD_REWARDED_LOAD_FAILED_MESSAGE;
        setErrorText(reason);
        setFailed(true);
        return;
      }
      setFailed(false);
      onSuccess?.(rewardAmount);
    } catch (error) {
      setFailed(true);
      setErrorText(error instanceof Error ? error.message : AD_REWARDED_LOAD_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.cardWrap}>
      <View style={styles.cardAtmosphere} pointerEvents="none" />
      <View style={[styles.card, stackedLayout && styles.cardStacked]}>
        <View style={[styles.mainRow, stackedLayout && styles.mainRowStacked]}>
          <View style={styles.supportVisual}>
            {useTicketArt ? (
              <Image
                source={dashboardAssets.dailySupportTicket}
                style={styles.ticketImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.iconWrap}>
                <GameIcon name="cash" size={22} color="#FFAA00" />
              </View>
            )}
          </View>

          <View style={styles.supportContent}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.9}>
              Günlük Operasyon Desteği
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              Bir günlük temel giderlerini karşıla.
            </Text>
            <Text style={styles.rewardLine} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.88}>
              Bugünkü destek: {formatMoney(rewardAmount)}
            </Text>
            <Text style={styles.adStatus} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {adStatusLabel}
            </Text>
            {errorText ? (
              <Text style={styles.inlineError} numberOfLines={1}>
                {errorText}
              </Text>
            ) : null}
          </View>

          {!stackedLayout ? (
            <Pressable
              style={({ pressed }) => [
                styles.supportAction,
                isDisabled && styles.supportActionDisabled,
                pressed && !isDisabled && styles.supportActionPressed,
              ]}
              onPress={() => void handlePress()}
              disabled={isDisabled}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
            >
              {loading || privacyChecking ? (
                <ActivityIndicator size="small" color="#FFAA00" />
              ) : (
                <>
                  <GameIcon name="play" size={14} color={isDisabled ? '#B8924A' : '#FFAA00'} />
                  <Text
                    style={[styles.ctaLabel, isDisabled && styles.ctaLabelDisabled]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {buttonLabel}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        {stackedLayout ? (
          <Pressable
            style={({ pressed }) => [
              styles.supportAction,
              styles.supportActionStacked,
              isDisabled && styles.supportActionDisabled,
              pressed && !isDisabled && styles.supportActionPressed,
            ]}
            onPress={() => void handlePress()}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
          >
            {loading || privacyChecking ? (
              <ActivityIndicator size="small" color="#FFAA00" />
            ) : (
              <>
                <GameIcon name="play" size={14} color={isDisabled ? '#B8924A' : '#FFAA00'} />
                <Text
                  style={[styles.ctaLabel, isDisabled && styles.ctaLabelDisabled]}
                  numberOfLines={1}
                >
                  {buttonLabel}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    position: 'relative',
  },
  cardAtmosphere: {
    position: 'absolute',
    top: -4,
    left: -6,
    right: -6,
    bottom: -4,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 170, 0, 0.035)',
  },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.48)',
    backgroundColor: '#0B1728',
    gap: 10,
    minHeight: 96,
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: '#FFAA00',
        shadowOpacity: 0.08,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  cardStacked: {
    gap: 8,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  mainRowStacked: {
    alignItems: 'flex-start',
  },
  supportVisual: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ticketImage: {
    width: 48,
    height: 40,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 170, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 1,
  },
  title: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  rewardLine: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
    color: colors.success,
    marginTop: 2,
  },
  adStatus: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 1,
  },
  inlineError: {
    fontSize: 10,
    lineHeight: 13,
    color: '#F87171',
    marginTop: 1,
  },
  supportAction: {
    minWidth: 108,
    maxWidth: 132,
    minHeight: CTA_MIN_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    flexShrink: 0,
    backgroundColor: 'rgba(255, 170, 0, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.70)',
  },
  supportActionStacked: {
    width: '100%',
    maxWidth: '100%',
  },
  supportActionDisabled: {
    opacity: 0.52,
    borderColor: 'rgba(255, 170, 0, 0.35)',
    backgroundColor: 'rgba(255, 170, 0, 0.06)',
  },
  supportActionPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  ctaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFAA00',
    flexShrink: 1,
    includeFontPadding: false,
  },
  ctaLabelDisabled: {
    color: '#B8924A',
  },
});
