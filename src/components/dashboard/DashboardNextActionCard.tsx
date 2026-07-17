import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ActionButton, GameIcon, StatusBadge } from '../ui';
import type { GameIconName } from '../../theme/icons';
import { colors, radius, spacing, typography } from '../../theme';
import type { NextActionVariant, RewardChipData } from './dashboardHubLogic';

export interface DashboardNextActionCardProps {
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
  variant?: NextActionVariant;
  icon?: GameIconName;
  badgeLabel?: string;
  rewardChips?: RewardChipData[];
  eyebrowText?: string;
  onDismissGuide?: () => void;
  dismissGuideLabel?: string;
  /** Başlangıç Rehberi aktifken premium rehber görünümü */
  isOnboardingGuide?: boolean;
  /** Rehber kartında kısa hedef etiketi */
  goalHintLabel?: string;
}

const VARIANT_ACCENT: Record<NextActionVariant, string> = {
  primary: colors.accentBlue,
  reward: colors.accentAmber,
  track: colors.info,
  explore: colors.success,
};

const REWARD_CHIP_COLOR: Record<RewardChipData['key'], string> = {
  count: colors.accentAmber,
  money: colors.success,
  xp: colors.accentAmber,
  diamonds: colors.accentBlue,
  reputation: colors.info,
};

const GUIDE_CYAN = '#38BDF8';
const GUIDE_CTA_BLUE = '#2F80FF';

function RewardChip({ chip }: { chip: RewardChipData }) {
  const color = REWARD_CHIP_COLOR[chip.key];
  return (
    <View
      style={[
        styles.rewardChip,
        { backgroundColor: `${color}16`, borderColor: `${color}45` },
      ]}
    >
      {chip.icon ? <GameIcon name={chip.icon} size={10} color={color} /> : null}
      <Text style={[styles.rewardChipText, { color }]} numberOfLines={1}>
        {chip.label}
      </Text>
    </View>
  );
}

function GuideDecorations() {
  return (
    <>
      <View style={styles.glowOrbTopRight} pointerEvents="none" />
      <View style={styles.glowOrbBottomLeft} pointerEvents="none" />
      <View style={styles.guideSheen} pointerEvents="none" />
    </>
  );
}

interface GuideCardProps {
  icon: GameIconName;
  eyebrowText: string;
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
  onDismissGuide?: () => void;
  dismissGuideLabel: string;
  accent: string;
  goalHintLabel?: string;
}

