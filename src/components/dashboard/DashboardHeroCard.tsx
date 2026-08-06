import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { dashboardAssetFlags, dashboardAssets } from '../../assets/dashboardAssets';
import type { ReputationSummary } from '../../domain/reputationModel';
import { AppTutorialTarget } from '../tutorial/AppTutorialTarget';
import { GameIcon, ProgressBar } from '../ui';
import { formatCompanyScore } from '../../simulation/companyScore';
import type { GameIconName } from '../../theme/icons';
import {
  colors,
  formatGameTimeCompact,
  formatMoney,
  formatUnitPrice,
} from '../../theme';
import {
  DASHBOARD_HERO_BORDER,
  DASHBOARD_HERO_PADDING,
  DASHBOARD_HERO_RADIUS,
  dashboardHeroElevation,
  getDashboardMoneyColor,
} from './dashboardTheme';

interface DashboardHeroCardProps {
  companyName: string;
  level: number;
  currentTime: number;
  fuelPrice: number;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  isMaxLevel: boolean;
  money: number;
  companyScore: number;
  reputationSummary: ReputationSummary;
  idleTrucks: number;
  activeDeliveries: number;
  onReputationPress?: () => void;
}

interface MetricTileProps {
  label: string;
  value: string;
  icon: GameIconName;
  color: string;
  compact: boolean;
  labelMinScale?: number;
}

