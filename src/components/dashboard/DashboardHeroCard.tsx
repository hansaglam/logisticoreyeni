import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { GameIcon, ProgressBar } from '../ui';
import { formatCompanyScore } from '../../simulation/companyScore';
import { colors, formatGameTimeCompact, formatMoney, radius, spacing, typography } from '../../theme';

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
  reputation: number;
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.chipValue, { color }]} numberOfLines={1}>
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
  reputation,
}: DashboardHeroCardProps) {
  const [xpTrackWidth, setXpTrackWidth] = useState(0);
  const effectiveXpProgress = isMaxLevel ? 1 : Math.min(1, Math.max(0, xpProgress));

  const handleXpTrackLayout = (event: LayoutChangeEvent) => {
    setXpTrackWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.logoSlot}>
          <View style={styles.logoGlow} />
          <View style={styles.logoWrap}>
            <GameIcon name="company" size={24} color={colors.accentAmber} />
          </View>
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.companyName} numberOfLines={1}>
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
          <GameIcon name="level" size={11} color={colors.accentAmber} />
          <Text style={styles.levelBadgeText}>LV {level}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.timePill}>
          <GameIcon name="time" size={11} color={colors.textMuted} />
          <Text style={styles.timeText}>{formatGameTimeCompact(currentTime)}</Text>
        </View>
        <View style={styles.fuelPill}>
          <GameIcon name="fuel" size={11} color={colors.textMuted} />
          <Text style={styles.fuelText}>Yakıt {fuelPrice.toFixed(2)} ₺/L</Text>
        </View>
      </View>

      <View style={styles.xpSection}>
        <View style={styles.xpHeader}>
          <Text style={styles.xpLabel}>Deneyim</Text>
          <Text style={styles.xpValue}>{isMaxLevel ? 'MAX' : `${xp} / ${xpToNext} XP`}</Text>
        </View>
        <View style={styles.xpBarWrap} onLayout={handleXpTrackLayout}>
          <ProgressBar
            progress={effectiveXpProgress}
            color={colors.accentAmber}
            height={6}
            trackColor="rgba(15, 23, 42, 0.9)"
          />
          {xpTrackWidth > 0 && effectiveXpProgress > 0.03 ? (
            <View
              style={[
                styles.xpBarDot,
                {
                  left: Math.min(
                    Math.max(xpTrackWidth * effectiveXpProgress - 4, 2),
                    xpTrackWidth - 8,
                  ),
                },
              ]}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.chipRow}>
        <StatChip label="Nakit" value={formatMoney(money)} color={colors.success} />
        <StatChip label="Puan" value={formatCompanyScore(companyScore)} color={colors.accentBlue} />
        <StatChip label="İtibar" value={`${Math.round(reputation)}/100`} color={colors.info} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.16)',
    padding: spacing.sm + 4,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoSlot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlow: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  companyName: {
    ...typography.sectionTitle,
    fontSize: 16,
    color: colors.textPrimary,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  hqBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  hqBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.accentBlue,
    letterSpacing: 0.4,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  levelBadgeText: {
    ...typography.caption,
    fontWeight: '900',
    fontSize: 11,
    color: colors.accentAmber,
    letterSpacing: 0.4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSoft,
  },
  timeText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  fuelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.cardSoft,
  },
  fuelText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  xpSection: {
    gap: 4,
  },
  xpBarWrap: {
    position: 'relative',
  },
  xpBarDot: {
    position: 'absolute',
    top: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FDE68A',
    borderWidth: 1.5,
    borderColor: colors.accentAmber,
  },
  xpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 9.5,
  },
  xpValue: {
    ...typography.caption,
    fontWeight: '800',
    fontSize: 11,
    color: colors.accentAmber,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 1,
  },
  chipLabel: {
    ...typography.caption,
    fontSize: 8.5,
    color: colors.textMuted,
    fontWeight: '600',
  },
  chipValue: {
    ...typography.caption,
    fontWeight: '800',
    fontSize: 11,
  },
});