function GuideCard({
  icon,
  eyebrowText,
  title,
  description,
  ctaLabel,
  onPress,
  onDismissGuide,
  dismissGuideLabel,
  accent,
  goalHintLabel,
}: GuideCardProps) {
  return (
    <View style={styles.cardGuide}>
      <View style={styles.guideAccentColumn} pointerEvents="none">
        <View style={[styles.guideAccentCore, { backgroundColor: accent }]} />
        <View style={[styles.guideAccentFade, { backgroundColor: `${accent}88` }]} />
      </View>

      <GuideDecorations />

      <View style={styles.contentGuide}>
        <View style={styles.guideHeaderRow}>
          <View style={styles.iconWrapGuide}>
            <View style={styles.iconWrapGuideGlow} />
            <GameIcon name={icon} size={21} color={GUIDE_CYAN} />
            <View style={styles.iconSparkle} />
          </View>

          <View style={styles.guideTitleBlock}>
            <View style={styles.guideEyebrowRow}>
              <View style={styles.guideBadge}>
                <Text style={styles.guideBadgeText}>REHBER</Text>
              </View>
              <Text style={styles.eyebrowGuide} numberOfLines={1}>
                {eyebrowText}
              </Text>
            </View>
            <Text style={styles.titleGuide} numberOfLines={1}>
              {title}
            </Text>
          </View>
        </View>

        {goalHintLabel ? (
          <Text style={styles.goalHintLabel}>{goalHintLabel}</Text>
        ) : null}

        <Text style={styles.descriptionGuide} numberOfLines={2}>
          {description}
        </Text>

        <View style={styles.guideActions}>
          <TouchableOpacity
            style={styles.ctaGuideButton}
            onPress={onPress}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.ctaGuideLabel}>{ctaLabel}</Text>
            <GameIcon name="chevronRight" size={14} color="#FFFFFF" />
          </TouchableOpacity>

          {onDismissGuide ? (
            <TouchableOpacity
              onPress={onDismissGuide}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text style={styles.dismissGuide}>{dismissGuideLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function DashboardNextActionCard({
  title,
  description,
  ctaLabel,
  onPress,
  variant = 'primary',
  icon = 'contract',
  badgeLabel,
  rewardChips,
  eyebrowText = 'Sıradaki Hamle',
  onDismissGuide,
  dismissGuideLabel = 'Rehberi Gizle',
  isOnboardingGuide = false,
  goalHintLabel,
}: DashboardNextActionCardProps) {
  const accent = isOnboardingGuide
    ? variant === 'reward'
      ? colors.accentAmber
      : GUIDE_CYAN
    : VARIANT_ACCENT[variant];
  const showRewardChips = variant === 'reward' && !!rewardChips?.length && !isOnboardingGuide;
  const ctaVariant = isOnboardingGuide ? 'primary' : variant === 'reward' ? 'primary' : 'secondary';

  const fadeAnim = useRef(new Animated.Value(isOnboardingGuide ? 0 : 1)).current;
  const slideAnim = useRef(new Animated.Value(isOnboardingGuide ? 10 : 0)).current;
  const pulseAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (!isOnboardingGuide) {
      return;
    }
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.92, duration: 1800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isOnboardingGuide, fadeAnim, slideAnim, pulseAnim]);

  if (isOnboardingGuide) {
    return (
      <Animated.View
        style={[
          styles.guideOuter,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <Animated.View style={[styles.guideOuterGlow, { opacity: pulseAnim }]}>
          <GuideCard
            icon={icon}
            eyebrowText={eyebrowText ?? ''}
            title={title}
            description={description}
            ctaLabel={ctaLabel}
            onPress={onPress}
            onDismissGuide={onDismissGuide}
            dismissGuideLabel={dismissGuideLabel}
            accent={accent}
            goalHintLabel={goalHintLabel}
          />
        </Animated.View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={[styles.accentStrip, { backgroundColor: accent }]} />
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: `${accent}1F` }]}>
            <GameIcon name={icon} size={17} color={accent} />
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>{eyebrowText}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
          {badgeLabel ? <StatusBadge label={badgeLabel} variant="amber" size="sm" /> : null}
        </View>

        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>

        {showRewardChips ? (
          <View style={styles.rewardChipRow}>
            {rewardChips!.map((chip) => (
              <RewardChip key={chip.key} chip={chip} />
            ))}
          </View>
        ) : null}

        <ActionButton
          label={ctaLabel}
          onPress={onPress}
          variant={ctaVariant}
          compact
          style={styles.cta}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  guideOuter: {
    ...Platform.select({
      android: { elevation: 4 },
      ios: {
        shadowColor: GUIDE_CYAN,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.28,
        shadowRadius: 12,
      },
    }),
  },
  guideOuterGlow: {
    borderRadius: radius.lg + 1,
  },
  cardGuide: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    backgroundColor: '#08111F',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.46)',
    overflow: 'hidden',
    minHeight: 158,
  },
  guideAccentColumn: {
    width: 5,
    overflow: 'hidden',
  },
  guideAccentCore: {
    flex: 1,
    width: 5,
  },
  guideAccentFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 5,
    width: 8,
    opacity: 0.35,
  },
  glowOrbTopRight: {
    position: 'absolute',
    top: -48,
    right: -36,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  glowOrbBottomLeft: {
    position: 'absolute',
    bottom: -56,
    left: 24,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(14, 165, 233, 0.09)',
  },
  guideSheen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(56, 189, 248, 0.04)',
  },
  contentGuide: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 11,
    gap: 8,
  },
  guideHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrapGuide: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 165, 233, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.48)',
    overflow: 'visible',
    ...Platform.select({
      android: { elevation: 3 },
      ios: {
        shadowColor: GUIDE_CYAN,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
    }),
  },
  iconWrapGuideGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 13,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
  },
  iconSparkle: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GUIDE_CYAN,
    opacity: 0.85,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  guideTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  guideEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  guideBadge: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.38)',
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.75,
    color: GUIDE_CYAN,
  },
  eyebrowGuide: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: 'rgba(56, 189, 248, 0.88)',
    flex: 1,
    minWidth: 0,
  },
  titleGuide: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 21,
  },
  goalHintLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(56, 189, 248, 0.72)',
    paddingLeft: 56,
    marginTop: -2,
    textTransform: 'uppercase',
  },
  descriptionGuide: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(203, 213, 225, 0.92)',
    paddingLeft: 56,
    marginTop: 1,
  },
  guideActions: {
    paddingLeft: 56,
    gap: 0,
    marginTop: 2,
  },
  ctaGuideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 42,
    paddingHorizontal: 20,
    borderRadius: 15,
    backgroundColor: GUIDE_CTA_BLUE,
    borderWidth: 1,
    borderColor: 'rgba(125, 190, 255, 0.42)',
    ...Platform.select({
      android: { elevation: 3 },
      ios: {
        shadowColor: GUIDE_CTA_BLUE,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.38,
        shadowRadius: 6,
      },
    }),
  },
  ctaGuideLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  dismissGuide: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    opacity: 0.75,
    marginTop: 8,
  },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  accentStrip: {
    width: 3,
    opacity: 0.7,
  },
  content: {
    flex: 1,
    padding: spacing.sm + 2,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    ...typography.caption,
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: 1,
  },
  description: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  rewardChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: -2,
  },
  rewardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  rewardChipText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
  },
  cta: {
    alignSelf: 'flex-start',
    marginTop: 3,
  },
});