function MetricTile({ label, value, icon, color, compact, labelMinScale = 0.72 }: MetricTileProps) {
  const iconBox = compact ? 28 : 30;
  const iconGlyph = compact ? 13 : 14;

  return (
    <View style={[styles.metricTile, { borderColor: `${color}32`, backgroundColor: `${color}0C` }]}>
      <View
        style={[
          styles.metricIconWrap,
          {
            width: iconBox,
            height: iconBox,
            backgroundColor: `${color}20`,
          },
        ]}
      >
        <GameIcon name={icon} size={iconGlyph} color={color} />
      </View>
      <Text
        style={styles.metricLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={labelMinScale}
      >
        {label}
      </Text>
      <Text
        style={[styles.metricValue, { color, fontSize: compact ? 15 : 16 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

export default function DashboardHeroCard({
  companyName,
  level,
  currentTime,
  fuelPrice,
  xp,
  xpToNext,
  xpProgress,
  isMaxLevel,
  money,
  companyScore,
  reputationSummary,
  idleTrucks,
  activeDeliveries,
  onReputationPress,
}: DashboardHeroCardProps) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const effectiveXpProgress = isMaxLevel ? 1 : Math.min(1, Math.max(0, xpProgress));
  const reputationDisplay = `${reputationSummary.score}/100`;
  const moneyColor = getDashboardMoneyColor(money);
  const fleetLabel = compact ? 'BOŞTA · AKTİF' : 'BOŞTA / AKTİF';
  const fleetValue = `${idleTrucks} / ${activeDeliveries}`;

  return (
    <View style={[styles.card, dashboardHeroElevation]}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.emblemSlot}>
            <View style={styles.emblemGlow} pointerEvents="none" />
            {dashboardAssetFlags.useCompanyEmblem ? (
              <View style={styles.emblemWrap}>
                <Image
                  source={dashboardAssets.companyEmblem}
                  style={styles.emblem}
                  resizeMode="contain"
                />
              </View>
            ) : (
              <View style={styles.emblemFallback}>
                <GameIcon name="company" size={24} color={colors.amber} />
              </View>
            )}
          </View>
          <View style={styles.titleBlock}>
            <Text
              style={[styles.companyName, compact && styles.companyNameCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {companyName}
            </Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle} numberOfLines={1}>
                Lojistik Şirketi · CEO
              </Text>
              <View style={styles.hqBadge}>
                <Text style={styles.hqBadgeText}>HQ</Text>
              </View>
            </View>
          </View>
          <View style={styles.levelBadge}>
            <GameIcon name="level" size={12} color={colors.amber} />
            <Text style={styles.levelBadgeText}>Lv {level}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <GameIcon name="time" size={12} color={colors.textMuted} />
            <Text style={styles.metaText}>{formatGameTimeCompact(currentTime)}</Text>
          </View>
          <View style={styles.metaPill}>
            <GameIcon name="fuel" size={12} color={colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>
              Yakıt {formatUnitPrice(fuelPrice, '/L')}
            </Text>
          </View>
        </View>

        <View style={styles.xpSection}>
          <View style={styles.xpHeader}>
            <Text style={styles.xpLabel}>DENEYİM</Text>
            <Text style={styles.xpValue}>
              {isMaxLevel ? 'MAX' : `${xp.toLocaleString('en-US')} / ${xpToNext.toLocaleString('en-US')} XP`}
            </Text>
          </View>
          <ProgressBar progress={effectiveXpProgress} color={colors.primary} height={5} trackColor={colors.surface3} />
        </View>

        <View style={styles.metricRow}>
          <MetricTile label="Nakit" value={formatMoney(money)} icon="cash" color={moneyColor} compact={compact} />
          <MetricTile label="Puan" value={formatCompanyScore(companyScore)} icon="xp" color={colors.primaryLight} compact={compact} />
          <AppTutorialTarget tutorialId="dashboard" targetId="reputation-card">
          <Pressable
            style={({ pressed }) => [styles.reputationTile, pressed && styles.reputationTilePressed]}
            onPress={onReputationPress}
            disabled={!onReputationPress}
            accessibilityRole="button"
            accessibilityLabel={`İtibar ${reputationDisplay}, ${reputationSummary.tierLabel}`}
          >
            <View style={[styles.metricTile, styles.reputationMetricInner, { borderColor: `${colors.purple}32`, backgroundColor: `${colors.purple}0C` }]}>
              <View
                style={[
                  styles.metricIconWrap,
                  {
                    width: compact ? 28 : 30,
                    height: compact ? 28 : 30,
                    backgroundColor: `${colors.purple}20`,
                  },
                ]}
              >
                <GameIcon name="reputation" size={compact ? 13 : 14} color={colors.purple} />
              </View>
              <Text
                style={styles.metricLabel}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                İtibar
              </Text>
              <Text
                style={[styles.metricValue, { color: colors.purple, fontSize: compact ? 15 : 16 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {reputationDisplay}
              </Text>
              <Text style={styles.reputationTier} numberOfLines={1}>
                {reputationSummary.tierLabel}
              </Text>
              <ProgressBar
                progress={reputationSummary.progressToNextTier}
                color={colors.purple}
                height={3}
                trackColor={colors.surface3}
              />
              {reputationSummary.recentChange != null && reputationSummary.recentChange !== 0 ? (
                <Text
                  style={[
                    styles.reputationBadge,
                    reputationSummary.recentChange > 0
                      ? styles.reputationBadgePositive
                      : styles.reputationBadgeNegative,
                  ]}
                  numberOfLines={1}
                >
                  {reputationSummary.recentChange > 0
                    ? `+${reputationSummary.recentChange}`
                    : reputationSummary.recentChange}
                </Text>
              ) : null}
            </View>
          </Pressable>
          </AppTutorialTarget>
          <MetricTile
            label={fleetLabel}
            value={fleetValue}
            icon="truck"
            color={colors.amber}
            compact={compact}
            labelMinScale={0.68}
          />
        </View>
      </View>
    </View>
  );
}

const EMBLEM_SIZE = 56;
const EMBLEM_WRAP = 58;

const styles = StyleSheet.create({
  card: {
    borderRadius: DASHBOARD_HERO_RADIUS,
    borderWidth: 1,
    borderColor: DASHBOARD_HERO_BORDER,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  content: {
    padding: DASHBOARD_HERO_PADDING,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emblemSlot: {
    width: EMBLEM_WRAP,
    height: EMBLEM_WRAP,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emblemGlow: {
    position: 'absolute',
    width: EMBLEM_WRAP + 4,
    height: EMBLEM_WRAP + 4,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 170, 0, 0.12)',
  },
  emblemWrap: {
    width: EMBLEM_WRAP,
    height: EMBLEM_WRAP,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 170, 0, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.18)',
  },
  emblem: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
    backgroundColor: 'transparent',
  },
  emblemFallback: {
    width: EMBLEM_WRAP,
    height: EMBLEM_WRAP,
    borderRadius: 17,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  companyName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.05,
  },
  companyNameCompact: {
    fontSize: 19,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  subtitle: {
    color: colors.textSecondary,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '500',
  },
  hqBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.35)',
    flexShrink: 0,
  },
  hqBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.primaryLight,
    letterSpacing: 0.3,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 29,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
    flexShrink: 0,
  },
  levelBadgeText: {
    fontWeight: '800',
    fontSize: 11,
    color: colors.amber,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: -2,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 25,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: 'rgba(10, 20, 38, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(70, 120, 190, 0.24)',
  },
  metaText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  xpSection: {
    gap: 4,
  },
  xpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.35,
  },
  xpValue: {
    fontWeight: '700',
    fontSize: 10,
    color: colors.textSecondary,
    paddingRight: 5,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 75,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  metricIconWrap: {
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.1,
    textAlign: 'center',
    width: '100%',
  },
  metricValue: {
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
    width: '100%',
  },
  reputationTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
  },
  reputationTilePressed: {
    opacity: 0.92,
  },
  reputationMetricInner: {
    gap: 2,
    paddingBottom: 4,
  },
  reputationTier: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  reputationBadge: {
    fontSize: 8.5,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  reputationBadgePositive: {
    color: '#4ADE80',
  },
  reputationBadgeNegative: {
    color: '#F87171',
  },
});
