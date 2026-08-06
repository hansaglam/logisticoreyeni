/**
 * Dashboard — günlük operasyon desteği (daily_ops_bonus) reklam kartı.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import { shouldShowTestAdLabel } from '../../config/adMob';
import { getDailyOpsBonusCash } from '../../config/monetization';
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
import { formatMoney } from '../../theme';
import { GameIcon } from '../ui';
import { DASHBOARD_NARROW_WIDTH } from '../dashboard/dashboardTheme';
import type { AdRewardGrantContext } from '../../types/monetization';

const CARD_HEIGHT = 92;
const CARD_HEIGHT_NARROW = 88;

interface DashboardDailyOpsBonusCardProps {
  playerLevel: number;
  onboardingCompleted: boolean;
  onSuccess?: (amount: number) => void;
}

interface DailyOpsAdCtaProps {
  rewardAmount: number;
  onSuccess?: (amount: number) => void;
  isNarrow: boolean;
}

function DailyOpsAdCta({ rewardAmount, onSuccess, isNarrow }: DailyOpsAdCtaProps) {
  const applyAdReward = useGameStore((state) => state.applyAdReward);
  const monetization = useGameStore((state) => state.monetization);
  const currentGameTime = useGameStore((state) => state.currentTime);
  const playerLevel = useGameStore(
    (state) => Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1),
  );
  const hasCompletedOnboarding = useGameStore((state) => state.onboarding?.completed === true);
  const placementState = useRewardedPlacement('daily_operations');
  const { availability: privacyAvailability } = useAdPrivacyAvailability();
  const {
    loading: privacyLoading,
    error: privacyError,
    runPrivacyAction,
  } = useAdPrivacyAction();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const fullContext = useMemo(
    (): AdRewardGrantContext => ({
      currentGameTime,
      playerLevel,
      hasCompletedOnboarding,
    }),
    [currentGameTime, hasCompletedOnboarding, playerLevel],
  );

  const eligibility = useMemo(() => {
    const normalized = resetDailyUsageIfNeeded(monetization);
    return canGrantAdReward(normalized, 'daily_ops_bonus', fullContext);
  }, [fullContext, monetization]);

  const rewardedAvailability = resolveRewardedAdAvailability({
    privacy: privacyAvailability,
    placementStatus: placementState.status,
  });

  const buttonLabel = privacyLoading
    ? 'Gizlilik tercihleri açılıyor…'
    : loading
      ? 'Reklam hazırlanıyor…'
      : rewardedAdAvailabilityToButtonLabel(rewardedAvailability, {
          watchLabel: shouldShowTestAdLabel() ? 'Reklam İzle (Test)' : 'Reklam İzle',
          retryLabel: failed ? 'Tekrar Dene' : 'Tekrar Dene',
        });

  const helperText =
    rewardedAvailability === 'privacy-action-required'
      ? AD_PRIVACY_ACTION_DESCRIPTION
      : rewardedAdAvailabilityHelperText(rewardedAvailability);

  const isDisabled =
    loading ||
    privacyLoading ||
    (!shouldEnableRewardedAdCta(rewardedAvailability) && !failed) ||
    (rewardedAvailability === 'ready' && !eligibility.ok && !failed);

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
      setErrorText(eligibility.reason ?? 'Ödül şu an kullanılamıyor.');
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
            ? 'Reklam şu anda kullanılamıyor.'
            : result.reason ?? 'Reklam şu anda kullanılamıyor.';
        setErrorText(reason);
        setFailed(true);
        return;
      }
      setFailed(false);
      onSuccess?.(rewardAmount);
    } catch (error) {
      setFailed(true);
      setErrorText(error instanceof Error ? error.message : 'Reklam şu anda kullanılamıyor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.ctaWrap, isNarrow && styles.ctaWrapNarrow]}>
      <Pressable
        style={({ pressed }) => [
          styles.ctaButton,
          isDisabled && styles.ctaButtonDisabled,
          pressed && !isDisabled && styles.ctaButtonPressed,
        ]}
        onPress={() => void handlePress()}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
      >
        {loading || privacyLoading ? (
          <ActivityIndicator size="small" color="#FFAA00" />
        ) : (
          <>
            <GameIcon name="play" size={14} color={isDisabled ? '#B8924A' : '#FFAA00'} />
            <Text
              style={[styles.ctaLabel, isDisabled && styles.ctaLabelDisabled]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {buttonLabel}
            </Text>
          </>
        )}
      </Pressable>
      {helperText ? (
        <Text style={styles.ctaHint} numberOfLines={3}>
          {helperText}
        </Text>
      ) : null}
      {privacyError ? (
        <Text style={styles.ctaError} numberOfLines={2}>
          {AD_PRIVACY_ERROR_MESSAGE}
        </Text>
      ) : null}
      {errorText ? (
        <Text style={styles.ctaError} numberOfLines={2}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

export default function DashboardDailyOpsBonusCard({
  playerLevel,
  onboardingCompleted,
  onSuccess,
}: DashboardDailyOpsBonusCardProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < DASHBOARD_NARROW_WIDTH;
  const useTicketArt = dashboardAssetFlags.useDailySupportTicket;

  if (!onboardingCompleted || !areAdsFeatureEnabled()) {
    return null;
  }

  const rewardAmount = getDailyOpsBonusCash(playerLevel);
  const showTestLabel = shouldShowTestAdLabel();

  const artworkColumnWidth = isNarrow ? 62 : 70;
  const artworkImageWidth = isNarrow ? 58 : 66;
  const artworkImageHeight = isNarrow ? 44 : 48;

  return (
    <View style={styles.cardWrap}>
      <View style={styles.cardAtmosphere} pointerEvents="none" />
      <View style={[styles.card, isNarrow && styles.cardNarrow]}>
      <View style={[styles.artColumn, { width: artworkColumnWidth }]}>
        {useTicketArt ? (
          <Image
            source={dashboardAssets.dailySupportTicket}
            style={{ width: artworkImageWidth, height: artworkImageHeight }}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.iconWrap}>
            <GameIcon name="cash" size={22} color="#FFAA00" />
          </View>
        )}
      </View>

      <View style={styles.textBlock}>
        <Text
          style={[styles.title, isNarrow && styles.titleNarrow]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          Günlük Operasyon Desteği
        </Text>
        <Text
          style={[styles.subtitle, isNarrow && styles.subtitleNarrow]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          Reklam izle, küçük operasyon desteği al ({formatMoney(rewardAmount)})
        </Text>
        {showTestLabel ? <Text style={styles.footnote}>Test reklamı</Text> : null}
      </View>

      <DailyOpsAdCta rewardAmount={rewardAmount} onSuccess={onSuccess} isNarrow={isNarrow} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    position: 'relative',
  },
  cardWrapNarrow: {},
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
    height: CARD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.48)',
    backgroundColor: '#0B1728',
    overflow: 'visible',
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
  cardNarrow: {
    height: CARD_HEIGHT_NARROW,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  artColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 6,
    backgroundColor: 'transparent',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 170, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  title: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    color: '#F3F7FF',
  },
  titleNarrow: {
    fontSize: 11,
    lineHeight: 13,
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '400',
    color: '#A9B6CC',
    marginTop: 2,
  },
  subtitleNarrow: {
    fontSize: 9.5,
    lineHeight: 11,
  },
  footnote: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '400',
    color: '#74839B',
    marginTop: 2,
  },
  ctaWrap: {
    width: 122,
    height: 43,
    flexShrink: 0,
    justifyContent: 'center',
  },
  ctaWrapNarrow: {
    width: 108,
    height: 40,
  },
  ctaButton: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 170, 0, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.70)',
    gap: 5,
  },
  ctaButtonDisabled: {
    opacity: 0.52,
    borderColor: 'rgba(255, 170, 0, 0.35)',
    backgroundColor: 'rgba(255, 170, 0, 0.06)',
  },
  ctaButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  ctaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFAA00',
    flexShrink: 1,
    includeFontPadding: false,
  },
  ctaLabelDisabled: {
    color: '#B8924A',
  },
  ctaHint: {
    position: 'absolute',
    bottom: -12,
    left: 0,
    right: 0,
    fontSize: 7.5,
    lineHeight: 9,
    color: '#94A3B8',
    textAlign: 'center',
  },
  ctaError: {
    position: 'absolute',
    bottom: -12,
    left: 0,
    right: 0,
    fontSize: 7.5,
    lineHeight: 9,
    color: '#F87171',
    textAlign: 'center',
  },
});
